import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const AI_ACTIONS = [
  'improve',
  'fix_grammar',
  'shorter',
  'longer',
  'simplify',
  'tone',
  'translate',
  'summarize',
  'continue',
  'explain',
  'action_items',
  'custom',
] as const;
export type AiAction = (typeof AI_ACTIONS)[number];

export class AiGenerateDto {
  @IsIn(AI_ACTIONS as unknown as string[])
  action: AiAction;

  /** Selected text as Markdown. Empty means "write new content". */
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tone?: string;

  /** Page whose content is passed along as context (permission checked). */
  @IsOptional()
  @IsString()
  pageId?: string;
}

export class AiAskDto {
  @IsString()
  @MaxLength(2000)
  question: string;

  @IsOptional()
  @IsUUID()
  spaceId?: string;
}
