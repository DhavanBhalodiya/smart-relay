/** Registry for discovering and managing configured LLM runners. */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { AnthropicRunner } from './anthropic.js';
import { NVIDIARunner } from './nvidia.js';
import { OllamaRunner } from './ollama.js';
import { OpenAIRunner } from './openai.js';
import { OpenRouterRunner } from './openrouter.js';
import type { BaseRunner, RunnerConfig } from './base.js';
import { getLogger } from '../logger.js';
import { describeError, findProjectRoot, resolveUserPath } from '../util.js';

const logger = getLogger('mcp_delegation_server.registry');

type RunnerFactory = new (config: RunnerConfig) => BaseRunner;

const RUNNER_FACTORIES: Record<string, RunnerFactory> = {
  anthropic: AnthropicRunner,
  openai: OpenAIRunner,
  ollama: OllamaRunner,
  openrouter: OpenRouterRunner,
  nvidia: NVIDIARunner,
};

/** Default credential env var per provider, used when a runner omits `api_key_env`. */
const DEFAULT_ENV_BY_TYPE: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
};

/** Provider prefixes tried when resolving a runner ID alias. */
const ALIAS_PREFIXES = ['openrouter-', 'ollama-', 'openai-', 'anthropic-'] as const;

/** Structured metadata for a registered runner, as returned by `list_runners`. */
export interface RunnerMetadata {
  runner_id: string;
  type: string;
  model: string;
  pricing: {
    cost_per_million_input_tokens: number;
    cost_per_million_output_tokens: number;
  };
  timeout_seconds: number;
  default_params: Record<string, unknown>;
  credentials_env_var: string | null;
  is_authenticated: boolean;
  base_url: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mtimeOf(filePath: string): number {
  return statSync(filePath).mtimeMs;
}

/** Registry maintaining runner instances configured via config.yaml, with auto-reload. */
export class RunnerRegistry {
  private runners = new Map<string, BaseRunner>();
  private watchedFiles = new Map<string, number>();

  serverConfig: Record<string, unknown> = {};
  configPath: string | null;

  constructor(configPath: string | null = null) {
    this.configPath = configPath;
  }

  /** Locate the config file, searching the standard locations in order. */
  static findConfigPath(customPath?: string | null): string {
    if (customPath) {
      if (existsSync(customPath)) return resolveUserPath(customPath);
      throw new Error(`Specified configuration file not found: ${customPath}`);
    }

    const envPath = process.env['MCP_CONFIG_PATH'];
    if (envPath) {
      if (existsSync(envPath)) return resolveUserPath(envPath);
      throw new Error(`Configuration file specified by MCP_CONFIG_PATH not found: ${envPath}`);
    }

    const projectRoot = findProjectRoot();
    const candidates = [
      path.join(process.cwd(), 'config.yaml'),
      path.join(process.cwd(), 'config.yml'),
      path.join(projectRoot, 'config.yaml'),
      path.join(projectRoot, 'config.yml'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return path.resolve(candidate);
    }

    throw new Error(
      'Could not locate config.yaml in current directory or project root. ' +
        'Set MCP_CONFIG_PATH environment variable to point to your config.yaml.',
    );
  }

  /** Create and populate a registry from a YAML config file. */
  static fromYaml(configPath?: string | null): RunnerRegistry {
    const registry = new RunnerRegistry(RunnerRegistry.findConfigPath(configPath));
    registry.reload();
    return registry;
  }

  /**
   * Load or reload runners from the YAML config and any included files.
   *
   * On failure the previously loaded runners are left in place, matching the
   * Python behavior of only swapping state in once parsing fully succeeds.
   */
  reload(): void {
    if (!this.configPath || !existsSync(this.configPath)) return;

    try {
      const configDir = path.dirname(this.configPath);
      const watched = new Map<string, number>([[this.configPath, mtimeOf(this.configPath)]]);

      const data = (parseYaml(readFileSync(this.configPath, 'utf-8')) ?? {}) as Record<string, unknown>;

      this.serverConfig = isRecord(data['server']) ? data['server'] : {};

      // Insertion order here determines the order of `list_runners`.
      const runnerDefs = new Map<string, unknown>();
      if (isRecord(data['runners'])) {
        for (const [id, def] of Object.entries(data['runners'])) runnerDefs.set(id, def);
      }

      const includes = data['includes'];
      if (Array.isArray(includes)) {
        for (const include of includes) {
          if (typeof include !== 'string') continue;
          const includePath = path.isAbsolute(include) ? include : path.join(configDir, include);

          if (existsSync(includePath) && statSync(includePath).isFile()) {
            watched.set(includePath, mtimeOf(includePath));
            this.mergeRunnerFile(includePath, runnerDefs);
          } else if (existsSync(includePath) && statSync(includePath).isDirectory()) {
            const yamlFiles = readdirSync(includePath)
              .filter((name) => /\.y.*ml$/.test(name))
              .sort()
              .map((name) => path.join(includePath, name));
            for (const yamlFile of yamlFiles) {
              watched.set(yamlFile, mtimeOf(yamlFile));
              this.mergeRunnerFile(yamlFile, runnerDefs);
            }
          }
        }
      }

      const nextRunners = new Map<string, BaseRunner>();

      for (const [runnerId, runnerInfo] of runnerDefs) {
        if (!isRecord(runnerInfo)) continue;
        const runnerType = runnerInfo['type'];
        if (typeof runnerType !== 'string' || !runnerType) continue;

        const defaultParams: Record<string, unknown> = isRecord(runnerInfo['default_params'])
          ? { ...runnerInfo['default_params'] }
          : {};

        const promptFile = defaultParams['system_prompt_file'] ?? runnerInfo['system_prompt_file'];
        if (typeof promptFile === 'string' && promptFile) {
          const promptPath = path.isAbsolute(promptFile) ? promptFile : path.join(configDir, promptFile);
          if (existsSync(promptPath) && statSync(promptPath).isFile()) {
            watched.set(promptPath, mtimeOf(promptPath));
            try {
              defaultParams['system_prompt'] = readFileSync(promptPath, 'utf-8').trim();
            } catch (error) {
              logger.warning(
                `Could not read prompt file ${promptPath} for runner ${runnerId}: ${describeError(error)}`,
              );
            }
          } else {
            logger.warning(`Prompt file ${promptPath} does not exist for runner ${runnerId}`);
          }
        }

        const config: RunnerConfig = {
          id: runnerId,
          type: runnerType,
          model: typeof runnerInfo['model'] === 'string' ? runnerInfo['model'] : runnerId,
          api_key_env: typeof runnerInfo['api_key_env'] === 'string' ? runnerInfo['api_key_env'] : null,
          base_url: typeof runnerInfo['base_url'] === 'string' ? runnerInfo['base_url'] : null,
          cost_per_million_input_tokens: Number(runnerInfo['cost_per_million_input_tokens'] ?? 0) || 0,
          cost_per_million_output_tokens: Number(runnerInfo['cost_per_million_output_tokens'] ?? 0) || 0,
          default_params: defaultParams,
          timeout_seconds:
            Number(runnerInfo['timeout_seconds'] ?? this.serverConfig['default_timeout_seconds'] ?? 60) || 60,
        };

        const Factory = RUNNER_FACTORIES[runnerType];
        if (Factory) nextRunners.set(runnerId, new Factory(config));
      }

      this.runners = nextRunners;
      this.watchedFiles = watched;
      logger.info(`Registry updated: loaded ${this.runners.size} runners from ${this.watchedFiles.size} files`);
    } catch (error) {
      logger.error(`Failed to reload configuration: ${describeError(error)}`);
    }
  }

  /** Merge the `runners` block of one YAML file into the accumulated definitions. */
  private mergeRunnerFile(filePath: string, into: Map<string, unknown>): void {
    try {
      const parsed = (parseYaml(readFileSync(filePath, 'utf-8')) ?? {}) as Record<string, unknown>;
      if (isRecord(parsed['runners'])) {
        for (const [id, def] of Object.entries(parsed['runners'])) into.set(id, def);
      }
    } catch (error) {
      logger.warning(`Failed to load included config ${filePath}: ${describeError(error)}`);
    }
  }

  /** Reload if the config, any include, or any prompt file has changed on disk. */
  reloadIfModified(): void {
    if (this.watchedFiles.size === 0) {
      if (this.configPath && existsSync(this.configPath)) this.reload();
      return;
    }

    try {
      for (const [filePath, recordedMtime] of this.watchedFiles) {
        if (!existsSync(filePath) || mtimeOf(filePath) > recordedMtime) {
          this.reload();
          break;
        }
      }
    } catch {
      // A transient stat failure should not take the server down.
    }
  }

  /**
   * Get a runner by ID, with auto-reload and alias matching.
   *
   * Resolution order is significant: exact, then case-insensitive, then
   * provider-prefix add/strip, then match against the model name.
   */
  get(runnerId: string): BaseRunner | null {
    this.reloadIfModified();

    const exact = this.runners.get(runnerId);
    if (exact) return exact;

    const lowered = runnerId.toLowerCase();
    for (const [id, runner] of this.runners) {
      if (id.toLowerCase() === lowered) return runner;
    }

    for (const prefix of ALIAS_PREFIXES) {
      const prefixed = this.runners.get(`${prefix}${runnerId}`);
      if (prefixed) return prefixed;

      if (runnerId.startsWith(prefix)) {
        const unprefixed = this.runners.get(runnerId.slice(prefix.length));
        if (unprefixed) return unprefixed;
      }
    }

    for (const runner of this.runners.values()) {
      if (runner.model.toLowerCase() === lowered) return runner;
    }

    return null;
  }

  /** All registered runners, keyed by ID. */
  listRunners(): Map<string, BaseRunner> {
    this.reloadIfModified();
    return new Map(this.runners);
  }

  /** IDs of all registered runners, in config order. */
  registeredIds(): string[] {
    this.reloadIfModified();
    return [...this.runners.keys()];
  }

  /** Structured metadata for every registered runner. */
  getRunnersMetadata(): RunnerMetadata[] {
    this.reloadIfModified();

    const metadata: RunnerMetadata[] = [];
    for (const [runnerId, runner] of this.runners) {
      const cfg = runner.config;

      let isReady = true;
      if (cfg.api_key_env) {
        isReady = Boolean(process.env[cfg.api_key_env]);
      } else if (DEFAULT_ENV_BY_TYPE[cfg.type]) {
        isReady = Boolean(process.env[DEFAULT_ENV_BY_TYPE[cfg.type] as string]);
      }

      metadata.push({
        runner_id: runnerId,
        type: cfg.type,
        model: cfg.model,
        pricing: {
          cost_per_million_input_tokens: cfg.cost_per_million_input_tokens,
          cost_per_million_output_tokens: cfg.cost_per_million_output_tokens,
        },
        timeout_seconds: cfg.timeout_seconds,
        default_params: cfg.default_params,
        credentials_env_var: cfg.api_key_env,
        is_authenticated: isReady,
        base_url: cfg.base_url,
      });
    }
    return metadata;
  }
}
