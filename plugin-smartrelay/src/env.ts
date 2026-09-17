import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SmartRelayConfig } from './config.schema.js';

/** Plugin config field → the environment variable the runners actually read. */
const ENV_BY_FIELD: Record<string, string> = {
  nvidiaApiKey: 'NVIDIA_API_KEY',
  openrouterApiKey: 'OPENROUTER_API_KEY',
  anthropicApiKey: 'ANTHROPIC_API_KEY',
  openaiApiKey: 'OPENAI_API_KEY',
};

/**
 * Publish the configured credentials into `process.env`, where the runner
 * registry looks them up.
 *
 * Note the inversion from `loadDotEnv()`: there, an already-exported variable
 * wins over any file. Here a non-empty config value OVERWRITES the ambient one,
 * because a key typed into this plugin's settings is the user's explicit choice
 * for this plugin, not a fallback.
 *
 * Caveat, documented rather than solved: `process.env` is global to the host
 * process. If the gateway runs other plugins in-process, they will observe these
 * values too. Isolating this properly means threading a credential map down to
 * `BaseRunner.getApiKey()` — a change across all five runners, deliberately left
 * for later.
 *
 * Returns the names of the variables that were set.
 */
export function applyConfigToEnv(config: SmartRelayConfig): string[] {
  const applied: string[] = [];

  for (const [field, envVar] of Object.entries(ENV_BY_FIELD)) {
    const value = (config as Record<string, unknown>)[field];
    // Empty values are skipped, never written: assigning '' would shadow a
    // legitimate ambient key and flip the runner to unauthenticated.
    if (typeof value === 'string' && value) {
      process.env[envVar] = value;
      applied.push(envVar);
    }
  }

  // `RunnerRegistry.findConfigPath()` checks `process.cwd()` before the package
  // root, and inside a host gateway the cwd is not ours — a stray config.yaml
  // sitting there would silently win. Pin the path explicitly.
  const configPath = config.configPath || packagedConfigPath();
  if (configPath) {
    process.env['MCP_CONFIG_PATH'] = configPath;
    applied.push('MCP_CONFIG_PATH');
  }

  return applied;
}

/** The `config.yaml` shipped inside the installed `@theone1345/smartrelay`. */
function packagedConfigPath(): string {
  try {
    const entry = fileURLToPath(import.meta.resolve('@theone1345/smartrelay/package.json'));
    return path.join(path.dirname(entry), 'config.yaml');
  } catch {
    return '';
  }
}
