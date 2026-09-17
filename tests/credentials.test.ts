import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  formatRunnerStatusLines,
  maskKey,
  PROVIDER_KEYS,
  summarizeCredentials,
  validateKeyFormat,
  noProviderKeysConfigured,
  warnIfNoCredentials,
} from '../src/credentials.js';
import type { Logger } from '../src/logger.js';
import { RunnerRegistry } from '../src/runners/registry.js';
import type { RunnerMetadata } from '../src/runners/registry.js';

function metadata(overrides: Partial<RunnerMetadata> = {}): RunnerMetadata {
  return {
    runner_id: 'r',
    type: 'nvidia',
    model: 'm',
    pricing: { cost_per_million_input_tokens: 1, cost_per_million_output_tokens: 2 },
    timeout_seconds: 60,
    default_params: {},
    credentials_env_var: 'NVIDIA_API_KEY',
    is_authenticated: true,
    base_url: null,
    setup_hint: null,
    ...overrides,
  };
}

describe('maskKey', () => {
  it('shows only the ends of a long key', () => {
    expect(maskKey('nvapi-abcdefghij0123456789')).toBe('nvapi-…6789');
  });

  it('reveals nothing at all about a short value', () => {
    expect(maskKey('short')).toBe('****');
  });
});

describe('validateKeyFormat', () => {
  const nvidia = PROVIDER_KEYS.find((s) => s.env === 'NVIDIA_API_KEY');

  it('accepts a well-formed key', () => {
    expect(validateKeyFormat(nvidia!, 'nvapi-abcdefghij0123456789')).toBeNull();
  });

  it('warns rather than throwing on a wrong prefix', () => {
    expect(validateKeyFormat(nvidia!, 'oops-abcdefghij0123456789')).toContain('nvapi-');
  });

  it('warns on a suspiciously short value', () => {
    expect(validateKeyFormat(nvidia!, 'nvapi-short')).toContain('short');
  });

  it('treats an empty value as nothing to say', () => {
    expect(validateKeyFormat(nvidia!, '')).toBeNull();
  });
});

describe('summarizeCredentials', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const spec of PROVIDER_KEYS) {
      saved.set(spec.env, process.env[spec.env]);
      delete process.env[spec.env];
    }
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it('counts ready runners and dedupes the env vars they are waiting on', () => {
    const summary = summarizeCredentials([
      metadata({ runner_id: 'a', is_authenticated: true }),
      metadata({ runner_id: 'b', is_authenticated: false }),
      metadata({ runner_id: 'c', is_authenticated: false }),
      metadata({ runner_id: 'd', is_authenticated: false, credentials_env_var: 'OPENAI_API_KEY' }),
    ]);

    expect(summary.ready).toBe(1);
    expect(summary.total).toBe(4);
    expect(summary.missingEnvVars).toEqual(['NVIDIA_API_KEY', 'OPENAI_API_KEY']);
  });

  it('reports every required provider key absent from the environment', () => {
    expect(summarizeCredentials([]).missingRequired).toEqual([
      'NVIDIA_API_KEY',
      'OPENROUTER_API_KEY',
    ]);

    process.env['NVIDIA_API_KEY'] = 'nvapi-x';
    expect(summarizeCredentials([]).missingRequired).toEqual(['OPENROUTER_API_KEY']);
  });
});

describe('noProviderKeysConfigured', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const spec of PROVIDER_KEYS) {
      saved.set(spec.env, process.env[spec.env]);
      delete process.env[spec.env];
    }
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it('is true when no required key is set, whatever the ready count says', () => {
    const keyless = [metadata({ type: 'ollama', credentials_env_var: null, is_authenticated: true })];
    expect(noProviderKeysConfigured(summarizeCredentials(keyless))).toBe(true);
  });

  it('is false as soon as one required key is present', () => {
    process.env['NVIDIA_API_KEY'] = 'nvapi-x';
    expect(noProviderKeysConfigured(summarizeCredentials([]))).toBe(false);
  });
});

describe('warnIfNoCredentials', () => {
  function recordingLogger(): { logger: Logger; warnings: string[]; infos: string[] } {
    const warnings: string[] = [];
    const infos: string[] = [];
    return {
      warnings,
      infos,
      logger: {
        debug: () => {},
        info: (m: string) => void infos.push(m),
        warning: (m: string) => void warnings.push(m),
        error: () => {},
      },
    };
  }

  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const spec of PROVIDER_KEYS) {
      saved.set(spec.env, process.env[spec.env]);
      delete process.env[spec.env];
    }
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it('warns loudly when no required provider key is set', () => {
    const { logger, warnings } = recordingLogger();
    warnIfNoCredentials([metadata({ is_authenticated: false })], logger);

    expect(warnings.join('\n')).toContain('No provider API keys detected');
    expect(warnings.join('\n')).toContain('smartrelay setup');
  });

  it('still warns when only keyless runners report as ready', () => {
    // Ollama needs no credential, so a naive `ready === 0` check would stay
    // silent on an install where every hosted model is unreachable.
    const { logger, warnings } = recordingLogger();
    warnIfNoCredentials(
      [metadata({ type: 'ollama', credentials_env_var: null, is_authenticated: true })],
      logger,
    );

    expect(warnings.join('\n')).toContain('No provider API keys detected');
  });

  it('stays quiet when every required key is present and nothing is missing', () => {
    process.env['NVIDIA_API_KEY'] = 'nvapi-x';
    process.env['OPENROUTER_API_KEY'] = 'sk-or-v1-x';

    const { logger, warnings, infos } = recordingLogger();
    warnIfNoCredentials([metadata({ is_authenticated: true })], logger);

    expect(warnings).toEqual([]);
    expect(infos).toEqual([]);
  });

  it('says nothing at all when no runners are registered', () => {
    const { logger, warnings, infos } = recordingLogger();
    warnIfNoCredentials([], logger);

    expect(warnings).toEqual([]);
    expect(infos).toEqual([]);
  });
});

describe('formatRunnerStatusLines', () => {
  it('marks authenticated and unauthenticated runners differently', () => {
    const [ready, blocked] = formatRunnerStatusLines([
      metadata({ runner_id: 'ready', is_authenticated: true }),
      metadata({ runner_id: 'blocked', is_authenticated: false }),
    ]);

    expect(ready).toContain('🟢 AUTHENTICATED');
    expect(blocked).toContain('🔴 MISSING_AUTH');
  });
});

describe('RunnerMetadata.setup_hint', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const spec of PROVIDER_KEYS) {
      saved.set(spec.env, process.env[spec.env]);
      delete process.env[spec.env];
    }
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it('names the env var and the fix for every unauthenticated runner', () => {
    const all = RunnerRegistry.fromYaml().getRunnersMetadata();
    const blocked = all.filter((r) => !r.is_authenticated);

    expect(blocked.length).toBeGreaterThan(0);
    for (const runner of blocked) {
      expect(runner.setup_hint).toContain('smartrelay setup');
      if (runner.credentials_env_var) {
        expect(runner.setup_hint).toContain(runner.credentials_env_var);
      }
    }
    for (const runner of all.filter((r) => r.is_authenticated)) {
      expect(runner.setup_hint).toBeNull();
    }
  });
});
