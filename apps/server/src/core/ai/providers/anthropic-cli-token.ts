import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Access tokens from the CLI are short-lived; refresh well before expiry.
const CACHE_MS = 4 * 60 * 1000;

let cached: { token: string; fetchedAt: number } | null = null;
let inflight: Promise<string> | null = null;

/**
 * Get a short-lived Anthropic access token from the `ant` CLI profile on
 * this server (created with `ant auth login`). DocIt never stores the
 * token or a refresh token; the CLI owns them.
 *
 * Set ANTHROPIC_CLI_PATH to point at the binary if it is not on PATH.
 */
export async function getAnthropicCliToken(): Promise<string> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.token;
  }
  if (inflight) return inflight;

  const bin = process.env.ANTHROPIC_CLI_PATH || 'ant';
  inflight = execFileAsync(
    bin,
    ['auth', 'print-credentials', '--access-token'],
    { timeout: 15_000, windowsHide: true },
  )
    .then(({ stdout }) => {
      const token = stdout.trim();
      if (!token) {
        throw new Error('The Anthropic CLI returned an empty access token');
      }
      cached = { token, fetchedAt: Date.now() };
      return token;
    })
    .catch((err) => {
      cached = null;
      const reason =
        err?.code === 'ENOENT'
          ? `Anthropic CLI not found ("${bin}"). Install it and run "ant auth login" on the server, or set ANTHROPIC_CLI_PATH.`
          : `Anthropic CLI did not return credentials: ${err?.stderr?.toString().trim() || err?.message}`;
      throw new Error(reason);
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function clearAnthropicCliTokenCache() {
  cached = null;
}
