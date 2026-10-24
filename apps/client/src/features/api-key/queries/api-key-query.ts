import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import {
  createApiKey,
  getApiKeys,
  revokeApiKey,
  updateApiKey,
} from "@/features/api-key/services/api-key-service.ts";
import { ICreateApiKey } from "@/features/api-key/types/api-key.types.ts";

export function useApiKeysQuery(adminView: boolean) {
  return useQuery({
    queryKey: ["api-keys", adminView],
    queryFn: () => getApiKeys({ adminView }),
  });
}

function useErrorToast() {
  const { t } = useTranslation();
  return (error: any) =>
    notifications.show({
      message: error?.response?.data?.message ?? t("Something went wrong"),
      color: "red",
    });
}

export function useCreateApiKeyMutation() {
  const queryClient = useQueryClient();
  const onError = useErrorToast();
  return useMutation({
    mutationFn: (data: ICreateApiKey) => createApiKey(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
    onError,
  });
}

export function useUpdateApiKeyMutation() {
  const queryClient = useQueryClient();
  const onError = useErrorToast();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (data: { apiKeyId: string; name: string }) =>
      updateApiKey(data),
    onSuccess: () => {
      notifications.show({ message: t("API key updated") });
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError,
  });
}

export function useRevokeApiKeyMutation() {
  const queryClient = useQueryClient();
  const onError = useErrorToast();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (apiKeyId: string) => revokeApiKey(apiKeyId),
    onSuccess: () => {
      notifications.show({ message: t("API key revoked") });
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError,
  });
}
