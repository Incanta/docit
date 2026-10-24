export type AiProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "ollama"
  | "openai-compatible";

export type AiAuthMode = "api_key" | "env" | "anthropic_cli" | "none";

export interface IAiProviderInfo {
  label: string;
  authModes: AiAuthMode[];
  supportsEmbeddings: boolean;
  needsBaseUrl: boolean;
  defaultBaseUrl?: string;
  suggestedChatModels: string[];
  suggestedEmbeddingModels: { model: string; dimensions: number }[];
}

export interface IAiSettings {
  provider: AiProviderId;
  authMode: AiAuthMode;
  hasApiKey: boolean;
  baseUrl: string | null;
  chatModel: string | null;
  embeddingProvider: AiProviderId | null;
  embeddingAuthMode: AiAuthMode | null;
  hasEmbeddingApiKey: boolean;
  embeddingBaseUrl: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
}

export interface IAiSettingsResponse {
  providers: Record<AiProviderId, IAiProviderInfo>;
  source: "workspace" | "environment" | null;
  settings: IAiSettings | null;
  environment: {
    provider: string;
    chatModel: string;
    embeddingModel: string | null;
  } | null;
}

export interface IUpdateAiSettings {
  provider: AiProviderId;
  authMode: AiAuthMode;
  apiKey?: string;
  baseUrl?: string | null;
  chatModel: string;
  embeddingProvider?: AiProviderId | null;
  embeddingAuthMode?: AiAuthMode | null;
  embeddingApiKey?: string;
  embeddingBaseUrl?: string | null;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
}

export interface IAiTestResult {
  ok: boolean;
  latencyMs?: number;
  sample?: string;
  dimensions?: number;
  error?: string;
}

export interface IAiStatus {
  configured: boolean;
  generative: boolean;
  answers: boolean;
}

export type AiAction =
  | "improve"
  | "fix_grammar"
  | "shorter"
  | "longer"
  | "simplify"
  | "tone"
  | "translate"
  | "summarize"
  | "continue"
  | "explain"
  | "action_items"
  | "custom";

export interface IAiGenerateRequest {
  action: AiAction;
  text?: string;
  prompt?: string;
  language?: string;
  tone?: string;
  pageId?: string;
}

export interface IAiAnswerSource {
  index: number;
  pageId: string;
  slugId: string;
  title: string;
  spaceName?: string;
  attachmentName?: string;
  url: string;
  excerpt?: string;
}
