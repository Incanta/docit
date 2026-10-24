import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Code,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { addDays } from "date-fns";
import CopyTextButton from "@/components/common/copy.tsx";
import { useCreateApiKeyMutation } from "@/features/api-key/queries/api-key-query.ts";
import {
  API_KEY_RESOURCES,
  ICreatedApiKey,
} from "@/features/api-key/types/api-key.types.ts";

const RESOURCE_LABELS: Record<string, string> = {
  pages: "Pages",
  comments: "Comments",
  spaces: "Spaces",
  search: "Search",
  attachments: "Attachments",
  users: "Users",
  workspace: "Workspace",
  ai: "AI",
};

const DEFAULT_SCOPES = ["pages:read", "spaces:read", "search:read"];

interface Props {
  opened: boolean;
  onClose: () => void;
}

export default function CreateApiKeyModal({ opened, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<string>("90");
  const [customDate, setCustomDate] = useState<Date | string | null>(null);
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [created, setCreated] = useState<ICreatedApiKey | null>(null);
  const createMutation = useCreateApiKeyMutation();

  const reset = () => {
    setName("");
    setExpiry("90");
    setCustomDate(null);
    setScopes(DEFAULT_SCOPES);
    setCreated(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const toggle = (resource: string, access: "read" | "write") => {
    const scope = `${resource}:${access}`;
    setScopes((current) => {
      if (current.includes(scope)) {
        // Unchecking read also drops write, since write implies read.
        const drop =
          access === "read" ? [scope, `${resource}:write`] : [scope];
        return current.filter((s) => !drop.includes(s));
      }
      const add = access === "write" ? [scope, `${resource}:read`] : [scope];
      return [...new Set([...current, ...add])];
    });
  };

  const expiresAt = (): string | undefined => {
    if (expiry === "never") return undefined;
    if (expiry === "custom") {
      return customDate ? new Date(customDate).toISOString() : undefined;
    }
    return addDays(new Date(), Number(expiry)).toISOString();
  };

  const submit = async () => {
    const result = await createMutation.mutateAsync({
      name,
      scopes,
      expiresAt: expiresAt(),
    });
    setCreated(result);
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={created ? t("API key created") : t("Create API key")}
      size="lg"
      centered
    >
      {created ? (
        <Stack>
          <Alert
            color="yellow"
            variant="light"
            icon={<IconAlertTriangle size={18} />}
          >
            {t(
              "Copy this key now. You will not be able to see it again after closing this dialog.",
            )}
          </Alert>
          <Group wrap="nowrap" align="flex-start" gap="xs">
            <Code
              block
              style={{ wordBreak: "break-all", whiteSpace: "pre-wrap", flex: 1 }}
            >
              {created.token}
            </Code>
            <CopyTextButton text={created.token} />
          </Group>
          <Text size="sm" c="dimmed">
            {t("Send it in the Authorization header:")}{" "}
            <Code>Authorization: Bearer &lt;key&gt;</Code>
          </Text>
          <Group justify="flex-end">
            <Button onClick={close}>{t("Done")}</Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <TextInput
            label={t("Name")}
            placeholder={t("e.g. CI pipeline")}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            data-autofocus
            required
          />

          <Group grow align="flex-end">
            <Select
              label={t("Expiration")}
              value={expiry}
              onChange={(v) => setExpiry(v ?? "90")}
              data={[
                { value: "30", label: t("30 days") },
                { value: "90", label: t("90 days") },
                { value: "365", label: t("1 year") },
                { value: "custom", label: t("Custom date") },
                { value: "never", label: t("No expiration") },
              ]}
              allowDeselect={false}
            />
            {expiry === "custom" && (
              <DatePickerInput
                label={t("Expires on")}
                value={customDate}
                onChange={setCustomDate}
                minDate={addDays(new Date(), 1)}
              />
            )}
          </Group>

          <div>
            <Text size="sm" fw={500} mb={4}>
              {t("Scopes")}
            </Text>
            <Text size="xs" c="dimmed" mb="xs">
              {t(
                "The key acts as you and can never do more than your account can. Write access includes read access.",
              )}
            </Text>
            <Table withTableBorder verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("Resource")}</Table.Th>
                  <Table.Th w={80}>{t("Read")}</Table.Th>
                  <Table.Th w={80}>{t("Write")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {API_KEY_RESOURCES.map((resource) => (
                  <Table.Tr key={resource}>
                    <Table.Td>{t(RESOURCE_LABELS[resource])}</Table.Td>
                    <Table.Td>
                      <Checkbox
                        aria-label={`${resource}:read`}
                        checked={scopes.includes(`${resource}:read`)}
                        onChange={() => toggle(resource, "read")}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Checkbox
                        aria-label={`${resource}:write`}
                        checked={scopes.includes(`${resource}:write`)}
                        onChange={() => toggle(resource, "write")}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>

          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {t("Cancel")}
            </Button>
            <Button
              onClick={submit}
              loading={createMutation.isPending}
              disabled={
                !name.trim() ||
                scopes.length === 0 ||
                (expiry === "custom" && !customDate)
              }
            >
              {t("Create")}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
