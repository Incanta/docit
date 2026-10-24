import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { embed, generateText } from 'ai';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequireSessionAuth } from '../../common/decorators/require-session-auth.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AiSettingsRepo } from '@docmost/db/repos/ai/ai-settings.repo';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { AiProviderService } from './providers/ai-provider.service';
import { AI_PROVIDERS, AiProviderId } from './providers/ai-provider.constants';
import { clearAnthropicCliTokenCache } from './providers/anthropic-cli-token';
import { TestAiSettingsDto, UpdateAiSettingsDto } from './dto/ai-settings.dto';

@UseGuards(JwtAuthGuard)
@RequireSessionAuth()
@Controller('ai/settings')
export class AiSettingsController {
  constructor(
    private readonly aiSettingsRepo: AiSettingsRepo,
    private readonly aiProviderService: AiProviderService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    @InjectQueue(QueueName.AI_QUEUE) private readonly aiQueue: Queue,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  private assertAdmin(user: User, workspace: Workspace) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }
  }

  /** Current settings without secrets, plus the provider catalog. */
  @HttpCode(HttpStatus.OK)
  @Post()
  async get(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    this.assertAdmin(user, workspace);
    const row = await this.aiSettingsRepo.findByWorkspaceId(workspace.id);
    const resolved = await this.aiProviderService.resolveConfig(workspace.id);

    return {
      providers: AI_PROVIDERS,
      source: row ? 'workspace' : resolved.chat ? 'environment' : null,
      settings: row
        ? {
            provider: row.provider,
            authMode: row.authMode,
            hasApiKey: !!row.apiKey,
            baseUrl: row.baseUrl,
            chatModel: row.chatModel,
            embeddingProvider: row.embeddingProvider,
            embeddingAuthMode: row.embeddingAuthMode,
            hasEmbeddingApiKey: !!row.embeddingApiKey,
            embeddingBaseUrl: row.embeddingBaseUrl,
            embeddingModel: row.embeddingModel,
            embeddingDimensions: row.embeddingDimensions,
            updatedAt: row.updatedAt,
          }
        : null,
      // What the environment provides when no workspace settings exist.
      environment:
        !row && resolved.chat
          ? {
              provider: resolved.chat.provider,
              chatModel: resolved.chat.model,
              embeddingModel: resolved.embedding?.model ?? null,
            }
          : null,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(
    @Body() dto: UpdateAiSettingsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertAdmin(user, workspace);

    const info = AI_PROVIDERS[dto.provider as AiProviderId];
    if (!info.authModes.includes(dto.authMode as any)) {
      throw new BadRequestException(
        `${info.label} does not support this authentication mode`,
      );
    }
    if (info.needsBaseUrl && !dto.baseUrl && !info.defaultBaseUrl) {
      throw new BadRequestException(`${info.label} needs a base URL`);
    }

    const embeddingProvider = dto.embeddingProvider || null;
    if (dto.embeddingModel) {
      const ep = AI_PROVIDERS[(embeddingProvider || dto.provider) as AiProviderId];
      if (!ep.supportsEmbeddings) {
        throw new BadRequestException(
          `${ep.label} does not provide embedding models; pick another provider for embeddings`,
        );
      }
    }

    const before = await this.aiSettingsRepo.findByWorkspaceId(workspace.id);

    const secret = (incoming: string | undefined, existing: string | null) => {
      if (incoming === undefined) return existing ?? null;
      return incoming ? this.aiProviderService.encryptSecret(incoming) : null;
    };

    const providerChanged = before && before.provider !== dto.provider;
    const saved = await this.aiSettingsRepo.upsert({
      workspaceId: workspace.id,
      provider: dto.provider,
      authMode: dto.authMode,
      apiKey:
        dto.authMode === 'api_key'
          ? secret(dto.apiKey, providerChanged ? null : before?.apiKey)
          : null,
      baseUrl: dto.baseUrl || info.defaultBaseUrl || null,
      chatModel: dto.chatModel,
      embeddingProvider,
      embeddingAuthMode: embeddingProvider ? dto.embeddingAuthMode || 'api_key' : null,
      embeddingApiKey: embeddingProvider
        ? secret(dto.embeddingApiKey, before?.embeddingApiKey)
        : null,
      embeddingBaseUrl: embeddingProvider ? dto.embeddingBaseUrl || null : null,
      embeddingModel: dto.embeddingModel || null,
      embeddingDimensions: dto.embeddingDimensions ?? null,
      updatedById: user.id,
    });

    if (dto.authMode === 'anthropic_cli') clearAnthropicCliTokenCache();

    // A different embedding model makes stored vectors useless.
    const embeddingChanged =
      (before?.embeddingModel ?? null) !== saved.embeddingModel ||
      (before?.embeddingProvider ?? null) !== saved.embeddingProvider ||
      (before?.embeddingDimensions ?? null) !== saved.embeddingDimensions;
    const aiSearchOn = (workspace.settings as any)?.ai?.search === true;
    if (embeddingChanged && aiSearchOn) {
      await this.aiQueue.add(QueueJob.WORKSPACE_RESET_EMBEDDINGS, {
        workspaceId: workspace.id,
      });
    }

    this.auditService.log({
      event: AuditEvent.WORKSPACE_UPDATED,
      resourceType: AuditResource.WORKSPACE,
      resourceId: workspace.id,
      metadata: { section: 'ai' },
      changes: {
        before: before
          ? {
              provider: before.provider,
              authMode: before.authMode,
              chatModel: before.chatModel,
              embeddingModel: before.embeddingModel,
            }
          : undefined,
        after: {
          provider: saved.provider,
          authMode: saved.authMode,
          chatModel: saved.chatModel,
          embeddingModel: saved.embeddingModel,
          apiKeyChanged: dto.apiKey !== undefined,
        },
      },
    });

    return this.get(user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async remove(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    this.assertAdmin(user, workspace);
    await this.aiSettingsRepo.delete(workspace.id);
    this.auditService.log({
      event: AuditEvent.WORKSPACE_UPDATED,
      resourceType: AuditResource.WORKSPACE,
      resourceId: workspace.id,
      metadata: { section: 'ai', action: 'reset' },
    });
    return this.get(user, workspace);
  }

  /** Make a tiny request with the saved settings and report the result. */
  @HttpCode(HttpStatus.OK)
  @Post('test')
  async test(
    @Body() dto: TestAiSettingsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertAdmin(user, workspace);
    const started = Date.now();
    try {
      if (dto.target === 'chat') {
        const model = await this.aiProviderService.getChatModel(workspace.id);
        const { text } = await generateText({
          model,
          prompt: 'Reply with the single word: OK',
          maxOutputTokens: 1024,
        });
        return { ok: true, latencyMs: Date.now() - started, sample: text.trim().slice(0, 80) };
      }

      const em = await this.aiProviderService.getEmbeddingModel(workspace.id);
      if (!em) {
        return { ok: false, error: 'No embedding model is configured' };
      }
      const { embedding } = await embed({ model: em.model, value: 'DocIt' });
      return {
        ok: true,
        latencyMs: Date.now() - started,
        dimensions: embedding.length,
      };
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? String(err) };
    }
  }
}
