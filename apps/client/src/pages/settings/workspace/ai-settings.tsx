import { useState } from "react";
import { Divider, Group, Loader, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import useUserRole from "@/hooks/use-user-role.tsx";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { useAiSettingsQuery } from "@/features/ai/queries/ai-query.ts";
import AiProviderForm from "@/features/ai/components/ai-provider-form.tsx";

function FeatureToggle({
  field,
  setting,
  label,
  description,
}: {
  field: "generativeAi" | "aiSearch";
  setting: "generative" | "search";
  label: string;
  description: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [checked, setChecked] = useState(
    workspace?.settings?.ai?.[setting] === true,
  );

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.checked;
    try {
      const updated = await updateWorkspace({ [field]: value });
      setChecked(value);
      setWorkspace(updated);
      queryClient.invalidateQueries({ queryKey: ["ai-status"] });
    } catch (err) {
      notifications.show({
        message: err?.response?.data?.message ?? t("Failed to update"),
        color: "red",
      });
    }
  };

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{label}</Text>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </div>
      <Switch checked={checked} onChange={onChange} aria-label={label} />
    </Group>
  );
}

export default function AiSettings() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const { data, isLoading } = useAiSettingsQuery();

  if (!isAdmin) return null;

  return (
    <>
      <DocumentTitle title={t("AI")} />
      <SettingsTitle title={t("AI")} />

      <FeatureToggle
        field="generativeAi"
        setting="generative"
        label={t("AI writing assistant")}
        description={t(
          "Members can ask AI to write, rewrite, summarize, and translate content in the editor.",
        )}
      />
      <Divider my="md" />
      <FeatureToggle
        field="aiSearch"
        setting="search"
        label={t("AI search and answers")}
        description={t(
          "Members can ask questions in search and get answers with sources, drawn only from pages they can read.",
        )}
      />
      <Divider my="lg" />

      {isLoading || !data ? (
        <Loader size="sm" />
      ) : (
        <AiProviderForm data={data} />
      )}
    </>
  );
}
