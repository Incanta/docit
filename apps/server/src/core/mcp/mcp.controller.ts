import {
  All,
  Controller,
  ForbiddenException,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { Workspace } from '@docmost/db/types/entity.types';
import { JwtType } from '../auth/dto/jwt-payload';
import { McpService } from './mcp.service';

export function isMcpEnabled(workspace: Workspace): boolean {
  return (workspace.settings as any)?.ai?.mcp === true;
}

/**
 * Streamable HTTP MCP endpoint at /api/mcp. Clients authenticate with an
 * API key (`Authorization: Bearer <key>`); a browser session also works.
 */
@UseGuards(JwtAuthGuard)
@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @All()
  async handle(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (!isMcpEnabled(workspace)) {
      throw new ForbiddenException('MCP is not enabled for this workspace');
    }

    const authUser: any = (req as any).user;
    const isApiKey = authUser?.authType === JwtType.API_KEY;

    const url = `${req.protocol}://${req.headers.host}${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined || key === 'content-length') continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(url, {
      method: req.method,
      headers,
      body: hasBody && req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });

    const response = await this.mcpService.handle(request, req.body, {
      isApiKey,
      apiKeyScopes: authUser?.apiKey?.scopes,
      auth: {
        authorization: req.headers.authorization,
        // Session users are forwarded by cookie; keys never need it.
        cookie: isApiKey ? undefined : req.headers.cookie,
        host: req.headers.host,
        remoteAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    reply.hijack();
    const raw = reply.raw;
    raw.statusCode = response.status;
    response.headers.forEach((value, key) => raw.setHeader(key, value));
    if (!response.body) {
      raw.end();
      return;
    }
    Readable.fromWeb(response.body as any).pipe(raw);
  }
}
