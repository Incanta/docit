import { Divider } from "@mantine/core";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import useUserRole from "@/hooks/use-user-role.tsx";
import AuditLogTable from "@/features/audit/components/audit-log-table.tsx";
import AuditRetention from "@/features/audit/components/audit-retention.tsx";

export default function AuditLogs() {
  const { t } = useTranslation();
  const { isOwner } = useUserRole();

  if (!isOwner) return null;

  return (
    <>
      <DocumentTitle title={t("Audit log")} />
      <SettingsTitle title={t("Audit log")} />
      <AuditRetention />
      <Divider mb="lg" />
      <AuditLogTable />
    </>
  );
}
