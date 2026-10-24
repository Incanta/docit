import api from "@/lib/api-client";
import { IPagination } from "@/lib/types.ts";
import {
  IAuditEventCatalog,
  IAuditLog,
  IAuditLogFilters,
} from "@/features/audit/types/audit.types.ts";

export async function getAuditLogs(
  params: IAuditLogFilters & { cursor?: string; limit?: number },
): Promise<IPagination<IAuditLog>> {
  const req = await api.post("/audit", params);
  return req.data;
}

export async function getAuditEventCatalog(): Promise<IAuditEventCatalog> {
  const req = await api.post("/audit/events");
  return req.data;
}

export async function exportAuditLogs(filters: IAuditLogFilters): Promise<Blob> {
  // The interceptor returns the body directly for non-JSON responses.
  return (await api.post("/audit/export", filters, {
    responseType: "blob",
  })) as unknown as Blob;
}

export async function updateAuditRetention(retentionDays: number) {
  const req = await api.post("/audit/retention", { retentionDays });
  return req.data as { retentionDays: number };
}
