import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Menu,
  Modal,
  PasswordInput,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconDots,
  IconEdit,
  IconInfoCircle,
  IconPlugConnected,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import api from "@/lib/api-client";
import CopyTextButton from "@/components/common/copy.tsx";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";

export interface ISsoProvider {
  id: string;
  name: string;
  type: string;
  issuer: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  isEnabled: boolean;
  allowSignup: boolean;
  groupSync: boolean;
  groupsClaim: string;
  scopes: string;
  allowUnverifiedEmail: boolean;
  callbackUrl: string;
}

type ProviderForm = {
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  isEnabled: boolean;
  allowSignup: boolean;
  groupSync: boolean;
  groupsClaim: string;
  scopes: string;
  allowUnverifiedEmail: boolean;
};

const EMPTY_FORM: ProviderForm = {
  name: "",
  issuer: "",
  clientId: "",
  clientSecret: "",
  isEnabled: true,
  allowSignup: false,
  groupSync: false,
  groupsClaim: "groups",
  scopes: "",
  allowUnverifiedEmail: false,
};

const QUERY_KEY = ["sso-providers"];

function errorMessage(err: any, fallback: string) {
  return err?.response?.data?.message ?? fallback;
}

function ProviderModal({
  provider,
  opened,
  onClose,
}: {
  provider: ISsoProvider | null;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);

  useEffect(() => {
    if (!opened) return;
    setForm(
      provider
        ? {
            name: provider.name,
            issuer: provider.issuer ?? "",
            clientId: provider.clientId ?? "",
            clientSecret: "",
            isEnabled: provider.isEnabled,
            allowSignup: provider.allowSignup,
            groupSync: provider.groupSync,
            groupsClaim: provider.groupsClaim || "groups",
            scopes: provider.scopes ?? "",
            allowUnverifiedEmail: provider.allowUnverifiedEmail,
          }
        : EMPTY_FORM,
    );
  }, [opened, provider]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { ...form };
      if (provider) {
        payload.providerId = provider.id;
        // Blank keeps the stored secret.
        if (!form.clientSecret) delete payload.clientSecret;
        return api.post("/sso/providers/update", payload);
      }
      if (!form.clientSecret) delete payload.clientSecret;
      return api.post("/sso/providers/create", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      notifications.show({ message: t("SSO provider saved") });
      onClose();
    },
    onError: (err) =>
      notifications.show({
        message: errorMessage(err, t("Failed to update")),
        color: "red",
      }),
  });

  const set = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={provider ? t("Edit OIDC provider") : t("Add OIDC provider")}
      size="lg"
      centered
    >
      <Stack>
        <TextInput
          label={t("Display name")}
          description={t('Shown on the login button, e.g. "Okta" or "Company SSO".')}
          value={form.name}
          onChange={(e) => set("name", e.currentTarget.value)}
          required
          data-autofocus
        />
        <TextInput
          label={t("Issuer URL")}
          description={t("DocIt loads /.well-known/openid-configuration from this URL.")}
          placeholder="https://login.example.com/realms/acme"
          value={form.issuer}
          onChange={(e) => set("issuer", e.currentTarget.value)}
          required
        />
        <TextInput
          label={t("Client ID")}
          value={form.clientId}
          onChange={(e) => set("clientId", e.currentTarget.value)}
          required
        />
        <PasswordInput
          label={t("Client secret")}
          placeholder={
            provider?.hasClientSecret
              ? t("A secret is saved. Leave blank to keep it.")
              : t("Leave blank for public clients")
          }
          value={form.clientSecret}
          onChange={(e) => set("clientSecret", e.currentTarget.value)}
          autoComplete="off"
        />
        {provider && (
          <div>
            <Text size="sm" fw={500}>
              {t("Redirect URI")}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Code style={{ wordBreak: "break-all" }}>{provider.callbackUrl}</Code>
              <CopyTextButton text={provider.callbackUrl} />
            </Group>
          </div>
        )}
        <Switch
          label={t("Enabled")}
          checked={form.isEnabled}
          onChange={(e) => set("isEnabled", e.currentTarget.checked)}
        />
        <Checkbox
          label={t("Create accounts for new users")}
          description={t(
            "People without a DocIt account can sign up through this provider (approved email domains still apply).",
          )}
          checked={form.allowSignup}
          onChange={(e) => set("allowSignup", e.currentTarget.checked)}
        />
        <Checkbox
          label={t("Sync groups")}
          description={t(
            "Add users to DocIt groups whose names match the groups claim. Memberships are added, never removed.",
          )}
          checked={form.groupSync}
          onChange={(e) => set("groupSync", e.currentTarget.checked)}
        />
        {form.groupSync && (
          <TextInput
            label={t("Groups claim")}
            value={form.groupsClaim}
            onChange={(e) => set("groupsClaim", e.currentTarget.value)}
          />
        )}
        <TextInput
          label={t("Extra scopes")}
          description={t('Requested in addition to "openid email profile".')}
          placeholder="groups"
          value={form.scopes}
          onChange={(e) => set("scopes", e.currentTarget.value)}
        />
        <Checkbox
          label={t("Allow unverified email addresses")}
          description={t(
            "Only turn this on for providers that do not send email_verified. Linking accounts by unverified email is unsafe.",
          )}
          checked={form.allowUnverifiedEmail}
          onChange={(e) => set("allowUnverifiedEmail", e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!form.name.trim() || !form.issuer.trim() || !form.clientId.trim()}
          >
            {t("Save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function EnforceSsoToggle({ hasEnabledProvider }: { hasEnabledProvider: boolean }) {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [checked, setChecked] = useState(workspace?.enforceSso === true);

  const apply = async (value: boolean) => {
    try {
      const updated = await updateWorkspace({ enforceSso: value });
      setChecked(value);
      setWorkspace(updated);
    } catch (err) {
      notifications.show({
        message: errorMessage(err, t("Failed to update")),
        color: "red",
      });
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.checked;
    if (!value) return apply(false);
    modals.openConfirmModal({
      title: t("Enforce SSO"),
      centered: true,
      children: (
        <Text size="sm">
          {t(
            "Password sign-in will be turned off for everyone, including admins. Make sure SSO sign-in works for you first.",
          )}
        </Text>
      ),
      labels: { confirm: t("Enforce"), cancel: t("Cancel") },
      onConfirm: () => apply(true),
    });
  };

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{t("Enforce SSO")}</Text>
        <Text size="sm" c="dimmed">
          {t("Members can only sign in through an SSO provider.")}
        </Text>
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={!checked && !hasEnabledProvider}
        aria-label={t("Enforce SSO")}
      />
    </Group>
  );
}

export default function SsoSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ISsoProvider | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () =>
      (await api.post("/sso/providers")).data as {
        providers: ISsoProvider[];
        enforceSso: boolean;
      },
  });
  const providers = data?.providers ?? [];

  const test = async (p: ISsoProvider) => {
    const res = (await api.post("/sso/providers/test", { providerId: p.id }))
      .data;
    notifications.show(
      res.ok
        ? { message: t("Connected to {{issuer}}", { issuer: res.issuer }), color: "green" }
        : { message: res.error, color: "red" },
    );
  };

  const remove = (p: ISsoProvider) =>
    modals.openConfirmModal({
      title: t("Remove SSO provider"),
      centered: true,
      children: (
        <Text size="sm">
          {t("Users will no longer be able to sign in with {{name}}.", { name: p.name })}
        </Text>
      ),
      labels: { confirm: t("Remove"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await api.post("/sso/providers/delete", { providerId: p.id });
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        } catch (err) {
          notifications.show({
            message: errorMessage(err, t("Failed to update")),
            color: "red",
          });
        }
      },
    });

  return (
    <Stack gap="lg">
      <Alert variant="light" color="blue" icon={<IconInfoCircle />}>
        {t(
          "Connect any OpenID Connect provider (Okta, Microsoft Entra ID, Google Workspace, Keycloak, Authentik, Auth0, and others). Register DocIt at the provider as a web application using the redirect URI shown after you add it.",
        )}
      </Alert>

      <EnforceSsoToggle
        hasEnabledProvider={providers.some((p) => p.isEnabled && p.type === "oidc")}
      />

      <Group justify="space-between">
        <Text fw={600}>{t("Providers")}</Text>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          {t("Add OIDC provider")}
        </Button>
      </Group>

      {providers.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center">
          {t("No SSO providers yet")}
        </Text>
      ) : (
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Name")}</Table.Th>
              <Table.Th>{t("Issuer")}</Table.Th>
              <Table.Th>{t("Status")}</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {providers.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {p.name}
                  </Text>
                  <Group gap={4}>
                    <Badge size="xs" variant="outline">
                      {p.type.toUpperCase()}
                    </Badge>
                    {p.allowSignup && (
                      <Badge size="xs" variant="light" color="gray">
                        {t("Sign-up")}
                      </Badge>
                    )}
                    {p.groupSync && (
                      <Badge size="xs" variant="light" color="gray">
                        {t("Group sync")}
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed" lineClamp={1}>
                    {p.issuer}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge color={p.isEnabled ? "green" : "gray"} variant="light">
                    {p.isEnabled ? t("Enabled") : t("Disabled")}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="gray" aria-label={t("Provider menu")}>
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {p.type === "oidc" && (
                        <>
                          <Menu.Item
                            leftSection={<IconEdit size={14} />}
                            onClick={() => {
                              setEditing(p);
                              setModalOpen(true);
                            }}
                          >
                            {t("Edit")}
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconPlugConnected size={14} />}
                            onClick={() => test(p)}
                          >
                            {t("Test connection")}
                          </Menu.Item>
                        </>
                      )}
                      <Menu.Item
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => remove(p)}
                      >
                        {t("Remove")}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <ProviderModal
        provider={editing}
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </Stack>
  );
}
