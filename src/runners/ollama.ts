/** Ollama local HTTP runner implementation. */

import { BaseRunner, makeRunnerResult, resolveParams, type RunnerConfig, type RunnerResult } from './base.js';
import { describeError, startTimer } from '../util.js';

/** Node's fetch reports connection failures via `error.cause.code`. */
const CONNECT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  'EAI_AGAIN',
]);

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function isConnectFailure(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === 'string' && CONNECT_ERROR_CODES.has(cause.code);
}

/** Runner adapter for local LLMs served by Ollama (Llama 3, DeepSeek, Mistral, Qwen). */
export class OllamaRunner extends BaseRunner {
  private readonly baseUrl: string;

  constructor(config: RunnerConfig) {
    super(config);
    this.baseUrl = (config.base_url || 'http://localhost:11434').replace(/\/+$/, '');
  }

  override async execute(task: string, params?: Record<string, unknown> | null): Promise<RunnerResult> {
    const elapsed = startTimer();
    const { maxTokens, temperature, systemPrompt, timeoutSeconds } = resolveParams(this.config, params);

    const payload: Record<string, unknown> = {
      model: this.model,
      prompt: task,
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
      },
    };
    if (systemPrompt) payload['system'] = systemPrompt;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        // httpx takes seconds; AbortSignal.timeout takes milliseconds.
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
      });

      if (!response.ok) {
        return makeRunnerResult({
          runner_id: this.id,
          model: this.model,
          task,
          latency_ms: elapsed(),
          success: false,
          error_message: `Ollama returned HTTP error (${response.status}): ${await response.text()}`,
        });
      }

      const data = (await response.json()) as Record<string, unknown>;
      const inputTokens = Number(data['prompt_eval_count'] ?? 0) || 0;
      const outputTokens = Number(data['eval_count'] ?? 0) || 0;

      return makeRunnerResult({
        runner_id: this.id,
        model: this.model,
        task,
        output: typeof data['response'] === 'string' ? data['response'] : '',
        latency_ms: elapsed(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        // Local models cost 0.00 USD unless custom pricing is configured.
        estimated_cost_usd: this.calculateCost(inputTokens, outputTokens),
        success: true,
        error_message: null,
        raw_metadata: {
          total_duration_ns: data['total_duration'] ?? null,
          load_duration_ns: data['load_duration'] ?? null,
          prompt_eval_duration_ns: data['prompt_eval_duration'] ?? null,
          eval_duration_ns: data['eval_duration'] ?? null,
          context: data['context'] ?? null,
        },
      });
    } catch (error) {
      let message: string;
      if (isTimeout(error)) {
        message = `Request to Ollama timed out after ${timeoutSeconds} seconds.`;
      } else if (isConnectFailure(error)) {
        message =
          `Could not connect to Ollama server at '${this.baseUrl}'. ` +
          "Ensure Ollama is installed and running ('ollama serve').";
      } else {
        message = `Unexpected error communicating with Ollama: ${describeError(error)}`;
      }

      return makeRunnerResult({
        runner_id: this.id,
        model: this.model,
        task,
        latency_ms: elapsed(),
        success: false,
        error_message: message,
      });
    }
  }
}
