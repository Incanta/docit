import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { searchPage } from "@/features/search/services/search-service";
import {
  IPageSearch,
  IPageSearchParams,
} from "@/features/search/types/search.types";

export function useUnifiedSearch(
  params: IPageSearchParams,
  enabled: boolean = true,
): UseQueryResult<IPageSearch[], Error> {
  return useQuery({
    queryKey: ["unified-search", params],
    queryFn: () => searchPage(params),
    enabled:
      (!!params.query ||
        (params.labelIds?.length ?? 0) > 0 ||
        !!params.creatorId) &&
      enabled,
    placeholderData: (previousData) => {
      if (!params.query && !params.labelIds?.length && !params.creatorId)
        return undefined;
      return previousData;
    },
  });
}
