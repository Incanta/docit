import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOllama } from 'ai-sdk-ollama';
import { AiSettingsRepo } from '@docmost/db/repos/ai/ai-settings.repo';
import { AiSettings } from '@docmost/db/types/entity.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import {
  EncryptionPurpose,
  EncryptionService,
} from '../../../integrations/encryption/encryption.service';
import { getAnthropicCliToken } from './anthropic-cli-token';
import {
  AI_PROVIDERS,
  AiAuthMode,
  AiProviderId,
  isAiProviderId,
} from './ai-provider.constants';

type Credentials = {
  provider: AiProviderId;
  authMode: AiAuthMode;
  apiKey?: string | null;
  baseUrl?: string | null;
};

export type ResolvedAiConfig = {
  source: 'workspace' | 'environment';
  chat: (Credentials & { model: string }) | null;
  embedding: (Credentials & { model: string; dimensions?: number | null }) | null;
};

@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);

  constructor(
    private readonly aiSettingsRepo: AiSettingsRepo,
    private readonly environmentService: EnvironmentService,
    private readonly encryptionService: EncryptionService,
  ) {}

  encryptSecret(value: string): string {
    return this.encryptionService.encrypt(
      value,
      EncryptionPurpose.AI_CREDENTIALS,
    );
  }

  private decryptSecret(value: string | null): string | null {
    if (!value) return null;
    try {
      return this.encryptionService.decrypt(
        value,
        EncryptionPurpose.AI_CREDENTIALS,
      );
    } catch (err) {
      this.logger.error('Failed to decrypt stored AI credentials', err);
      return null;
    }
  }

  /** Workspace settings win; otherwise fall back to the server's AI_* env. */
  async resolveConfig(workspaceId: string): Promise<ResolvedAiConfig> {
    const row = await this.aiSettingsRepo.findByWorkspaceId(workspaceId);
    if (row && isAiProviderId(row.provider)) {
      return this.fromRow(row);
    }
    return this.fromEnvironment();
  }

  private fromRow(row: AiSettings): ResolvedAiConfig {
    const chat = row.chatModel
      ? {
          provider: row.provider as AiProviderId,
          authMode: row.authMode as AiAuthMode,
          apiKey: this.decryptSecret(row.apiKey),
          baseUrl: row.baseUrl,
          model: row.chatModel,
        }
      : null;

    let embedding: ResolvedAiConfig['embedding'] = null;
    if (row.embeddingModel) {
      const sameProvider =
        !row.embeddingProvider || row.embeddingProvider === row.provider;
      const provider = (row.embeddingProvider || row.provider) as AiProviderId;
      if (AI_PROVIDERS[provider]?.supportsEmbeddings) {
        embedding = sameProvider
          ? {
              provider,
              authMode: row.authMode as AiAuthMode,
              apiKey: this.decryptSecret(row.apiKey),
              baseUrl: row.baseUrl,
              model: row.embeddingModel,
              dimensions: row.embeddingDimensions,
            }
          : {
              provider,
              authMode: (row.embeddingAuthMode || 'api_key') as AiAuthMode,
              apiKey: this.decryptSecret(row.embeddingApiKey),
              baseUrl: row.embeddingBaseUrl,
              model: row.embeddingModel,
              dimensions: row.embeddingDimensions,
            };
      }
    }

    return { source: 'workspace', chat, embedding };
  }

  private fromEnvironment(): ResolvedAiConfig {
    const driver = this.environmentService.getAiDriver();
    if (!driver) return { source: 'environment', chat: null, embedding: null };
    const provider: AiProviderId =
      driver === 'gemini' ? 'google' : (driver as AiProviderId);
    if (!isAiProviderId(provider)) {
      return { source: 'environment', chat: null, embedding: null };
    }

    const base = {
      provider,
      authMode: (provider === 'ollama' ? 'none' : 'env') as AiAuthMode,
      baseUrl:
        provider === 'ollama'
          ? this.environmentService.getOllamaApiUrl()
          : this.environmentService.getOpenAiApiUrl() || null,
    };
    const chatModel = this.environmentService.getAiChatModel();
    const embeddingModel = this.environmentService.getAiEmbeddingModel();

    return {
      source: 'environment',
      chat: chatModel ? { ...base, model: chatModel } : null,
      embedding:
        embeddingModel && AI_PROVIDERS[provider].supportsEmbeddings
          ? {
              ...base,
              model: embeddingModel,
              dimensions:
                this.environmentService.getAiEmbeddingDimension() || null,
            }
          : null,
    };
  }

  private envKey(provider: AiProviderId): string | undefined {
    switch (provider) {
      case 'openai':
      case 'openai-compatible':
        return this.environmentService.getOpenAiApiKey();
      case 'google':
        return this.environmentService.getGeminiApiKey();
      case 'anthropic':
        return process.env.ANTHROPIC_API_KEY;
      default:
        return undefined;
    }
  }

  /** Build an `ai` SDK provider instance for one set of credentials. */
  private async createProvider(c: Credentials): Promise<any> {
    const apiKey =
      c.authMode === 'api_key'
        ? (c.apiKey ?? undefined)
        : c.authMode === 'env'
          ? this.envKey(c.provider)
          : undefined;
    const baseURL = c.baseUrl || undefined;

    switch (c.provider) {
      case 'openai':
        return createOpenAI({ apiKey, baseURL });
      case 'anthropic': {
        if (c.authMode === 'anthropic_cli') {
          // Short-lived OAuth access token from `ant auth login` on the host.
          return createAnthropic({
            authToken: await getAnthropicCliToken(),
            baseURL,
            headers: { 'anthropic-beta': 'oauth-2025-04-20' },
          });
        }
        if (c.authMode === 'env' && !apiKey && process.env.ANTHROPIC_AUTH_TOKEN) {
          return createAnthropic({
            authToken: process.env.ANTHROPIC_AUTH_TOKEN,
            baseURL,
            headers: { 'anthropic-beta': 'oauth-2025-04-20' },
          });
        }
        return createAnthropic({ apiKey, baseURL });
      }
      case 'google':
        return createGoogleGenerativeAI({ apiKey, baseURL });
      case 'ollama':
        return createOllama({ baseURL: baseURL ?? 'http://localhost:11434' });
      case 'openai-compatible':
        if (!baseURL) {
          throw new BadRequestException(
            'A base URL is required for OpenAI-compatible providers',
          );
        }
        return createOpenAICompatible({ name: 'custom', baseURL, apiKey });
    }
  }

  async isChatConfigured(workspaceId: string): Promise<boolean> {
    return !!(await this.resolveConfig(workspaceId)).chat;
  }

  async getChatModel(workspaceId: string): Promise<LanguageModel> {
    const config = await this.resolveConfig(workspaceId);
    if (!config.chat) {
      throw new BadRequestException(
        'AI is not configured. An admin can set it up in Settings > AI.',
      );
    }
    return this.chatModelFor(config.chat);
  }

  async chatModelFor(c: Credentials & { model: string }): Promise<LanguageModel> {
    const provider = await this.createProvider(c);
    return provider.languageModel
      ? provider.languageModel(c.model)
      : provider(c.model);
  }

  async getEmbeddingModel(
    workspaceId: string,
  ): Promise<{ model: EmbeddingModel; name: string; dimensions?: number | null } | null> {
    const config = await this.resolveConfig(workspaceId);
    if (!config.embedding) return null;
    return {
      model: await this.embeddingModelFor(config.embedding),
      name: `${config.embedding.provider}:${config.embedding.model}`,
      dimensions: config.embedding.dimensions,
    };
  }

  async embeddingModelFor(
    c: Credentials & { model: string },
  ): Promise<EmbeddingModel> {
    const provider = await this.createProvider(c);
    return provider.textEmbeddingModel(c.model);
  }
}
