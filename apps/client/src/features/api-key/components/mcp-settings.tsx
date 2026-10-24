import { useState } from "react";
import { Code, Group, Stack, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { getAppUrl } from "@/lib/config.ts";
import CopyTextButton from "@/components/common/copy.tsx";
import useUserRole from "@/hooks/use-user-role.tsx";

export default function McpSettings() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [enabled, setEnabled] = useState(workspace?.settings?.ai?.mcp === true);

  const endpoint = `${getAppUrl()}/mcp`;
  const claudeCommand = `claude mcp add --transport http docit ${endpoint} --header "Authorization: Bearer <api-key>"`;
  const jsonConfig = JSON.stringify(
    {
      mcpServers: {
        docit: {
          type: "http",
          url: endpoint,
          headers: { Authorization: "Bearer <api-key>" },
        },
      },
    },
    null,
    2,
  );

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.checked;
    try {
      const updated = await updateWorkspace({ mcpEnabled: value });
      setEnabled(value);
      setWorkspace(updated);
    } catch (err) {
      notifications.show({
        message: err?.response?.data?.message,
        color: "red",
      });
    }
  };

  if (!isAdmin && !enabled) return null;

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap" gap="xl">
        <div>
          <Text size="md">{t("MCP server")}</Text>
          <Text size="sm" c="dimmed">
            {t(
              "Let AI tools such as Claude, Cursor, or VS Code read and edit pages through the Model Context Protocol, authenticated with an API key.",
            )}
          </Text>
        </div>
        {isAdmin && (
          <Switch
            checked={enabled}
            onChange={onChange}
            aria-label={t("Toggle MCP server")}
          />
        )}
      </Group>

      {enabled && (
        <>
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" fw={500}>
              {t("Endpoint")}
            </Text>
            <Code>{endpoint}</Code>
            <CopyTextButton text={endpoint} />
          </Group>
          <Text size="sm" c="dimmed">
            {t(
              "Tools are limited to the scopes of the API key used to connect. Claude Code:",
            )}
          </Text>
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <Code block style={{ flex: 1, whiteSpace: "pre-wrap" }}>
              {claudeCommand}
            </Code>
            <CopyTextButton text={claudeCommand} />
          </Group>
          <Text size="sm" c="dimmed">
            {t("Other clients (JSON config):")}
          </Text>
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <Code block style={{ flex: 1 }}>
              {jsonConfig}
            </Code>
            <CopyTextButton text={jsonConfig} />
          </Group>
        </>
      )}
    </Stack>
  );
}
