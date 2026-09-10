/** Base classes and data models for LLM runners. */

import { round } from '../util.js';

/**
 * Configuration for a specific LLM runner.
 *
 * Field names mirror the YAML keys in `config/runners/*.yaml` verbatim so a
 * parsed config block maps straight onto this shape.
 */
export interface RunnerConfig {
  id: string;
  /** "anthropic", "openai", "ollama", etc. */
  type: string;
  model: string;
  api_key_env: string | null;
  base_url: string | null;
  cost_per_million_input_tokens: number;
  cost_per_million_output_tokens: number;
  default_params: Record<string, unknown>;
  timeout_seconds: number;
}

/**
 * Normalized result returned by any runner execution.
 *
 * Keys are snake_case and declared in the same order as the Python dataclass:
 * this object is serialized directly onto the wire, and both the test suite and
 * `plugin-smartrelay` depend on that exact shape.
 */
export interface RunnerResult {
  runner_id: string;
  model: string;
  task: string;
  output: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  success: boolean;
  error_message: string | null;
  raw_metadata: Record<string, unknown>;
  timestamp: string;
}

export interface RunnerResultInit {
  runner_id: string;
  model: string;
  task: string;
  output?: string;
  latency_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  success: boolean;
  error_message?: string | null;
  raw_metadata?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Build a `RunnerResult`, filling in the same defaults as the Python dataclass
 * and always emitting keys in declaration order so `JSON.stringify` reproduces
 * the original payload.
 */
export function makeRunnerResult(init: RunnerResultInit): RunnerResult {
  return {
    runner_id: init.runner_id,
    model: init.model,
    task: init.task,
    output: init.output ?? '',
    latency_ms: init.latency_ms ?? 0,
    input_tokens: init.input_tokens ?? 0,
    output_tokens: init.output_tokens ?? 0,
    estimated_cost_usd: init.estimated_cost_usd ?? 0,
    success: init.success,
    error_message: init.error_message ?? null,
    raw_metadata: init.raw_metadata ?? {},
    timestamp: init.timestamp ?? new Date().toISOString(),
  };
}

/** Serialize a result the way `RunnerResult.to_json()` did. */
export function runnerResultToJson(result: RunnerResult, indent: number | null = 2): string {
  return JSON.stringify(result, null, indent ?? undefined);
}

/** Inference parameters after merging runner defaults with per-request overrides. */
export interface ResolvedParams {
  maxTokens: number;
  temperature: number;
  systemPrompt: string | undefined;
  timeoutSeconds: number;
}

/**
 * Merge a runner's `default_params` with per-request overrides and pull out the
 * four values every backend needs. Overrides win, matching `dict.update()`.
 */
export function resolveParams(
  config: RunnerConfig,
  params?: Record<string, unknown> | null,
): ResolvedParams {
  const merged: Record<string, unknown> = { ...config.default_params, ...(params ?? {}) };
  const systemPrompt = merged['system_prompt'];

  return {
    maxTokens: (merged['max_tokens'] as number | undefined) ?? 2048,
    temperature: (merged['temperature'] as number | undefined) ?? 0.7,
    systemPrompt: typeof systemPrompt === 'string' && systemPrompt ? systemPrompt : undefined,
    timeoutSeconds: (merged['timeout_seconds'] as number | undefined) ?? config.timeout_seconds,
  };
}

/** Abstract base class for all LLM backend runners. */
export abstract class BaseRunner {
  constructor(public readonly config: RunnerConfig) {}

  get id(): string {
    return this.config.id;
  }

  get model(): string {
    return this.config.model;
  }

  /** Estimated cost in USD based on the configured per-million token rates. */
  calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1_000_000) * this.config.cost_per_million_input_tokens;
    const outputCost = (outputTokens / 1_000_000) * this.config.cost_per_million_output_tokens;
    return round(inputCost + outputCost, 6);
  }

  /**
   * Execute a task on the runner backend and return a normalized `RunnerResult`.
   *
   * Must never throw: errors are captured and returned as a result with
   * `success: false` and an `error_message`.
   */
  abstract execute(task: string, params?: Record<string, unknown> | null): Promise<RunnerResult>;
}
