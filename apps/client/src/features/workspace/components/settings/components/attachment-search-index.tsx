import { useState } from "react";
import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import api from "@/lib/api-client";
import useUserRole from "@/hooks/use-user-role.tsx";

/** Lets admins extract text from attachments uploaded before indexing existed. */
export default function AttachmentSearchIndex() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const [loading, setLoading] = useState(false);

  if (!isAdmin) return null;

  const reindex = async () => {
    setLoading(true);
    try {
      await api.post("/search/attachments/reindex", {});
      notifications.show({
        message: t("Indexing started. Files become searchable as they finish."),
      });
    } catch (err) {
      notifications.show({
        message: err?.response?.data?.message ?? t("Failed to update"),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{t("Search inside attachments")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Text in PDF, Word (DOCX), Markdown, CSV, and text files is searchable. New uploads are indexed automatically; index existing files once after upgrading.",
          )}
        </Text>
      </div>
      <Button variant="default" onClick={reindex} loading={loading}>
        {t("Index existing files")}
      </Button>
    </Group>
  );
}
