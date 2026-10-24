import { useState } from "react";
import { Button, Group, NumberInput, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateAuditRetention } from "@/features/audit/services/audit-service.ts";

export default function AuditRetention() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const initial = workspace?.auditRetentionDays ?? 0;
  const [days, setDays] = useState<number>(initial);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateAuditRetention(days);
      setWorkspace({ ...workspace, auditRetentionDays: days || null });
      notifications.show({ message: t("Updated successfully") });
    } catch (err) {
      notifications.show({
        message: err?.response?.data?.message ?? t("Failed to update"),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl" mb="lg">
      <div>
        <Text size="md">{t("Log retention")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Number of days to keep audit events. Use 0 to keep them forever.",
          )}
        </Text>
      </div>
      <Group gap="xs" wrap="nowrap">
        <NumberInput
          value={days}
          onChange={(v) => setDays(Number(v) || 0)}
          min={0}
          max={3650}
          w={110}
          suffix={` ${t("days")}`}
          aria-label={t("Log retention")}
        />
        <Button
          variant="default"
          onClick={save}
          loading={saving}
          disabled={days === initial}
        >
          {t("Save")}
        </Button>
      </Group>
    </Group>
  );
}
