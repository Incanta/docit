import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import useUserRole from "@/hooks/use-user-role.tsx";
import SsoSettings from "@/features/sso/sso-settings.tsx";

export default function Sso() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  if (!isAdmin) return null;
  return (
    <>
      <DocumentTitle title={t("Single sign-on")} />
      <SettingsTitle title={t("Single sign-on")} />
      <SsoSettings />
    </>
  );
}
