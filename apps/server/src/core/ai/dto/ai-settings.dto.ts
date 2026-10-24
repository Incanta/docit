import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const PROVIDERS = ['openai', 'anthropic', 'google', 'ollama', 'openai-compatible'];
const AUTH_MODES = ['api_key', 'env', 'anthropic_cli', 'none'];

export class UpdateAiSettingsDto {
  @IsIn(PROVIDERS)
  provider: string;

  @IsIn(AUTH_MODES)
  authMode: string;

  // Omit to keep the stored key; send an empty string to clear it.
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  apiKey?: string;

  @IsOptional()
  @ValidateIf((o) => !!o.baseUrl)
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  baseUrl?: string | null;

  @IsString()
  @MaxLength(200)
  chatModel: string;

  @IsOptional()
  @ValidateIf((o) => !!o.embeddingProvider)
  @IsIn(PROVIDERS)
  embeddingProvider?: string | null;

  @IsOptional()
  @ValidateIf((o) => !!o.embeddingAuthMode)
  @IsIn(AUTH_MODES)
  embeddingAuthMode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  embeddingApiKey?: string;

  @IsOptional()
  @ValidateIf((o) => !!o.embeddingBaseUrl)
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  embeddingBaseUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  embeddingModel?: string | null;

  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(8192)
  embeddingDimensions?: number | null;
}

export class TestAiSettingsDto {
  @IsIn(['chat', 'embedding'])
  target: 'chat' | 'embedding';
}
