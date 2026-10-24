import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconDots, IconEdit, IconTrash } from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import { useTranslation } from "react-i18next";
import { format, formatDistanceToNow } from "date-fns";
import {
  useRevokeApiKeyMutation,
  useUpdateApiKeyMutation,
} from "@/features/api-key/queries/api-key-query.ts";
import { IApiKey } from "@/features/api-key/types/api-key.types.ts";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";

interface Props {
  apiKeys: IApiKey[];
  showCreator: boolean;
}

function ScopeBadges({ scopes }: { scopes: string[] | null }) {
  const { t } = useTranslation();
  if (!scopes) {
    return (
      <Badge variant="light" color="orange" size="sm">
        {t("Full access")}
      </Badge>
    );
  }
  // Show write scopes and reads that have no matching write.
  const shown = scopes.filter(
    (s) =>
      s.endsWith(":write") ||
      !scopes.includes(s.replace(/:read$/, ":write")),
  );
  return (
    <Group gap={4}>
      {shown.map((s) => (
        <Badge
          key={s}
          size="sm"
          variant="light"
          color={s.endsWith(":write") ? "blue" : "gray"}
          tt="none"
        >
          {s}
        </Badge>
      ))}
    </Group>
  );
}

export default function ApiKeyTable({ apiKeys, showCreator }: Props) {
  const { t } = useTranslation();
  const revokeMutation = useRevokeApiKeyMutation();
  const updateMutation = useUpdateApiKeyMutation();
  const [renaming, setRenaming] = useState<IApiKey | null>(null);
  const [newName, setNewName] = useState("");

  const confirmRevoke = (apiKey: IApiKey) =>
    modals.openConfirmModal({
      title: t("Revoke API key"),
      centered: true,
      children: (
        <Text size="sm">
          {t(
            "Applications using this key will stop working immediately. This cannot be undone.",
          )}
        </Text>
      ),
      labels: { confirm: t("Revoke"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => revokeMutation.mutate(apiKey.id),
    });

  const isExpired = (k: IApiKey) =>
    k.expiresAt && new Date(k.expiresAt).getTime() < Date.now();

  if (apiKeys.length === 0) {
    return (
      <Text c="dimmed" size="sm" ta="center" py="lg">
        {t("No API keys yet")}
      </Text>
    );
  }

  return (
    <>
      <Table.ScrollContainer minWidth={700}>
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Name")}</Table.Th>
              {showCreator && <Table.Th>{t("Owner")}</Table.Th>}
              <Table.Th>{t("Scopes")}</Table.Th>
              <Table.Th>{t("Last used")}</Table.Th>
              <Table.Th>{t("Expires")}</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {apiKeys.map((k) => (
              <Table.Tr key={k.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {k.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("Created")} {format(new Date(k.createdAt), "PP")}
                  </Text>
                </Table.Td>
                {showCreator && (
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <CustomAvatar
                        size="sm"
                        avatarUrl={k.creator?.avatarUrl}
                        name={k.creator?.name}
                      />
                      <Text size="sm" lineClamp={1}>
                        {k.creator?.name}
                      </Text>
                    </Group>
                  </Table.Td>
                )}
                <Table.Td>
                  <ScopeBadges scopes={k.scopes} />
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {k.lastUsedAt
                      ? formatDistanceToNow(new Date(k.lastUsedAt), {
                          addSuffix: true,
                        })
                      : t("Never")}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {isExpired(k) ? (
                    <Badge color="red" variant="light" size="sm">
                      {t("Expired")}
                    </Badge>
                  ) : (
                    <Tooltip
                      label={k.expiresAt ? new Date(k.expiresAt).toString() : ""}
                      disabled={!k.expiresAt}
                    >
                      <Text size="sm">
                        {k.expiresAt
                          ? format(new Date(k.expiresAt), "PP")
                          : t("Never")}
                      </Text>
                    </Tooltip>
                  )}
                </Table.Td>
                <Table.Td>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label={t("API key menu")}
                      >
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<IconEdit size={14} />}
                        onClick={() => {
                          setRenaming(k);
                          setNewName(k.name);
                        }}
                      >
                        {t("Rename")}
                      </Menu.Item>
                      <Menu.Item
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => confirmRevoke(k)}
                      >
                        {t("Revoke")}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Modal
        opened={!!renaming}
        onClose={() => setRenaming(null)}
        title={t("Rename API key")}
        centered
      >
        <TextInput
          value={newName}
          onChange={(e) => setNewName(e.currentTarget.value)}
          data-autofocus
        />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setRenaming(null)}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={!newName.trim()}
            loading={updateMutation.isPending}
            onClick={async () => {
              await updateMutation.mutateAsync({
                apiKeyId: renaming.id,
                name: newName,
              });
              setRenaming(null);
            }}
          >
            {t("Save")}
          </Button>
        </Group>
      </Modal>
    </>
  );
}
