const createClaudeCode = jest.fn();

jest.mock('ai-sdk-provider-claude-code', () => ({ createClaudeCode }), {
  virtual: true,
});

import { createClaudeAgentModel } from './claude-agent-sdk';

describe('createClaudeAgentModel', () => {
  beforeEach(() => {
    createClaudeCode.mockReset();
    createClaudeCode.mockReturnValue((model: string) => ({ model }));
  });

  it('locks the Claude Code session down', async () => {
    const model = await createClaudeAgentModel('sonnet');
    expect(model).toEqual({ model: 'sonnet' });

    const settings = createClaudeCode.mock.calls[0][0].defaultSettings;
    // No built-in tools, MCP servers, connectors, skills, or settings files.
    expect(settings.tools).toEqual([]);
    expect(settings.allowedTools).toEqual([]);
    expect(settings.mcpServers).toEqual({});
    expect(settings.strictMcpConfig).toBe(true);
    expect(settings.settingSources).toEqual([]);
    expect(settings.extraArgs).toHaveProperty('disable-slash-commands', null);
    expect(settings.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe('false');
    // Nothing that could escalate permissions.
    expect(settings.permissionPrompts).toBe('none');
    expect(settings.permissionMode).toBeUndefined();
    expect(settings.allowDangerouslySkipPermissions).toBeUndefined();
    expect(settings.maxTurns).toBe(1);
    expect(settings.persistSession).toBe(false);
    expect(settings.verbatimPrompts).toBe(true);
    // Usage goes to the plan, never to an API key in the server env.
    expect(settings.env).toHaveProperty('ANTHROPIC_API_KEY', undefined);
    expect(settings.env).toHaveProperty('ANTHROPIC_AUTH_TOKEN', undefined);
    expect(settings.env).toHaveProperty('ANTHROPIC_BASE_URL', undefined);
    expect(settings.cwd).toMatch(/docit-claude-agent$/);
  });
});
