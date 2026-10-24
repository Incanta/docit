import { Spotlight } from "@mantine/spotlight";
import { IconSearch, IconSparkles } from "@tabler/icons-react";
import { Group, VisuallyHidden, Text } from "@mantine/core";
import React, { useState, useMemo, useCallback } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { searchSpotlight, searchSpotlightStore } from "../constants.ts";
import { useAiStatusQuery } from "@/features/ai/queries/ai-query.ts";
import { AiAnswerPanel } from "@/features/ai/components/ai-answer-panel.tsx";
import { SearchSpotlightFilters } from "./search-spotlight-filters.tsx";
import { useUnifiedSearch } from "../hooks/use-unified-search.ts";
import { SearchResultItem } from "./search-result-item.tsx";
import {
  AttachmentSearchResults,
  useAttachmentSearch,
} from "./attachment-search-results.tsx";

interface SearchSpotlightProps {
  spaceId?: string;
}
export function SearchSpotlight({ spaceId }: SearchSpotlightProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedSearchQuery] = useDebouncedValue(query, 300);
  const [aiQuestion, setAiQuestion] = useState<string | null>(null);
  const { data: aiStatus } = useAiStatusQuery();
  const aiAnswers = aiStatus?.answers === true;
  const [filters, setFilters] = useState<{
    spaceId?: string | null;
    creatorId?: string | null;
    labelIds?: string[];
    titleOnly?: boolean;
  }>({});

  const searchParams = useMemo(() => {
    const params: any = {
      query: debouncedSearchQuery,
    };

    // Only pass spaceId if a specific space is selected
    if (filters.spaceId) {
      params.spaceId = filters.spaceId;
    }

    if (filters.creatorId) {
      params.creatorId = filters.creatorId;
    }

    if (filters.labelIds?.length) {
      params.labelIds = filters.labelIds;
    }

    if (filters.titleOnly) {
      params.titleOnly = true;
    }

    return params;
  }, [debouncedSearchQuery, filters]);

  const { data: searchResults, isFetching } = useUnifiedSearch(searchParams);
  // Files only match on text; skip them in label/creator browse and title-only mode.
  const { data: attachmentResults } = useAttachmentSearch(
    {
      query: debouncedSearchQuery,
      spaceId: filters.spaceId ?? undefined,
    },
    !filters.titleOnly && !filters.labelIds?.length && !filters.creatorId,
  );
  const fileResults = (debouncedSearchQuery && attachmentResults) || [];

  const isFilterBrowse =
    (filters.labelIds?.length ?? 0) > 0 || !!filters.creatorId;
  // while the debounce is pending the empty list is not a settled "no results"
  const isQuerySettled = query === debouncedSearchQuery;

  const resultItems = (searchResults || []).map((result) => (
    <SearchResultItem
      key={result.id}
      result={result}
      showSpace={!filters.spaceId}
    />
  ));

  const handleFiltersChange = useCallback((newFilters: any) => {
    setFilters(newFilters);
  }, [setFilters]);

  return (
    <>
      <Spotlight.Root
        size="xl"
        maxHeight={600}
        store={searchSpotlightStore}
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          setAiQuestion(null);
        }}
        onSpotlightClose={() => setAiQuestion(null)}
        scrollable
        overlayProps={{
          backgroundOpacity: 0.55,
        }}
      >
        <Group gap="xs" px="sm" pt="sm" pb="xs">
          <Spotlight.Search
            placeholder={t("Search...")}
            aria-label={t("Search")}
            leftSection={<IconSearch size={20} stroke={1.5} />}
            style={{ flex: 1 }}
          />
        </Group>

        <div
          style={{
            padding: "4px 16px",
          }}
        >
          <SearchSpotlightFilters
            onFiltersChange={handleFiltersChange}
            spaceId={spaceId}
          />
        </div>

        <VisuallyHidden role="status" aria-live="polite">
          {(query.length > 0 || isFilterBrowse) && !isFetching
            ? resultItems.length === 0
              ? t("No results found")
              : t("{{count}} results found", { count: resultItems.length })
            : ""}
        </VisuallyHidden>

        {aiQuestion ? (
          <AiAnswerPanel
            question={aiQuestion}
            spaceId={filters.spaceId ?? undefined}
            onBack={() => setAiQuestion(null)}
            onNavigate={() => searchSpotlight.close()}
          />
        ) : (
        <Spotlight.ActionsList>
          {aiAnswers && query.trim().length > 2 && (
            <Spotlight.Action
              onClick={() => setAiQuestion(query.trim())}
              closeSpotlightOnTrigger={false}
            >
              <Group wrap="nowrap" gap="sm">
                <IconSparkles
                  size={18}
                  color="var(--mantine-color-violet-6)"
                />
                <Text size="sm" truncate>
                  {t("Ask AI")}: <b>{query.trim()}</b>
                </Text>
              </Group>
            </Spotlight.Action>
          )}

          {query.length === 0 && !isFilterBrowse && resultItems.length === 0 && (
            <Spotlight.Empty>{t("Start typing to search...")}</Spotlight.Empty>
          )}

          {(query.length > 0 || isFilterBrowse) &&
            !isFetching &&
            isQuerySettled &&
            resultItems.length === 0 &&
            fileResults.length === 0 && (
              <Spotlight.Empty>{t("No results found...")}</Spotlight.Empty>
            )}

          {resultItems.length > 0 && <>{resultItems}</>}

          <AttachmentSearchResults
            results={fileResults}
            showSpace={!filters.spaceId}
          />

          {(query.length > 0 || isFilterBrowse) &&
            isFetching &&
            resultItems.length === 0 && (
            <Spotlight.Empty>
              <Text size="sm" style={{ marginTop: 10 }}>
                {t("Searching...")}
              </Text>
            </Spotlight.Empty>
          )}
        </Spotlight.ActionsList>
        )}
      </Spotlight.Root>
    </>
  );
}
