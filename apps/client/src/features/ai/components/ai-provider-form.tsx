import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Badge,
  Button,
  Checkbox,
  Code,
  Divider,
  Group,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  resetAiSettings,
  testAiSettings,
  updateAiSettings,
} from "@/features/ai/services/ai-service.ts";
import {
  AiAuthMode,
  AiProviderId,
  IAiSettingsResponse,
  IAiTestResult,
  IUpdateAiSettings,
} from "@/features/ai/types/ai.types.ts";

const AUTH_LABELS: Record<AiAuthMode, string> = {
  api_key: "API key",
  env: "Server environment variables",
  anthropic_cli: "Anthropic CLI login on the server (no stored key)",
  claude_subscription: "Claude subscription via the Agent SDK (no stored key)",
  none: "No authentication (local server)",
};

type Props = { data: IAiSettingsResponse };

export default function AiProviderForm({ data }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { providers, settings } = data;

  const [provider, setProvider] = useState<AiProviderId>(
    settings?.provider ?? "openai",
  );
  const [authMode, setAuthMode] = useState<AiAuthMode>(
    settings?.authMode ?? "api_key",
  );
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? "");
  const [chatModel, setChatModel] = useState(settings?.chatModel ?? "");

  const [separateEmbedding, setSeparateEmbedding] = useState(
    !!settings?.embeddingProvider,
  );
  const [embeddingProvider, setEmbeddingProvider] = useState<AiProviderId>(
    settings?.embeddingProvider ?? "openai",
  );
  const [embeddingAuthMode, setEmbeddingAuthMode] = useState<AiAuthMode>(
    settings?.embeddingAuthMode ?? "api_key",
  );
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState(
    settings?.embeddingBaseUrl ?? "",
  );
  const [embeddingModel, setEmbeddingModel] = useState(
    settings?.embeddingModel ?? "",
  );
  const [embeddingDimensions, setEmbeddingDimensions] = useState<
    number | string
  >(settings?.embeddingDimensions ?? "");

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"chat" | "embedding" | null>(null);
  const [testResult, setTestResult] = useState<
    Record<string, IAiTestResult | undefined>
  >({});

  const info = providers[provider];
  const embeddingInfo =
    providers[separateEmbedding ? embeddingProvider : provider];
  // Providers without embeddings (Anthropic) need a second provider for them.
  const mustSeparate = !info.supportsEmbeddings;

  useEffect(() => {
    if (!info.authModes.includes(authMode)) setAuthMode(info.authModes[0]);
    if (info.defaultBaseUrl && !baseUrl) setBaseUrl(info.defaultBaseUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    const ep = providers[embeddingProvider];
    if (!ep.authModes.includes(embeddingAuthMode)) {
      setEmbeddingAuthMode(ep.authModes[0]);
    }
    if (ep.defaultBaseUrl && !embeddingBaseUrl) {
      setEmbeddingBaseUrl(ep.defaultBaseUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embeddingProvider]);

  const providerOptions = useMemo(
    () =>
      (Object.keys(providers) as AiProviderId[]).map((id) => ({
        value: id,
        label: providers[id].label,
      })),
    [providers],
  );
  const embeddingProviderOptions = providerOptions.filter(
    (o) => providers[o.value as AiProviderId].supportsEmbeddings,
  );

  const useSeparate = separateEmbedding || mustSeparate;
  const savedProviderMatches = settings?.provider === provider;

  const save = async () => {
    setSaving(true);
    try {
      const payload: IUpdateAiSettings = {
        provider,
        authMode,
        baseUrl: baseUrl || null,
        chatModel,
        embeddingProvider: useSeparate && embeddingModel ? embeddingProvider : null,
        embeddingAuthMode: useSeparate ? embeddingAuthMode : null,
        embeddingBaseUrl: useSeparate ? embeddingBaseUrl || null : null,
        embeddingModel: embeddingModel || null,
        embeddingDimensions: embeddingDimensions
          ? Number(embeddingDimensions)
          : null,
      };
      if (apiKey) payload.apiKey = apiKey;
      if (embeddingApiKey) payload.embeddingApiKey = embeddingApiKey;
      const updated = await updateAiSettings(payload);
      queryClient.setQueryData(["ai-settings"], updated);
      queryClient.invalidateQueries({ queryKey: ["ai-status"] });
      setApiKey("");
      setEmbeddingApiKey("");
      notifications.show({ message: t("AI settings saved") });
    } catch (err) {
      notifications.show({
        message: err?.response?.data?.message ?? t("Failed to update"),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (target: "chat" | "embedding") => {
    setTesting(target);
    try {
      const result = await testAiSettings(target);
      setTestResult((r) => ({ ...r, [target]: result }));
    } finally {
      setTesting(null);
    }
  };

  const reset = async () => {
    const updated = await resetAiSettings();
    queryClient.setQueryData(["ai-settings"], updated);
    queryClient.invalidateQueries({ queryKey: ["ai-status"] });
    notifications.show({ message: t("AI settings removed") });
  };

  const credentialFields = (opts: {
    authMode: AiAuthMode;
    setAuthMode: (m: AiAuthMode) => void;
    modes: AiAuthMode[];
    apiKey: string;
    setApiKey: (v: string) => void;
    hasKey: boolean;
    baseUrl: string;
    setBaseUrl: (v: string) => void;
    needsBaseUrl: boolean;
    isAnthropic: boolean;
  }) => (
    <>
      <Select
        label={t("Authentication")}
        data={opts.modes.map((m) => ({ value: m, label: t(AUTH_LABELS[m]) }))}
        value={opts.authMode}
        onChange={(v) => v && opts.setAuthMode(v as AiAuthMode)}
        allowDeselect={false}
      />
      {opts.authMode === "api_key" && (
        <PasswordInput
          label={t("API key")}
          placeholder={
            opts.hasKey
              ? t("A key is saved. Leave blank to keep it.")
              : t("Paste the provider API key")
          }
          value={opts.apiKey}
          onChange={(e) => opts.setApiKey(e.currentTarget.value)}
          autoComplete="off"
        />
      )}
      {opts.authMode === "anthropic_cli" && (
        <Alert variant="light" icon={<IconInfoCircle />}>
          <Text size="sm">
            {t(
              "DocIt asks the Anthropic CLI on the server for short-lived access tokens, so no API key is stored. On the server, install the CLI and sign in as the user DocIt runs as:",
            )}
          </Text>
          <Code block mt={6}>
            ant auth login
          </Code>
          <Text size="xs" c="dimmed" mt={6}>
            {t(
              "Set ANTHROPIC_CLI_PATH if the ant binary is not on PATH. Usage is billed to the Anthropic Console account you sign in with.",
            )}
          </Text>
        </Alert>
      )}
      {opts.authMode === "claude_subscription" && (
        <Alert variant="light" icon={<IconInfoCircle />}>
          <Text size="sm">
            {t(
              "DocIt runs requests through the Claude Agent SDK with your own Claude plan. Sign in to Claude Code on the server as the user DocIt runs as, or create a token and set it as CLAUDE_CODE_OAUTH_TOKEN in the server environment:",
            )}
          </Text>
          <Code block mt={6}>
            claude setup-token
          </Code>
          <Text size="xs" c="dimmed" mt={6}>
            {t(
              "Requests count against your plan's usage limits, so use this only on an instance you run for yourself. Claude gets no tools or file access. Use model names like sonnet, opus, or a full model ID.",
            )}
          </Text>
        </Alert>
      )}
      {opts.authMode === "env" && (
        <Text size="xs" c="dimmed">
          {opts.isAnthropic
            ? t("Uses ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN from the server environment.")
            : t("Uses the provider's API key variable from the server environment (OPENAI_API_KEY or GEMINI_API_KEY).")}
        </Text>
      )}
      {(opts.needsBaseUrl || opts.baseUrl) && (
        <TextInput
          label={t("Base URL")}
          placeholder="http://localhost:11434"
          value={opts.baseUrl}
          onChange={(e) => opts.setBaseUrl(e.currentTarget.value)}
        />
      )}
    </>
  );

  return (
    <Stack gap="md">
      {data.source === "environment" && data.environment && (
        <Alert variant="light" color="blue" icon={<IconInfoCircle />}>
          {t(
            "AI is currently configured by the server environment ({{provider}}, {{model}}). Saving here overrides it for this workspace.",
            {
              provider: data.environment.provider,
              model: data.environment.chatModel,
            },
          )}
        </Alert>
      )}

      <Text fw={600}>{t("Language model")}</Text>
      <Select
        label={t("Provider")}
        data={providerOptions}
        value={provider}
        onChange={(v) => v && setProvider(v as AiProviderId)}
        allowDeselect={false}
      />
      {credentialFields({
        authMode,
        setAuthMode,
        modes: info.authModes,
        apiKey,
        setApiKey,
        hasKey: !!settings?.hasApiKey && savedProviderMatches,
        baseUrl,
        setBaseUrl,
        needsBaseUrl: info.needsBaseUrl,
        isAnthropic: provider === "anthropic",
      })}
      <Autocomplete
        label={t("Model")}
        placeholder={info.suggestedChatModels[0] ?? t("Model name")}
        data={info.suggestedChatModels}
        value={chatModel}
        onChange={setChatModel}
        required
      />

      <Divider />

      <Group justify="space-between">
        <Text fw={600}>{t("Embeddings")}</Text>
        <Badge variant="light" color="gray">
          {t("Optional")}
        </Badge>
      </Group>
      <Text size="sm" c="dimmed">
        {t(
          "An embedding model improves AI answers with semantic search. Without one, answers use keyword search. Embeddings need the pgvector Postgres extension.",
        )}
      </Text>
      {mustSeparate ? (
        <Text size="sm">
          {t("{{provider}} has no embedding models, so pick another provider for embeddings.", {
            provider: info.label,
          })}
        </Text>
      ) : (
        <Checkbox
          label={t("Use a different provider for embeddings")}
          checked={separateEmbedding}
          onChange={(e) => setSeparateEmbedding(e.currentTarget.checked)}
        />
      )}
      {useSeparate && (
        <>
          <Select
            label={t("Embedding provider")}
            data={embeddingProviderOptions}
            value={embeddingProvider}
            onChange={(v) => v && setEmbeddingProvider(v as AiProviderId)}
            allowDeselect={false}
          />
          {credentialFields({
            authMode: embeddingAuthMode,
            setAuthMode: setEmbeddingAuthMode,
            modes: providers[embeddingProvider].authModes,
            apiKey: embeddingApiKey,
            setApiKey: setEmbeddingApiKey,
            hasKey: !!settings?.hasEmbeddingApiKey,
            baseUrl: embeddingBaseUrl,
            setBaseUrl: setEmbeddingBaseUrl,
            needsBaseUrl: providers[embeddingProvider].needsBaseUrl,
            isAnthropic: false,
          })}
        </>
      )}
      <Group grow align="flex-end">
        <Autocomplete
          label={t("Embedding model")}
          placeholder={
            embeddingInfo.suggestedEmbeddingModels[0]?.model ??
            t("Leave empty to skip")
          }
          data={embeddingInfo.suggestedEmbeddingModels.map((m) => m.model)}
          value={embeddingModel}
          onChange={(v) => {
            setEmbeddingModel(v);
            const known = embeddingInfo.suggestedEmbeddingModels.find(
              (m) => m.model === v,
            );
            if (known) setEmbeddingDimensions(known.dimensions);
          }}
        />
        <NumberInput
          label={t("Dimensions")}
          description={t("Optional; for models that support shortening")}
          value={embeddingDimensions}
          onChange={(v) => setEmbeddingDimensions(v as number | string)}
          min={64}
          max={8192}
        />
      </Group>

      <Group justify="space-between" mt="sm">
        <Group gap="xs">
          <Button
            variant="default"
            onClick={() => runTest("chat")}
            loading={testing === "chat"}
            disabled={!settings}
          >
            {t("Test model")}
          </Button>
          <Button
            variant="default"
            onClick={() => runTest("embedding")}
            loading={testing === "embedding"}
            disabled={!settings?.embeddingModel}
          >
            {t("Test embeddings")}
          </Button>
          {settings && (
            <Button variant="subtle" color="red" onClick={reset}>
              {t("Remove settings")}
            </Button>
          )}
        </Group>
        <Button onClick={save} loading={saving} disabled={!chatModel.trim()}>
          {t("Save")}
        </Button>
      </Group>

      {(["chat", "embedding"] as const).map((target) => {
        const r = testResult[target];
        if (!r) return null;
        return (
          <Alert
            key={target}
            color={r.ok ? "green" : "red"}
            variant="light"
            title={
              target === "chat" ? t("Model test") : t("Embedding test")
            }
          >
            {r.ok
              ? target === "chat"
                ? t("Responded in {{ms}} ms: {{sample}}", {
                    ms: r.latencyMs,
                    sample: r.sample,
                  })
                : t("Returned {{dims}} dimensions in {{ms}} ms", {
                    dims: r.dimensions,
                    ms: r.latencyMs,
                  })
              : r.error}
          </Alert>
        );
      })}
    </Stack>
  );
}
