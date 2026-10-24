import { useState } from "react";
import {
  Alert,
  Button,
  Divider,
  Group,
  SegmentedControl,
  Switch,
  Text,
} from "@mantine/core";
import { IconInfoCircle, IconPlus } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import useUserRole from "@/hooks/use-user-role.tsx";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { useApiKeysQuery } from "@/features/api-key/queries/api-key-query.ts";
import ApiKeyTable from "@/features/api-key/components/api-key-table.tsx";
import CreateApiKeyModal from "@/features/api-key/components/create-api-key-modal.tsx";

function RestrictToAdminsToggle() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [checked, setChecked] = useState(
    workspace?.settings?.api?.restrictToAdmins === true,
  );

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.checked;
    try {
      const updated = await updateWorkspace({ restrictApiToAdmins: value });
      setChecked(value);
      setWorkspace(updated);
    } catch (err) {
      notifications.show({
        message: err?.response?.data?.message,
        color: "red",
      });
    }
  };

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{t("Restrict API keys to admins")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Only workspace admins can create and use API keys. Keys owned by members stop working while this is on.",
          )}
        </Text>
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        aria-label={t("Restrict API keys to admins")}
      />
    </Group>
  );
}

export default function ApiKeys() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const [workspace] = useAtom(workspaceAtom);
  const [view, setView] = useState<"mine" | "all">("mine");
  const [createOpen, setCreateOpen] = useState(false);
  const { data } = useApiKeysQuery(isAdmin && view === "all");

  const restricted = workspace?.settings?.api?.restrictToAdmins === true;
  const canCreate = isAdmin || !restricted;

  return (
    <>
      <DocumentTitle title={t("API keys")} />
      <SettingsTitle title={t("API keys")} />

      <Alert variant="light" color="blue" icon={<IconInfoCircle />} mb="md">
        {t(
          "API keys let scripts and tools such as MCP clients call DocIt as you. Use the narrowest scopes that work.",
        )}
      </Alert>

      {isAdmin && (
        <>
          <RestrictToAdminsToggle />
          <Divider my="lg" />
        </>
      )}

      <Group justify="space-between" mb="md">
        {isAdmin ? (
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as "mine" | "all")}
            data={[
              { value: "mine", label: t("My keys") },
              { value: "all", label: t("All keys") },
            ]}
          />
        ) : (
          <div />
        )}
        {canCreate && (
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => setCreateOpen(true)}
          >
            {t("Create API key")}
          </Button>
        )}
      </Group>

      {!canCreate && (
        <Text size="sm" c="dimmed" mb="md">
          {t("API keys are restricted to workspace admins.")}
        </Text>
      )}

      <ApiKeyTable
        apiKeys={data?.items ?? []}
        showCreator={isAdmin && view === "all"}
      />

      <CreateApiKeyModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}
