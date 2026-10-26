import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { LanguageModel } from 'ai';

const logger = new Logger('ClaudeAgentSdk');

// DocIt's task prompt (with its own instructions) arrives in the user
// message, so the session only needs a neutral system prompt. This also
// keeps Claude Code's default coding-agent prompt out of the request.
const SYSTEM_PROMPT =
  'You are an assistant built into DocIt, a team knowledge base. Follow the instructions in the message exactly and reply with plain Markdown text.';

let workDir: string | null = null;

/** An empty directory, so the session never sees the server's files. */
function emptyWorkDir(): string {
  if (!workDir) {
    workDir = join(tmpdir(), 'docit-claude-agent');
    mkdirSync(workDir, { recursive: true });
  }
  return workDir;
}

/**
 * Overrides for the Claude Code subprocess environment. The SDK wrapper
 * inherits an allowlist that includes every ANTHROPIC_*, CLAUDE_*, AWS_*, and
 * GOOGLE_* variable; a subscription session needs none of them except its
 * login, so the rest are removed (DocIt's S3 keys are AWS_S3_*).
 */
export function subprocessEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const keep = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN']);
  const env: Record<string, string | undefined> = {};
  for (const key of Object.keys(source)) {
    if (/^(ANTHROPIC_|CLAUDE_|AWS_|GOOGLE_)/.test(key) && !keep.has(key)) {
      env[key] = undefined;
    }
  }
  // Always use the plan, even if these appear later.
  env.ANTHROPIC_API_KEY = undefined;
  env.ANTHROPIC_AUTH_TOKEN = undefined;
  env.ANTHROPIC_BASE_URL = undefined;
  // Don't attach the account's claude.ai connectors.
  env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
  return env;
}

/**
 * A language model that runs through the Claude Agent SDK, which uses the
 * Claude Code login of the account DocIt runs as. Sign-in happens in Claude
 * Code itself (`claude` then /login, or CLAUDE_CODE_OAUTH_TOKEN from
 * `claude setup-token`); DocIt never sees or stores the credential.
 *
 * The session is locked down: no tools, no settings or CLAUDE.md files, no
 * MCP servers, one turn, and nothing persisted to disk.
 *
 * Use each returned model for one request only: a model instance resumes
 * its previous session on the next call, and no session is persisted.
 */
export async function createClaudeAgentModel(model: string): Promise<LanguageModel> {
  let mod: typeof import('ai-sdk-provider-claude-code');
  try {
    mod = await import('ai-sdk-provider-claude-code');
  } catch (err) {
    throw new Error(
      `The Claude Agent SDK could not be loaded: ${(err as Error).message}`,
    );
  }

  const provider = mod.createClaudeCode({
    defaultSettings: {
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      allowedTools: [],
      mcpServers: {},
      strictMcpConfig: true,
      settingSources: [],
      permissionPrompts: 'none',
      maxTurns: 1,
      persistSession: false,
      verbatimPrompts: true,
      // No skills or slash commands either (they'd need tools anyway).
      extraArgs: { 'disable-slash-commands': null },
      cwd: emptyWorkDir(),
      pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH || undefined,
      // Use the subscription login, not an API key that happens to be in
      // the server environment for another provider mode.
      env: subprocessEnv(),
      logger: {
        debug: (msg: string) => logger.debug(msg),
        info: (msg: string) => logger.debug(msg),
        warn: (msg: string) => {
          // Expected for every request: DocIt sets an output cap for the
          // other providers.
          if (msg.includes('maxOutputTokens')) return;
          logger.warn(msg);
        },
        error: (msg: string) => logger.error(msg),
      },
    },
  });

  return provider(model) as LanguageModel;
}
