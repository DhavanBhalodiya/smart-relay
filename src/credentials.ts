/**
 * Shared vocabulary for "which provider keys matter".
 *
 * Used by the setup wizard (`src/setup.ts`), the server's startup credential
 * warning, the runner auth-error message, and the MCPHub plugin — so there is
 * exactly one list of providers and one definition of what "ready" means.
 */

import type { Logger } from './logger.js';
import type { RunnerMetadata } from './runners/registry.js';

/** Published package name, used to build every install and setup command. */
export const PACKAGE_NAME = '@theone1345/smartrelay';

/** The exact command the user should run to configure credentials. */
export const SETUP_COMMAND = `npx ${PACKAGE_NAME} setup`;

/** One-shot command: prompts for keys, then registers the MCP server. */
export const INSTALL_COMMAND = `npx ${PACKAGE_NAME} init`;

/** One-line nudge appended to errors and warnings. */
export const SETUP_HINT = `Run \`${SETUP_COMMAND}\` to store your provider API keys.`;

export interface KeySpec {
  /** Environment variable the runners actually read. */
  env: string;
  /** Human-readable provider name shown in the wizard. */
  label: string;
  /** Required keys block a successful setup; optional ones can be skipped. */
  required: boolean;
  /** Expected key prefix, used for a warning only — never to reject a value. */
  prefix: string | null;
  /** Where the user goes to obtain the key. */
  consoleUrl: string;
  /** Matching field name in the MCPHub plugin's config schema. */
  configField: string;
}

/**
 * Providers the wizard asks about, in prompt order.
 *
 * NVIDIA and OpenRouter are required because every sub-agent in
 * `config/runners/agents.yaml` is backed by one of them. Anthropic and OpenAI
 * unlock additional runners but nothing depends on them.
 */
export const PROVIDER_KEYS: readonly KeySpec[] = [
  {
    env: 'NVIDIA_API_KEY',
    label: 'NVIDIA NIM / API Catalog',
    required: true,
    prefix: 'nvapi-',
    consoleUrl: 'https://build.nvidia.com',
    configField: 'nvidiaApiKey',
  },
  {
    env: 'OPENROUTER_API_KEY',
    label: 'OpenRouter',
    required: true,
    prefix: 'sk-or-v1-',
    consoleUrl: 'https://openrouter.ai/keys',
    configField: 'openrouterApiKey',
  },
  {
    env: 'ANTHROPIC_API_KEY',
    label: 'Anthropic',
    required: false,
    prefix: 'sk-ant-',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    configField: 'anthropicApiKey',
  },
  {
    env: 'OPENAI_API_KEY',
    label: 'OpenAI',
    required: false,
    prefix: 'sk-',
    consoleUrl: 'https://platform.openai.com/api-keys',
    configField: 'openaiApiKey',
  },
] as const;

/** Look up a spec by environment variable name. */
export function findKeySpec(envVar: string): KeySpec | undefined {
  return PROVIDER_KEYS.find((spec) => spec.env === envVar);
}

/** Shortest key length that still leaves something to hide in the middle. */
const MASKABLE_LENGTH = 12;

/**
 * Render a secret for display: enough to recognize, never enough to use.
 *
 * Short values are replaced wholesale — a 10-character key would otherwise be
 * almost fully revealed by a first-6/last-4 split.
 */
export function maskKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < MASKABLE_LENGTH) return '****';
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

/**
 * Check a key against its expected shape.
 *
 * Returns a warning string or `null`. It never throws and never rejects:
 * providers rotate their key formats, and a wizard that refuses a valid new-style
 * key is worse than one that saves an invalid one.
 */
export function validateKeyFormat(spec: KeySpec, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (spec.prefix && !trimmed.startsWith(spec.prefix)) {
    return `expected ${spec.env} to start with "${spec.prefix}"`;
  }
  if (trimmed.length < 20) {
    return `${spec.env} looks short (${trimmed.length} characters)`;
  }
  if (/\s/.test(trimmed)) {
    return `${spec.env} contains whitespace`;
  }
  return null;
}

export interface CredentialSummary {
  /** Runners whose credential env var is populated. */
  ready: number;
  /** Total registered runners. */
  total: number;
  /** Deduped env vars that unauthenticated runners are waiting on, in config order. */
  missingEnvVars: string[];
  /** Required provider keys (per `PROVIDER_KEYS`) absent from the environment. */
  missingRequired: string[];
}

/**
 * True when not one required provider key is set.
 *
 * Deliberately not `ready === 0`: runners that need no credential (Ollama)
 * report as authenticated, so a count alone reads "healthy" on an install where
 * every hosted model is unreachable.
 */
export function noProviderKeysConfigured(summary: CredentialSummary): boolean {
  return summary.missingRequired.length === PROVIDER_KEYS.filter((spec) => spec.required).length;
}

/** Roll runner metadata up into the counts the wizard and startup warning print. */
export function summarizeCredentials(metadata: RunnerMetadata[]): CredentialSummary {
  const missingEnvVars: string[] = [];
  let ready = 0;

  for (const runner of metadata) {
    if (runner.is_authenticated) {
      ready++;
      continue;
    }
    const envVar = runner.credentials_env_var;
    if (envVar && !missingEnvVars.includes(envVar)) missingEnvVars.push(envVar);
  }

  const missingRequired = PROVIDER_KEYS.filter(
    (spec) => spec.required && !process.env[spec.env],
  ).map((spec) => spec.env);

  return { ready, total: metadata.length, missingEnvVars, missingRequired };
}

/**
 * Render the runner readiness table.
 *
 * Shared by `smartrelay setup` and `npm run quick-test -- --list` so both always
 * show the same thing.
 */
export function formatRunnerStatusLines(metadata: RunnerMetadata[]): string[] {
  return metadata.map((runner) => {
    const auth = runner.is_authenticated ? '🟢 AUTHENTICATED' : '🔴 MISSING_AUTH';
    const cost =
      `$${runner.pricing.cost_per_million_input_tokens}/` +
      `$${runner.pricing.cost_per_million_output_tokens} per M`;
    return `- ${runner.runner_id.padEnd(30)} [${runner.model}] ${auth.padEnd(20)} ${cost}`;
  });
}

/**
 * Tell the operator, at startup, that nothing will work.
 *
 * Two hard rules, both load-bearing:
 *   - Log only. `getLogger` writes to stderr; a single byte on stdout would
 *     corrupt the stdio transport's JSON-RPC framing.
 *   - Never throw and never exit. An MCP client renders a non-zero exit as
 *     "server crashed", and missing credentials must stay a recoverable state
 *     the user can fix without restarting anything.
 */
export function warnIfNoCredentials(metadata: RunnerMetadata[], logger: Logger): void {
  let summary: CredentialSummary;
  try {
    summary = summarizeCredentials(metadata);
  } catch {
    return;
  }
  if (summary.total === 0) return;

  if (noProviderKeysConfigured(summary)) {
    logger.warning(
      `No provider API keys detected — only ${summary.ready} of ${summary.total} runners are usable ` +
        '(those needing no credentials). Every hosted model will fail until a key is configured.',
    );
    logger.warning(`Fix: ${SETUP_COMMAND}`);
    logger.warning(
      `Or set ${summary.missingRequired.join(' / ')} in your MCP client's "env" block.`,
    );
  } else if (summary.missingEnvVars.length) {
    logger.info(
      `Credentials: ${summary.ready}/${summary.total} runners authenticated. ` +
        `Missing: ${summary.missingEnvVars.join(', ')}.`,
    );
  }
}
