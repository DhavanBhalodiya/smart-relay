import { z } from 'zod';

/**
 * Plugin configuration — the user's own provider credentials.
 *
 * Every field defaults to `''` rather than being `.min(1)`: `initialize()` parses
 * this at plugin-load time, so a strict schema would throw on a fresh install and
 * leave the user with a dead plugin they can never reach the settings UI to fix.
 * "Required" is communicated through `getConfigMeta()` and enforced at call time.
 */
export const configSchema = z
  .object({
    nvidiaApiKey: z.string().default(''),
    openrouterApiKey: z.string().default(''),
    anthropicApiKey: z.string().default(''),
    openaiApiKey: z.string().default(''),
    /** Optional path to a config.yaml holding a custom runner set. */
    configPath: z.string().default(''),
  })
  .passthrough();

export type SmartRelayConfig = z.infer<typeof configSchema>;

/** Keys without which no hosted runner can be called. */
export const REQUIRED_FIELDS = ['nvidiaApiKey', 'openrouterApiKey'] as const;

/** Names of the required fields the user has not filled in yet. */
export function missingRequired(config: SmartRelayConfig): string[] {
  return REQUIRED_FIELDS.filter((field) => !config[field]);
}
