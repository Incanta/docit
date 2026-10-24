import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import {
  OAUTH_SCOPE_KEY,
  OAuthRouteScope,
} from '../../common/decorators/oauth-scope.decorator';

/**
 * API key scopes are `<resource>:<access>`. `write` implies `read` for the
 * same resource.
 */
export const API_KEY_RESOURCES = [
  'pages',
  'comments',
  'spaces',
  'search',
  'attachments',
  'users',
  'workspace',
  'ai',
] as const;

export type ApiKeyResource = (typeof API_KEY_RESOURCES)[number];
export type ApiKeyAccess = 'read' | 'write';
export type ApiKeyScope = `${ApiKeyResource}:${ApiKeyAccess}`;

export const ALL_API_KEY_SCOPES: ApiKeyScope[] = API_KEY_RESOURCES.flatMap(
  (r) => [`${r}:read`, `${r}:write`] as ApiKeyScope[],
);

export function isValidScope(scope: string): scope is ApiKeyScope {
  return (ALL_API_KEY_SCOPES as string[]).includes(scope);
}

/**
 * Routes reachable with an API key that do not carry an @OAuthScope marker,
 * keyed by `METHOD /path` (without the /api prefix). Keeping the list here
 * avoids touching upstream controllers.
 */
const EXTRA_ROUTE_SCOPES: Record<string, ApiKeyScope> = {
  'POST /pages/delete': 'pages:write',
  'POST /pages/restore': 'pages:write',
  'POST /pages/breadcrumbs': 'pages:read',
  'POST /pages/history': 'pages:read',
  'POST /pages/history/info': 'pages:read',
  'POST /pages/export': 'pages:read',
  'POST /pages/trash': 'pages:read',
  'POST /pages/labels': 'pages:read',
  'POST /pages/backlinks': 'pages:read',
  'POST /spaces/export': 'spaces:read',
  'POST /comments/info': 'comments:read',
  'POST /comments/delete': 'comments:write',
  'POST /spaces/members': 'spaces:read',
  'POST /files/upload': 'attachments:write',
  'POST /files/info': 'attachments:read',
  'POST /attachments/upload-image': 'attachments:write',
  'POST /ai/generate': 'ai:write',
  'POST /ai/generate/stream': 'ai:write',
  'POST /ai/ask': 'ai:read',
};

/** Controller paths that differ from the resource name. */
const CONTROLLER_RESOURCE: Record<string, ApiKeyResource> = {
  pages: 'pages',
  comments: 'comments',
  spaces: 'spaces',
  search: 'search',
  users: 'users',
  workspace: 'workspace',
  ai: 'ai',
  '': 'attachments', // AttachmentController is mounted at the root
  '/': 'attachments',
};

function routeKey(ctx: ExecutionContext): string | undefined {
  const req = ctx.switchToHttp().getRequest();
  const url: string | undefined = req.routeOptions?.url ?? req.routerPath;
  if (!url) return undefined;
  const path = url.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  return `${req.method} ${path}`;
}

/**
 * Routes any valid key may call. The MCP endpoint checks scopes per tool.
 */
const ANY_SCOPE_ROUTES = new Set(['POST /mcp', 'GET /mcp', 'DELETE /mcp']);

/**
 * The scope a request needs, `'any'` when every key may call it, or
 * undefined if API keys may not call it at all.
 */
export function requiredScopeFor(
  reflector: Reflector,
  ctx: ExecutionContext,
): ApiKeyScope | 'any' | undefined {
  const key = routeKey(ctx);
  if (key && ANY_SCOPE_ROUTES.has(key)) return 'any';
  if (key && EXTRA_ROUTE_SCOPES[key]) return EXTRA_ROUTE_SCOPES[key];

  const access = reflector.getAllAndOverride<OAuthRouteScope | undefined>(
    OAUTH_SCOPE_KEY,
    [ctx.getHandler(), ctx.getClass()],
  );
  if (!access) return undefined;

  const controllerPath: string =
    Reflect.getMetadata(PATH_METADATA, ctx.getClass()) ?? '';
  const resource =
    CONTROLLER_RESOURCE[controllerPath.replace(/^\//, '')] ??
    CONTROLLER_RESOURCE[controllerPath];
  if (!resource) return undefined;
  return `${resource}:${access}`;
}

/** NULL scopes are legacy keys with full access. */
export function hasScope(
  granted: string[] | null | undefined,
  required: ApiKeyScope | 'any',
): boolean {
  if (!granted || required === 'any') return true;
  if (granted.includes(required)) return true;
  const [resource, access] = required.split(':');
  return access === 'read' && granted.includes(`${resource}:write`);
}
