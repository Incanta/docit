export interface IAuditLog {
  id: string;
  workspaceId: string;
  actorId: string | null;
  actorType: "user" | "system" | "api_key";
  event: string;
  resourceType: string;
  resourceId: string | null;
  spaceId: string | null;
  changes: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  } | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actor?: { id: string; name: string; email: string; avatarUrl?: string } | null;
  space?: { id: string; name: string; slug: string } | null;
}

export interface IAuditLogFilters {
  events?: string[];
  resourceType?: string;
  actorId?: string;
  actorType?: string;
  spaceId?: string;
  startDate?: string;
  endDate?: string;
}

export interface IAuditEventCatalog {
  events: string[];
  resourceTypes: string[];
}
