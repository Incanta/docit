import { useQuery } from "@tanstack/react-query";
import { getAiSettings, getAiStatus } from "@/features/ai/services/ai-service.ts";

export function useAiStatusQuery(enabled = true) {
  return useQuery({
    queryKey: ["ai-status"],
    queryFn: () => getAiStatus(),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useAiSettingsQuery() {
  return useQuery({
    queryKey: ["ai-settings"],
    queryFn: () => getAiSettings(),
  });
}
