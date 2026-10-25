export type AiProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'openai-compatible';

/**
 * How DocIt authenticates with the provider:
 * - api_key: a key an admin saved in DocIt (stored encrypted)
 * - env: credentials from the server environment (OPENAI_API_KEY,
 *   ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, GEMINI_API_KEY)
 * - anthropic_cli: short-lived tokens from the Anthropic CLI profile on the
 *   server (`ant auth login`), so no key is stored anywhere in DocIt
 * - claude_subscription: the Claude Agent SDK, signed in through Claude
 *   Code on the server with the instance owner's own Claude plan
 * - none: local servers that need no credentials (Ollama, LM Studio, vLLM)
 */
export type AiAuthMode =
  | 'api_key'
  | 'env'
  | 'anthropic_cli'
  | 'claude_subscription'
  | 'none';

export type AiProviderInfo = {
  label: string;
  authModes: AiAuthMode[];
  supportsEmbeddings: boolean;
  needsBaseUrl: boolean;
  defaultBaseUrl?: string;
  suggestedChatModels: string[];
  suggestedEmbeddingModels: { model: string; dimensions: number }[];
};

export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  anthropic: {
    label: 'Anthropic',
    authModes: ['api_key', 'anthropic_cli', 'claude_subscription', 'env'],
    supportsEmbeddings: false,
    needsBaseUrl: false,
    suggestedChatModels: [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ],
    suggestedEmbeddingModels: [],
  },
  openai: {
    label: 'OpenAI',
    authModes: ['api_key', 'env'],
    supportsEmbeddings: true,
    needsBaseUrl: false,
    suggestedChatModels: [],
    suggestedEmbeddingModels: [
      { model: 'text-embedding-3-small', dimensions: 1536 },
      { model: 'text-embedding-3-large', dimensions: 3072 },
    ],
  },
  google: {
    label: 'Google Gemini',
    authModes: ['api_key', 'env'],
    supportsEmbeddings: true,
    needsBaseUrl: false,
    suggestedChatModels: [],
    suggestedEmbeddingModels: [],
  },
  ollama: {
    label: 'Ollama (local)',
    authModes: ['none'],
    supportsEmbeddings: true,
    needsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434',
    suggestedChatModels: [],
    suggestedEmbeddingModels: [
      { model: 'nomic-embed-text', dimensions: 768 },
      { model: 'mxbai-embed-large', dimensions: 1024 },
    ],
  },
  'openai-compatible': {
    label: 'OpenAI-compatible (LM Studio, vLLM, OpenRouter...)',
    authModes: ['api_key', 'none', 'env'],
    supportsEmbeddings: true,
    needsBaseUrl: true,
    suggestedChatModels: [],
    suggestedEmbeddingModels: [],
  },
};

export function isAiProviderId(value: string): value is AiProviderId {
  return Object.prototype.hasOwnProperty.call(AI_PROVIDERS, value);
}
