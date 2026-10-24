import api from "@/lib/api-client";
import { IPagination } from "@/lib/types.ts";
import {
  IApiKey,
  ICreateApiKey,
  ICreatedApiKey,
} from "@/features/api-key/types/api-key.types.ts";

export async function getApiKeys(params: {
  adminView?: boolean;
}): Promise<IPagination<IApiKey>> {
  const req = await api.post("/api-keys", params);
  return req.data;
}

export async function createApiKey(data: ICreateApiKey): Promise<ICreatedApiKey> {
  const req = await api.post("/api-keys/create", data);
  return req.data;
}

export async function updateApiKey(data: {
  apiKeyId: string;
  name: string;
}): Promise<IApiKey> {
  const req = await api.post("/api-keys/update", data);
  return req.data;
}

export async function revokeApiKey(apiKeyId: string): Promise<void> {
  await api.post("/api-keys/revoke", { apiKeyId });
}
