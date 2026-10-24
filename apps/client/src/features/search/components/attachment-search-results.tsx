import {
  ActionIcon,
  Badge,
  Center,
  Group,
  Text,
  Tooltip,
  getDefaultZIndex,
} from "@mantine/core";
import { Spotlight } from "@mantine/spotlight";
import { IconDownload, IconFileText, IconFileTypePdf } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import DOMPurify from "dompurify";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "@/lib/api-client";
import { buildPageUrl } from "@/features/page/page.utils";
import { timeAgo } from "@/lib/time.ts";

export interface IAttachmentSearchResult {
  id: string;
  fileName: string;
  fileExt: string;
  updatedAt: string;
  highlight: string;
  page: { id: string; slugId: string; title: string | null };
  space: { id: string; name: string | null; slug: string };
}

async function searchAttachments(params: {
  query: string;
  spaceId?: string;
}): Promise<IAttachmentSearchResult[]> {
  const req = await api.post("/search/attachments", { ...params, limit: 8 });
  return req.data.items;
}

export function useAttachmentSearch(
  params: { query: string; spaceId?: string },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["attachment-search", params],
    queryFn: () => searchAttachments(params),
    enabled: enabled && params.query.trim().length > 1,
    placeholderData: (prev) => (params.query ? prev : undefined),
  });
}

const makeActionTabbable = (el: HTMLElement | null) => {
  if (el) el.tabIndex = 0;
};

function AttachmentResultItem({
  result,
  showSpace,
}: {
  result: IAttachmentSearchResult;
  showSpace: boolean;
}) {
  const { t } = useTranslation();
  const Icon = result.fileExt === ".pdf" ? IconFileTypePdf : IconFileText;

  const download = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(
      `/api/files/${result.id}/${encodeURIComponent(result.fileName)}`,
      "_blank",
    );
  };

  return (
    <Spotlight.Action
      component={Link}
      ref={makeActionTabbable}
      //@ts-ignore
      to={buildPageUrl(result.space.slug, result.page.slugId, result.page.title)}
      style={{ userSelect: "none" }}
    >
      <Group wrap="nowrap" w="100%">
        <Center>
          <Icon size={18} stroke={1.5} />
        </Center>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Text truncate>{result.fileName}</Text>
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {timeAgo(new Date(result.updatedAt))}
            </Text>
          </Group>
          <Group gap={6}>
            <Text size="xs" c="dimmed" truncate>
              {t("In {{page}}", { page: result.page.title || t("Untitled") })}
            </Text>
            {showSpace && result.space.name && (
              <Badge variant="light" size="xs" color="gray">
                {result.space.name}
              </Badge>
            )}
          </Group>
          {result.highlight && (
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
        <Tooltip
          label={t("Download attachment")}
          zIndex={getDefaultZIndex("max")}
          withArrow
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={download}
            aria-label={t("Download attachment")}
          >
            <IconDownload size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Spotlight.Action>
  );
}

export function AttachmentSearchResults({
  results,
  showSpace,
}: {
  results: IAttachmentSearchResult[];
  showSpace: boolean;
}) {
  const { t } = useTranslation();
  if (!results.length) return null;
  return (
    <Spotlight.ActionsGroup label={t("Files")}>
      {results.map((r) => (
        <AttachmentResultItem key={r.id} result={r} showSpace={showSpace} />
      ))}
    </Spotlight.ActionsGroup>
  );
}
