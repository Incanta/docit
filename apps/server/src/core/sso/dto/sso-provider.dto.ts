import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateOidcProviderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  name: string;

  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  issuer: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  clientId: string;

  // Omit on update to keep the stored secret; empty string clears it.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  clientSecret?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  allowSignup?: boolean;

  @IsOptional()
  @IsBoolean()
  groupSync?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  groupsClaim?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  scopes?: string;

  @IsOptional()
  @IsBoolean()
  allowUnverifiedEmail?: boolean;
}

export class UpdateOidcProviderDto extends CreateOidcProviderDto {
  @IsUUID()
  providerId: string;
}

export class SsoProviderIdDto {
  @IsUUID()
  providerId: string;
}
