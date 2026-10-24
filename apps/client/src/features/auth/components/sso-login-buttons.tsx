import { Alert, Button, Divider, Stack } from "@mantine/core";
import { IconKey } from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { IPublicWorkspace } from "@/features/workspace/types/workspace.types.ts";

type Props = {
  workspace?: IPublicWorkspace;
  /** Show the "or" divider above the password form. */
  withDivider: boolean;
};

/** "Continue with <provider>" buttons for the workspace's OIDC providers. */
export function SsoLoginButtons({ workspace, withDivider }: Props) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const error = params.get("ssoError");
  const redirect = params.get("redirect");
  const providers = (workspace?.authProviders ?? []).filter(
    (p) => p.type === "oidc",
  );

  if (!providers.length && !error) return null;

  const loginUrl = (id: string) => {
    const query = redirect ? `?redirect=${encodeURIComponent(redirect)}` : "";
    return `/api/sso/oidc/${id}/login${query}`;
  };

  return (
    <Stack gap="sm" mb="md">
      {error && (
        <Alert color="red" variant="light" role="alert">
          {error}
        </Alert>
      )}
      {providers.map((p) => (
        <Button
          key={p.id}
          component="a"
          href={loginUrl(p.id)}
          variant="default"
          fullWidth
          leftSection={<IconKey size={16} />}
        >
          {t("Continue with {{provider}}", { provider: p.name })}
        </Button>
      ))}
      {withDivider && providers.length > 0 && (
        <Divider label={t("or")} labelPosition="center" />
      )}
    </Stack>
  );
}
