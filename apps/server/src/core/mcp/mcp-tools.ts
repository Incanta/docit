import { z } from 'zod';
import { markdownToHtml } from '@docmost/editor-ext';
import {
  htmlToJson,
  jsonToMarkdown,
} from '../../collaboration/collaboration.util';
import { ApiKeyScope } from '../api-key/api-key-scopes';
import {
  ForwardedAuth,
  InternalApiClient,
  InternalApiError,
} from './internal-api.client';

export type McpToolContext = {
  api: InternalApiClient;
  auth: ForwardedAuth;
  appUrl: string;
};

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  scope: ApiKeyScope;
  readOnly: boolean;
  destructive?: boolean;
  inputSchema: z.ZodObject<any>;
  run: (ctx: McpToolContext, args: any) => Promise<unknown>;
};

const pageUrl = (ctx: McpToolContext, slugId: string) =>
  `${ctx.appUrl}/p/${slugId}`;

function summarizePage(ctx: McpToolContext, page: any) {
  return {
    id: page.id,
    slugId: page.slugId,
    title: page.title || 'Untitled',
    spaceId: page.spaceId,
    parentPageId: page.parentPageId ?? null,
    hasChildren: page.hasChildren,
    updatedAt: page.updatedAt,
    url: page.slugId ? pageUrl(ctx, page.slugId) : undefined,
  };
}

async function markdownToCommentJson(markdown: string): Promise<string> {
  const html = await markdownToHtml(markdown);
  return JSON.stringify(htmlToJson(html));
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'whoami',
    title: 'Current user',
    description: 'Return the user and workspace this connection acts as.',
    scope: 'users:read',
    readOnly: true,
    inputSchema: z.object({}),
    run: async (ctx) => {
      const me = await ctx.api.post(ctx.auth, '/users/me');
      return {
        user: { id: me.user.id, name: me.user.name, email: me.user.email },
        workspace: { id: me.workspace.id, name: me.workspace.name },
      };
    },
  },
  {
    name: 'list_spaces',
    title: 'List spaces',
    description: 'List the spaces the user is a member of.',
    scope: 'spaces:read',
    readOnly: true,
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional().describe('Cursor from a previous call'),
    }),
    run: async (ctx, { limit, cursor }) => {
      const res = await ctx.api.post(ctx.auth, '/spaces', {
        limit: limit ?? 50,
        cursor,
      });
      return {
        spaces: res.items.map((s: any) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          description: s.description,
        })),
        nextCursor: res.meta?.nextCursor ?? null,
      };
    },
  },
  {
    name: 'search_pages',
    title: 'Search pages',
    description:
      'Full-text search across pages the user can read. Returns titles, highlights, and page ids.',
    scope: 'search:read',
    readOnly: true,
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      spaceId: z.string().uuid().optional().describe('Limit to one space'),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    run: async (ctx, { query, spaceId, limit }) => {
      const res = await ctx.api.post(ctx.auth, '/search', {
        query,
        spaceId,
        limit: limit ?? 10,
      });
      const items = Array.isArray(res) ? res : (res.items ?? []);
      return items.map((r: any) => ({
        id: r.id,
        title: r.title || 'Untitled',
        highlight: r.highlight,
        space: r.space ? { id: r.space.id, name: r.space.name } : undefined,
        url: r.slugId ? pageUrl(ctx, r.slugId) : undefined,
      }));
    },
  },
  {
    name: 'list_pages',
    title: 'List pages',
    description:
      'List the top-level pages of a space, or the child pages of a page.',
    scope: 'pages:read',
    readOnly: true,
    inputSchema: z.object({
      spaceId: z.string().uuid(),
      parentPageId: z
        .string()
        .optional()
        .describe('Omit to list root pages of the space'),
      cursor: z.string().optional(),
    }),
    run: async (ctx, { spaceId, parentPageId, cursor }) => {
      const res = await ctx.api.post(ctx.auth, '/pages/sidebar-pages', {
        spaceId,
        pageId: parentPageId,
        cursor,
        limit: 100,
      });
      return {
        pages: res.items.map((p: any) => summarizePage(ctx, p)),
        nextCursor: res.meta?.nextCursor ?? null,
      };
    },
  },
  {
    name: 'get_page',
    title: 'Get page',
    description: 'Read a page, with its content as Markdown.',
    scope: 'pages:read',
    readOnly: true,
    inputSchema: z.object({
      pageId: z.string().describe('Page id (uuid) or slug id'),
    }),
    run: async (ctx, { pageId }) => {
      const page = await ctx.api.post(ctx.auth, '/pages/info', {
        pageId,
        includeContent: true,
        includeSpace: true,
        format: 'markdown',
      });
      return {
        ...summarizePage(ctx, page),
        space: page.space
          ? { id: page.space.id, name: page.space.name }
          : undefined,
        content: page.content ?? '',
      };
    },
  },
  {
    name: 'get_recent_pages',
    title: 'Recently updated pages',
    description: 'List recently updated pages, optionally in one space.',
    scope: 'pages:read',
    readOnly: true,
    inputSchema: z.object({
      spaceId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    run: async (ctx, { spaceId, limit }) => {
      const res = await ctx.api.post(ctx.auth, '/pages/recent', {
        spaceId,
        limit: limit ?? 20,
      });
      return res.items.map((p: any) => summarizePage(ctx, p));
    },
  },
  {
    name: 'create_page',
    title: 'Create page',
    description:
      'Create a page from Markdown, at the root of a space or under a parent page.',
    scope: 'pages:write',
    readOnly: false,
    inputSchema: z.object({
      spaceId: z.string().uuid(),
      title: z.string().max(500),
      content: z.string().optional().describe('Page body as Markdown'),
      parentPageId: z.string().optional(),
    }),
    run: async (ctx, { spaceId, title, content, parentPageId }) => {
      const page = await ctx.api.post(ctx.auth, '/pages/create', {
        spaceId,
        title,
        parentPageId,
        ...(content !== undefined ? { content, format: 'markdown' } : {}),
      });
      return summarizePage(ctx, page);
    },
  },
  {
    name: 'update_page',
    title: 'Update page',
    description:
      'Change a page title and/or content. Content is Markdown and can replace, append to, or prepend to the page.',
    scope: 'pages:write',
    readOnly: false,
    inputSchema: z.object({
      pageId: z.string(),
      title: z.string().max(500).optional(),
      content: z.string().optional().describe('Markdown'),
      operation: z
        .enum(['replace', 'append', 'prepend'])
        .optional()
        .describe('How to apply content (default: replace)'),
    }),
    run: async (ctx, { pageId, title, content, operation }) => {
      const page = await ctx.api.post(ctx.auth, '/pages/update', {
        pageId,
        title,
        ...(content !== undefined
          ? { content, format: 'markdown', operation: operation ?? 'replace' }
          : {}),
      });
      return summarizePage(ctx, page);
    },
  },
  {
    name: 'delete_page',
    title: 'Move page to trash',
    description:
      'Move a page and its children to the space trash. It can be restored from the trash.',
    scope: 'pages:write',
    readOnly: false,
    destructive: true,
    inputSchema: z.object({ pageId: z.string() }),
    run: async (ctx, { pageId }) => {
      await ctx.api.post(ctx.auth, '/pages/delete', { pageId });
      return { deleted: true, pageId };
    },
  },
  {
    name: 'ask_knowledge_base',
    title: 'Ask the knowledge base',
    description:
      'Ask a question and get an AI answer grounded in pages the user can read, with numbered sources. Requires AI answers to be enabled.',
    scope: 'ai:read',
    readOnly: true,
    inputSchema: z.object({
      question: z.string().min(1).max(2000),
      spaceId: z.string().uuid().optional(),
    }),
    run: async (ctx, { question, spaceId }) => {
      const body = await ctx.api.postRaw(ctx.auth, '/ai/ask', {
        question,
        spaceId,
      });
      let answer = '';
      let sources: any[] = [];
      for (const line of body.split('\n')) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'sources') sources = event.sources;
        if (event.type === 'text') answer += event.delta;
        if (event.type === 'error') throw new Error(event.message);
      }
      return {
        answer,
        sources: sources.map((s) => ({
          index: s.index,
          title: s.title,
          url: s.url,
          pageId: s.pageId,
        })),
      };
    },
  },
  {
    name: 'list_comments',
    title: 'List comments',
    description: 'List comment threads on a page, as Markdown.',
    scope: 'comments:read',
    readOnly: true,
    inputSchema: z.object({ pageId: z.string() }),
    run: async (ctx, { pageId }) => {
      const page = await ctx.api.post(ctx.auth, '/pages/info', { pageId });
      const res = await ctx.api.post(ctx.auth, '/comments', {
        pageId: page.id,
        limit: 100,
      });
      return res.items.map((c: any) => ({
        id: c.id,
        parentCommentId: c.parentCommentId,
        author: c.creator?.name,
        createdAt: c.createdAt,
        resolved: !!c.resolvedAt,
        selection: c.selection ?? undefined,
        content: c.content ? jsonToMarkdown(c.content) : '',
      }));
    },
  },
  {
    name: 'add_comment',
    title: 'Add comment',
    description: 'Add a page comment, or reply to a comment thread.',
    scope: 'comments:write',
    readOnly: false,
    inputSchema: z.object({
      pageId: z.string(),
      content: z.string().min(1).describe('Comment as Markdown'),
      parentCommentId: z
        .string()
        .uuid()
        .optional()
        .describe('Reply to this top-level comment'),
    }),
    run: async (ctx, { pageId, content, parentCommentId }) => {
      const page = await ctx.api.post(ctx.auth, '/pages/info', { pageId });
      const comment = await ctx.api.post(ctx.auth, '/comments/create', {
        pageId: page.id,
        parentCommentId,
        content: await markdownToCommentJson(content),
      });
      return { id: comment.id, pageId: page.id };
    },
  },
];

/** Run a tool and shape the result (or error) for MCP. */
export async function runTool(
  tool: McpToolDefinition,
  ctx: McpToolContext,
  args: unknown,
) {
  try {
    const result = await tool.run(ctx, args ?? {});
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message =
      err instanceof InternalApiError
        ? `${err.message} (HTTP ${err.status})`
        : (err as Error)?.message ?? 'Tool failed';
    return {
      isError: true,
      content: [{ type: 'text' as const, text: message }],
    };
  }
}
