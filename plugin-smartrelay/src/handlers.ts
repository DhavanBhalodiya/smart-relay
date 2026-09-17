import { dispatchTool } from '@theone1345/smartrelay/dispatch';

import { configSchema, missingRequired, type SmartRelayConfig } from './config.schema.js';
import { applyConfigToEnv } from './env.js';
import { tools } from './tools.js';

const KNOWN_TOOLS = new Set(tools.map((tool) => tool.name));

/**
 * Tools that must answer even with no credentials configured.
 *
 * These are the settings tools MCPHub itself calls to render and verify the
 * plugin's state. Gating them behind "not configured" would be circular: the
 * host could never find out *that* it is unconfigured.
 */
const ALWAYS_AVAILABLE = new Set(
  tools.filter((tool) => tool.category === 'settings').map((tool) => tool.name),
);

/** Where to obtain each missing key, so the error names its own fix. */
const KEY_CONSOLES: Record<string, string> = {
  nvidiaApiKey: 'https://build.nvidia.com',
  openrouterApiKey: 'https://openrouter.ai/keys',
};

import type { McpContext } from './types.js';

/** Lets `smartrelay_configure` update the live config the plugin instance holds. */
export interface PluginState {
  config: SmartRelayConfig;
}

export async function handleToolCall(
  toolName: string,
  args: unknown,
  _context: McpContext,
  state: PluginState,
): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;

  switch (toolName) {
    case 'smartrelay_configure': {
      const merged = configSchema.parse({ ...state.config, ...a });
      state.config = merged;
      const keysSet = applyConfigToEnv(merged);
      // Deliberately does NOT write ~/.smartrelay/.env: the host owns its own
      // config store, and a plugin writing to the user's home directory would
      // fight `smartrelay setup` on the next run.
      return { status: 'configured', keys_set: keysSet, missing: missingRequired(merged) };
    }

    case 'smartrelay_remove':
      return { status: 'removed' };

    default: {
      // Reject an unrecognized name before the credential guard, so a typo
      // always reports as a typo instead of as "not configured".
      const canonical = toolName.startsWith('smartrelay_') ? toolName : `smartrelay_${toolName}`;
      if (!KNOWN_TOOLS.has(canonical)) throw new Error(`Unknown tool: ${toolName}`);

      const missing = missingRequired(state.config);
      if (missing.length && !ALWAYS_AVAILABLE.has(canonical)) {
        return {
          error:
            `SmartRelay is not configured. Missing required API keys: ${missing.join(', ')}.`,
          missing,
          // Spelled out so an agent reading this can complete setup itself
          // instead of only reporting the failure back to the user.
          how_to_fix: {
            option_1: 'Open the SmartRelay plugin settings and fill in the required keys.',
            option_2: `Call smartrelay_configure with { ${missing.map((f) => `"${f}": "..."`).join(', ')} }`,
            get_keys: Object.fromEntries(missing.map((f) => [f, KEY_CONSOLES[f] ?? ''])),
          },
        };
      }
      // Everything else goes straight to the shared dispatcher, which already
      // normalizes the `smartrelay_` prefix, validates required arguments, and
      // throws `Unknown tool:` for anything it does not handle. Adding a tool to
      // SmartRelay therefore reaches this plugin with no change here.
      return dispatchTool(toolName, a);
    }
  }
}
