import { Fragment, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  MultiSelect,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import {
  IconChevronDown,
  IconChevronRight,
  IconDownload,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import {
  useAuditEventCatalogQuery,
  useAuditLogsQuery,
} from "@/features/audit/queries/audit-query.ts";
import {
  IAuditLog,
  IAuditLogFilters,
} from "@/features/audit/types/audit.types.ts";
import { exportAuditLogs } from "@/features/audit/services/audit-service.ts";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";

type DateRange = [Date | string | null, Date | string | null];

function toIso(value: Date | string | null, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function AuditLogTable() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<string[]>([]);
  const [actorType, setActorType] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>([null, null]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState(false);

  const filters: IAuditLogFilters = useMemo(
    () => ({
      events: events.length ? events : undefined,
      actorType: actorType ?? undefined,
      startDate: toIso(range[0]),
      endDate: toIso(range[1], true),
    }),
    [events, actorType, range],
  );

  const { data: catalog } = useAuditEventCatalogQuery();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAuditLogsQuery(filters);
  const rows = data?.pages.flatMap((p) => p.items) ?? [];

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportAuditLogs(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${format(new Date(), "yyyy-MM-dd")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      notifications.show({ message: t("Export failed"), color: "red" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Stack gap="md">
      <Group align="flex-end" gap="sm" wrap="wrap">
        <MultiSelect
          label={t("Events")}
          placeholder={events.length ? undefined : t("All events")}
          data={catalog?.events ?? []}
          value={events}
          onChange={setEvents}
          searchable
          clearable
          maxDropdownHeight={280}
          w={280}
        />
        <Select
          label={t("Actor")}
          placeholder={t("Any")}
          data={[
            { value: "user", label: t("User") },
            { value: "api_key", label: t("API key") },
            { value: "system", label: t("System") },
          ]}
          value={actorType}
          onChange={(v) => setActorType(v as string | null)}
          clearable
          w={140}
        />
        <DatePickerInput
          type="range"
          label={t("Date range")}
          placeholder={t("Any time")}
          value={range}
          onChange={(v) => setRange(v as DateRange)}
          clearable
          w={240}
        />
        <Box style={{ flex: 1 }} />
        <Button
          variant="default"
          leftSection={<IconDownload size={16} />}
          onClick={handleExport}
          loading={exporting}
        >
          {t("Export CSV")}
        </Button>
      </Group>

      <Table.ScrollContainer minWidth={760}>
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={32} />
              <Table.Th>{t("Event")}</Table.Th>
              <Table.Th>{t("Actor")}</Table.Th>
              <Table.Th>{t("Resource")}</Table.Th>
              <Table.Th>{t("IP address")}</Table.Th>
              <Table.Th>{t("Date")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((log) => (
              <Fragment key={log.id}>
                <Table.Tr
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    setExpanded((s) => ({ ...s, [log.id]: !s[log.id] }))
                  }
                >
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      aria-label={t("Show details")}
                    >
                      {expanded[log.id] ? (
                        <IconChevronDown size={14} />
                      ) : (
                        <IconChevronRight size={14} />
                      )}
                    </ActionIcon>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" radius="sm" tt="none">
                      {log.event}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <ActorCell log={log} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{log.resourceType}</Text>
                    {log.space && (
                      <Text size="xs" c="dimmed">
                        {log.space.name}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {log.ipAddress ?? "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label={new Date(log.createdAt).toISOString()}>
                      <Text size="sm">
                        {format(new Date(log.createdAt), "PP p")}
                      </Text>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
                {expanded[log.id] && (
                  <Table.Tr>
                    <Table.Td />
                    <Table.Td colSpan={5}>
                      <AuditDetails log={log} />
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {isLoading && (
        <Group justify="center">
          <Loader size="sm" />
        </Group>
      )}

      {!isLoading && rows.length === 0 && (
        <Text c="dimmed" ta="center" size="sm">
          {t("No audit events found")}
        </Text>
      )}

      {hasNextPage && (
        <Group justify="center">
          <Button
            variant="default"
            onClick={() => fetchNextPage()}
            loading={isFetchingNextPage}
          >
            {t("Load more")}
          </Button>
        </Group>
      )}
    </Stack>
  );
}

function ActorCell({ log }: { log: IAuditLog }) {
  const { t } = useTranslation();
  if (log.actor) {
    return (
      <Group gap="xs" wrap="nowrap">
        <CustomAvatar
          size="sm"
          avatarUrl={log.actor.avatarUrl}
          name={log.actor.name}
        />
        <div>
          <Text size="sm" lineClamp={1}>
            {log.actor.name}
            {log.actorType === "api_key" && (
              <Badge ml={6} size="xs" variant="outline">
                {t("API key")}
              </Badge>
            )}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {log.actor.email}
          </Text>
        </div>
      </Group>
    );
  }
  return (
    <Text size="sm" c="dimmed">
      {log.actorType === "system" ? t("System") : t("Unknown")}
    </Text>
  );
}

function AuditDetails({ log }: { log: IAuditLog }) {
  const { t } = useTranslation();
  const details = {
    resourceId: log.resourceId ?? undefined,
    changes: log.changes ?? undefined,
    metadata: log.metadata ?? undefined,
    userAgent: log.userAgent ?? undefined,
  };
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        {t("Event ID")}: {log.id}
      </Text>
      <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {JSON.stringify(details, null, 2)}
      </Code>
    </Stack>
  );
}
