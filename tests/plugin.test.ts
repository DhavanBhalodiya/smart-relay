import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import SmartRelayPlugin from '../plugin-smartrelay/src/index.js';
import { PROVIDER_KEYS } from '../src/credentials.js';

const TOUCHED = [...PROVIDER_KEYS.map((s) => s.env), 'MCP_CONFIG_PATH'];

describe('SmartRelayPlugin', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    // `initialize()` mutates process.env by design; snapshot everything it touches.
    for (const key of TOUCHED) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it('publishes configured keys into the environment the runners read', async () => {
    const plugin = new SmartRelayPlugin();
    await plugin.initialize({
      nvidiaApiKey: 'nvapi-test',
      openrouterApiKey: 'sk-or-v1-test',
    });

    expect(process.env['NVIDIA_API_KEY']).toBe('nvapi-test');
    expect(process.env['OPENROUTER_API_KEY']).toBe('sk-or-v1-test');
  });

  it('does not blank out an ambient key when the optional field is empty', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-ambient';

    const plugin = new SmartRelayPlugin();
    return plugin
      .initialize({ nvidiaApiKey: 'nvapi-test', openrouterApiKey: 'sk-or-v1-test' })
      .then(() => {
        expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-ant-ambient');
      });
  });

  it('overrides an ambient key when the field is filled in', async () => {
    process.env['NVIDIA_API_KEY'] = 'nvapi-ambient';

    const plugin = new SmartRelayPlugin();
    await plugin.initialize({ nvidiaApiKey: 'nvapi-explicit', openrouterApiKey: 'sk-or-v1-test' });

    expect(process.env['NVIDIA_API_KEY']).toBe('nvapi-explicit');
  });

  it('survives an empty or malformed configuration instead of failing to load', async () => {
    const plugin = new SmartRelayPlugin();

    await expect(plugin.initialize({})).resolves.toBeUndefined();
    await expect(
      plugin.initialize(undefined as unknown as Record<string, unknown>),
    ).resolves.toBeUndefined();
    await expect(
      plugin.initialize({ nvidiaApiKey: 42 } as unknown as Record<string, unknown>),
    ).resolves.toBeUndefined();
  });

  it('marks every sensitive field as a masked input in the config metadata', () => {
    const plugin = new SmartRelayPlugin();
    const fields = plugin.getConfigMeta().fields ?? {};

    for (const name of plugin.getSensitiveConfigFields()) {
      expect(fields[name], `missing config meta for ${name}`).toBeDefined();
      expect(fields[name]?.['fieldType']).toBe('password');
    }
  });

  it('reports unhealthy until the required keys are configured', async () => {
    const plugin = new SmartRelayPlugin();
    await plugin.initialize({});

    const health = await plugin.healthCheck();
    expect(health.status).toBe('unhealthy');
    expect(health.message).toContain('nvidiaApiKey');
  });

  it('reports how many runners the configured keys unlocked', async () => {
    const plugin = new SmartRelayPlugin();
    await plugin.initialize({ nvidiaApiKey: 'nvapi-test', openrouterApiKey: 'sk-or-v1-test' });

    const health = await plugin.healthCheck();
    expect(health.status).toBe('healthy');
    expect(health.message).toMatch(/\d+\/\d+ runners authenticated/);
  });

  it('refuses tool calls while required keys are missing', async () => {
    const plugin = new SmartRelayPlugin();
    await plugin.initialize({});

    const result = await plugin.handleToolCall('smartrelay_list_runners', {}, {});
    expect(result).toHaveProperty('error');
    expect(String((result as { error: string }).error)).toContain('not configured');
  });

  it('accepts credentials through smartrelay_configure at runtime', async () => {
    const plugin = new SmartRelayPlugin();
    await plugin.initialize({});

    const result = (await plugin.handleToolCall(
      'smartrelay_configure',
      { nvidiaApiKey: 'nvapi-runtime', openrouterApiKey: 'sk-or-v1-runtime' },
      {},
    )) as { status: string; keys_set: string[]; missing: string[] };

    expect(result.status).toBe('configured');
    expect(result.keys_set).toContain('NVIDIA_API_KEY');
    expect(result.missing).toEqual([]);
    expect(process.env['NVIDIA_API_KEY']).toBe('nvapi-runtime');
  });

  it('answers the settings tools even with nothing configured', async () => {
    // These are what MCPHub calls to render and verify plugin state. Gating them
    // behind "not configured" would be circular — the host could never learn
    // *that* it is unconfigured.
    const plugin = new SmartRelayPlugin();
    await plugin.initialize({});

    for (const tool of ['smartrelay_status', 'smartrelay_health_check', 'smartrelay_get_logs']) {
      const result = (await plugin.handleToolCall(tool, {}, {})) as Record<string, unknown>;
      expect(result['error'], `${tool} should not be gated`).toBeUndefined();
    }
  });

  it('reports unconfigured even though keyless runners look authenticated', async () => {
    // Ollama needs no credential, so `runners_ready > 0` is true on a totally
    // unconfigured install — status must key off the required provider keys.
    const plugin = new SmartRelayPlugin();
    await plugin.initialize({});

    const status = (await plugin.handleToolCall('smartrelay_status', {}, {})) as Record<string, unknown>;
    expect(status['configured']).toBe(false);
    expect(status['status']).toBe('unhealthy');
    expect(status['runners_ready']).toBeGreaterThan(0);

    const health = (await plugin.handleToolCall('smartrelay_health_check', {}, {})) as {
      status: string;
      details: Record<string, unknown>;
    };
    expect(health.status).toBe('unhealthy');
    expect(health.details['missing_required']).toEqual(['NVIDIA_API_KEY', 'OPENROUTER_API_KEY']);
  });

  it('tells the caller how to fix a blocked tool call', async () => {
    const plugin = new SmartRelayPlugin();
    await plugin.initialize({});

    const result = (await plugin.handleToolCall('smartrelay_review_code', { code: 'x' }, {})) as {
      missing: string[];
      how_to_fix: { option_2: string; get_keys: Record<string, string> };
    };

    expect(result.missing).toEqual(['nvidiaApiKey', 'openrouterApiKey']);
    expect(result.how_to_fix.option_2).toContain('smartrelay_configure');
    expect(result.how_to_fix.get_keys['nvidiaApiKey']).toContain('build.nvidia.com');
  });

  it('grounds every action-plan step in a tool it actually exposes', () => {
    const plugin = new SmartRelayPlugin();
    const names = new Set(plugin.getTools().map((t) => t.name));

    for (const plan of plugin.getActionPlans()) {
      for (const step of plan.steps) {
        expect(names, `${plan.name}/${step.id}`).toContain(step.tool_to_call);
      }
    }
  });
});
