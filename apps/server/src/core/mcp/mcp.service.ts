import { Injectable, Logger } from '@nestjs/common';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { hasScope } from '../api-key/api-key-scopes';
import { ForwardedAuth, InternalApiClient } from './internal-api.client';
import { MCP_TOOLS, McpToolContext, runTool } from './mcp-tools';

export type McpCaller = {
  auth: ForwardedAuth;
  /** null when the caller is not an API key (full access within the user's rights). */
  apiKeyScopes: string[] | null | undefined;
  isApiKey: boolean;
};

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly api: InternalApiClient,
    private readonly environmentService: EnvironmentService,
  ) {}

  /** Tools the caller may use. Key holders only see tools their scopes allow. */
  private toolsFor(caller: McpCaller) {
    if (!caller.isApiKey) return MCP_TOOLS;
    return MCP_TOOLS.filter((t) => hasScope(caller.apiKeyScopes, t.scope));
  }

  private buildServer(caller: McpCaller): McpServer {
    const server = new McpServer(
      { name: 'docit', title: 'DocIt', version: '1.0.0' },
      {
        instructions:
          'Tools for reading and editing a DocIt knowledge base. Page content is exchanged as Markdown. Use search_pages to find pages, then get_page to read them.',
      },
    );

    const ctx: McpToolContext = {
      api: this.api,
      auth: caller.auth,
      appUrl: this.environmentService.getAppUrl(),
    };

    for (const tool of this.toolsFor(caller)) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            title: tool.title,
            readOnlyHint: tool.readOnly,
            destructiveHint: tool.destructive ?? false,
            openWorldHint: false,
          },
        },
        async (args: unknown) => runTool(tool, ctx, args),
      );
    }

    return server;
  }

  /** Serve one MCP HTTP request (stateless). */
  async handle(
    request: Request,
    parsedBody: unknown,
    caller: McpCaller,
  ): Promise<Response> {
    const handler = createMcpHandler(() => this.buildServer(caller));
    try {
      return await handler.fetch(request, { parsedBody });
    } catch (err) {
      this.logger.error('MCP request failed', err);
      throw err;
    } finally {
      handler.close().catch(() => undefined);
    }
  }
}
