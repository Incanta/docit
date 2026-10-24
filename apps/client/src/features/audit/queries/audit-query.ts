import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  getAuditEventCatalog,
  getAuditLogs,
} from "@/features/audit/services/audit-service.ts";
import { IAuditLogFilters } from "@/features/audit/types/audit.types.ts";

export function useAuditLogsQuery(filters: IAuditLogFilters) {
  return useInfiniteQuery({
    queryKey: ["audit-logs", filters],
    queryFn: ({ pageParam }) =>
      getAuditLogs({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNextPage ? lastPage.meta.nextCursor : undefined,
  });
}

export function useAuditEventCatalogQuery() {
  return useQuery({
    queryKey: ["audit-event-catalog"],
    queryFn: () => getAuditEventCatalog(),
    staleTime: 10 * 60 * 1000,
  });
}
