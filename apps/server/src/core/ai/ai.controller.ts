import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageAccessService } from '../page/page-access/page-access.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { AiService, isAiSearchOn, isGenerativeAiEnabled } from './ai.service';
import { AiProviderService } from './providers/ai-provider.service';
import { AiAskDto, AiGenerateDto } from './dto/ai.dto';

/** Abort the model call when the client goes away. */
function abortOnClose(req: FastifyRequest): AbortSignal {
  const controller = new AbortController();
  req.raw.on('close', () => controller.abort());
  return controller.signal;
}

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly aiService: AiService,
    private readonly aiProvider: AiProviderService,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly environmentService: EnvironmentService,
  ) {}

  /** Which AI features this workspace can use right now. */
  @HttpCode(HttpStatus.OK)
  @Post('status')
  async status(@AuthWorkspace() workspace: Workspace) {
    const configured = await this.aiProvider.isChatConfigured(workspace.id);
    return {
      configured,
      generative: configured && isGenerativeAiEnabled(workspace),
      answers: configured && isAiSearchOn(workspace),
    };
  }

  private async buildPrompt(dto: AiGenerateDto, user: User, workspace: Workspace) {
    let context: string | undefined;
    if (dto.pageId) {
      const page = await this.pageRepo.findById(dto.pageId, {
        includeTextContent: true,
      });
      if (!page || page.workspaceId !== workspace.id || page.deletedAt) {
        throw new NotFoundException('Page not found');
      }
      await this.pageAccessService.validateCanView(page, user);
      context = `${page.title ?? ''}\n\n${page.textContent ?? ''}`;
    }
    return this.aiService.buildEditPrompt({ ...dto, context });
  }

  /** Non-streaming generation, for API clients. */
  @HttpCode(HttpStatus.OK)
  @Post('generate')
  async generate(
    @Body() dto: AiGenerateDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.aiService.assertGenerative(workspace);
    const prompt = await this.buildPrompt(dto, user, workspace);
    return { text: await this.aiService.generate(workspace, prompt) };
  }

  /** Streams the generated Markdown as plain text chunks. */
  @Post('generate/stream')
  async generateStream(
    @Body() dto: AiGenerateDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    this.aiService.assertGenerative(workspace);
    const prompt = await this.buildPrompt(dto, user, workspace);
    const result = await this.aiService.streamGenerate(
      workspace,
      prompt,
      abortOnClose(req),
    );

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') raw.write(part.text);
        if (part.type === 'error') throw part.error;
      }
    } catch (err) {
      this.logger.warn(`AI generation stream failed: ${(err as Error)?.message}`);
      raw.write(`\n\n[AI error: ${(err as Error)?.message ?? 'generation failed'}]`);
    } finally {
      raw.end();
    }
  }

  /**
   * Answer a question from the knowledge base. Streams newline-delimited
   * JSON: one `sources` event, then `text` deltas, then `done` or `error`.
   */
  @Post('ask')
  async ask(
    @Body() dto: AiAskDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    this.aiService.assertAiSearch(workspace);
    const { sources, prompt } = await this.aiService.prepareAnswer({
      workspace,
      userId: user.id,
      question: dto.question,
      spaceId: dto.spaceId,
    });

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: unknown) => raw.write(JSON.stringify(event) + '\n');

    const appUrl = this.environmentService.getAppUrl();
    send({
      type: 'sources',
      sources: sources.map((s) => ({
        index: s.index,
        pageId: s.pageId,
        slugId: s.slugId,
        title: s.title,
        spaceName: s.spaceName,
        attachmentName: s.attachmentName,
        url: `${appUrl}/p/${s.slugId}`,
        excerpt: s.snippets[0]?.slice(0, 280),
      })),
    });

    if (!prompt) {
      send({
        type: 'text',
        delta: 'I could not find anything in the knowledge base about that.',
      });
      send({ type: 'done' });
      raw.end();
      return;
    }

    try {
      const result = await this.aiService.streamAnswer(
        workspace,
        prompt,
        abortOnClose(req),
      );
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') send({ type: 'text', delta: part.text });
        if (part.type === 'error') throw part.error;
      }
      send({ type: 'done' });
    } catch (err) {
      this.logger.warn(`AI answer stream failed: ${(err as Error)?.message}`);
      send({ type: 'error', message: (err as Error)?.message ?? 'Answer failed' });
    } finally {
      raw.end();
    }
  }
}
