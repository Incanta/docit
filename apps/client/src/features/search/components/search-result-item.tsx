import { Group, Center, Text, Badge } from "@mantine/core";
import { Spotlight } from "@mantine/spotlight";
import { Link } from "react-router-dom";
import { buildPageUrl } from "@/features/page/page.utils";
import { getPageIcon } from "@/lib";
import { IPageSearch } from "@/features/search/types/search.types";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { timeAgo } from "@/lib/time.ts";

interface SearchResultItemProps {
  result: IPageSearch;
  showSpace?: boolean;
}

// Spotlight hardcodes tabIndex={-1} after spreading props; a ref wins and
// React never writes -1 back because the prop value never changes
const makeActionTabbable = (el: HTMLElement | null) => {
  if (el) {
    el.tabIndex = 0;
  }
};

export function SearchResultItem({ result, showSpace }: SearchResultItemProps) {
  const { t } = useTranslation();

  return (
    <Spotlight.Action
      component={Link}
      ref={makeActionTabbable}
      //@ts-ignore
      to={buildPageUrl(
        result.space.slug,
        result.slugId,
        result.title,
        undefined,
        result.matchedText,
        result.wholeWord
      )}
      style={{ userSelect: "none" }}
    >
      <Group wrap="nowrap" w="100%">
        <Center>{getPageIcon(result?.icon)}</Center>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Text truncate>{result.title || t("Untitled")}</Text>
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {timeAgo(result.updatedAt)}
            </Text>
          </Group>

          {showSpace && result.space && (
            <Badge variant="light" size="xs" color="gray">
              {result.space.name}
            </Badge>
          )}

          {result?.highlight && (
            <Text
              opacity={0.6}
              size="xs"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(result.highlight, {
                  ALLOWED_TAGS: ["mark", "em", "strong", "b"],
                  ALLOWED_ATTR: [],
                }),
              }}
            />
          )}
        </div>
      </Group>
    </Spotlight.Action>
  );
}
