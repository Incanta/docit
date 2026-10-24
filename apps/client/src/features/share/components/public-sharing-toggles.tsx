import { Group, Switch, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { useUpdateSpaceMutation } from "@/features/space/queries/space-query.ts";
import { ISpace } from "@/features/space/types/space.types.ts";

function confirmDisable(
  t: (key: string) => string,
  message: string,
  onConfirm: () => void,
) {
  modals.openConfirmModal({
    title: t("Disable public sharing"),
    children: <Text size="sm">{message}</Text>,
    centered: true,
    labels: { confirm: t("Disable"), cancel: t("Cancel") },
    confirmProps: { color: "red" },
    onConfirm,
  });
}

/** Workspace-wide switch. When off, no page in any space can be shared. */
export function WorkspacePublicSharingToggle() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [disabled, setDisabled] = useState(
    workspace?.settings?.sharing?.disabled === true,
  );

  const apply = async (value: boolean) => {
    try {
      const updated = await updateWorkspace({ disablePublicSharing: value });
      setDisabled(value);
      setWorkspace(updated);
      queryClient.invalidateQueries({ queryKey: ["share-list"] });
      notifications.show({
        message: value
          ? t("Public sharing disabled")
          : t("Public sharing enabled"),
      });
    } catch (err) {
      notifications.show({
        message: err?.response?.data?.message,
        color: "red",
      });
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // The switch reads "Allow public sharing", so checked = sharing allowed.
    const disable = !event.currentTarget.checked;
    if (disable) {
      confirmDisable(
        t,
        t(
          "All public share links in this workspace will be deleted and members will not be able to share pages. Are you sure?",
        ),
        () => apply(true),
      );
    } else {
      apply(false);
    }
  };

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl" mb="md">
      <div>
        <Text size="md">{t("Allow public sharing")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Members can publish pages to the web with a public link. Turning this off deletes existing share links.",
          )}
        </Text>
      </div>
      <Switch
        checked={!disabled}
        onChange={handleChange}
        aria-label={t("Toggle public sharing")}
      />
    </Group>
  );
}

/** Per-space switch. The workspace setting still wins when it is off. */
export function SpacePublicSharingToggle({ space }: { space: ISpace }) {
  const { t } = useTranslation();
  const [workspace] = useAtom(workspaceAtom);
  const updateSpaceMutation = useUpdateSpaceMutation();
  const [disabled, setDisabled] = useState(
    space?.settings?.sharing?.disabled === true,
  );
  const workspaceDisabled = workspace?.settings?.sharing?.disabled === true;

  const apply = async (value: boolean) => {
    await updateSpaceMutation.mutateAsync({
      spaceId: space.id,
      disablePublicSharing: value,
    });
    setDisabled(value);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const disable = !event.currentTarget.checked;
    if (disable) {
      confirmDisable(
        t,
        t(
          "All public share links in this space will be deleted and members will not be able to share its pages. Are you sure?",
        ),
        () => apply(true),
      );
    } else {
      apply(false);
    }
  };

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{t("Allow public sharing")}</Text>
        <Text size="sm" c="dimmed">
          {workspaceDisabled
            ? t("Public sharing is disabled for the whole workspace.")
            : t(
                "Members can publish pages in this space to the web. Turning this off deletes existing share links.",
              )}
        </Text>
      </div>
      <Switch
        checked={!disabled && !workspaceDisabled}
        disabled={workspaceDisabled || updateSpaceMutation.isPending}
        onChange={handleChange}
        aria-label={t("Toggle public sharing")}
      />
    </Group>
  );
}
