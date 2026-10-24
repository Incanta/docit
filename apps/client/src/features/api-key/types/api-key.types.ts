export interface IApiKey {
  id: string;
  name: string;
  scopes: string[] | null;
  creatorId: string;
  workspaceId: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  creator?: { id: string; name: string; email: string; avatarUrl?: string };
}

export interface ICreatedApiKey extends IApiKey {
  token: string;
}

export interface ICreateApiKey {
  name: string;
  scopes: string[];
  expiresAt?: string;
}

export const API_KEY_RESOURCES = [
  "pages",
  "comments",
  "spaces",
  "search",
  "attachments",
  "users",
  "workspace",
  "ai",
] as const;
