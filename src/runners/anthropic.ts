/** Anthropic API runner implementation. */

import Anthropic, {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
} from '@anthropic-ai/sdk';

import { BaseRunner, makeRunnerResult, resolveParams, type RunnerConfig, type RunnerResult } from './base.js';
import { describeError, startTimer } from '../util.js';

/** Runner adapter for Anthropic Claude models via the official SDK. */
export class AnthropicRunner extends BaseRunner {
  private client: Anthropic | null = null;
  private clientKey: string | null = null;

  constructor(config: RunnerConfig) {
    super(config);
  }

  private get envVarName(): string {
    return this.config.api_key_env || 'ANTHROPIC_API_KEY';
  }

  /** Resolve the API key strictly from environment variables. */
  private getApiKey(): string | undefined {
    return process.env[this.envVarName] || undefined;
  }

  private getClient(apiKey: string): Anthropic {
    if (this.client === null || this.clientKey !== apiKey) {
      this.client = new Anthropic({
        apiKey,
        ...(this.config.base_url ? { baseURL: this.config.base_url } : {}),
      });
      this.clientKey = apiKey;
    }
    return this.client;
  }

  override async execute(task: string, params?: Record<string, unknown> | null): Promise<RunnerResult> {
    const elapsed = startTimer();
    const { maxTokens, temperature, systemPrompt, timeoutSeconds } = resolveParams(this.config, params);

    const apiKey = this.getApiKey();
    if (!apiKey) {
      return makeRunnerResult({
        runner_id: this.id,
        model: this.model,
        task,
        latency_ms: elapsed(),
        success: false,
        error_message:
          `Authentication error: Environment variable '${this.envVarName}' is not set. ` +
          `Please export ${this.envVarName}=<your-key> to use runner '${this.id}'.`,
      });
    }

    const timeoutMs = timeoutSeconds * 1000;

    try {
      const client = this.getClient(apiKey);

      const response = await client.messages.create(
        {
          model: this.model,
          messages: [{ role: 'user', content: task }],
          max_tokens: maxTokens,
          temperature,
          ...(systemPrompt ? { system: systemPrompt } : {}),
        },
        { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) },
      );

      const chunks: string[] = [];
      for (const block of response.content) {
        if (block.type === 'text') {
          chunks.push(block.text);
        } else if ('text' in block && typeof (block as { text?: unknown }).text === 'string') {
          chunks.push((block as { text: string }).text);
        }
      }

      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;

      return makeRunnerResult({
        runner_id: this.id,
        model: this.model,
        task,
        output: chunks.join(''),
        latency_ms: elapsed(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: this.calculateCost(inputTokens, outputTokens),
        success: true,
        error_message: null,
        raw_metadata: {
          stop_reason: response.stop_reason,
          stop_sequence: response.stop_sequence,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: response.usage?.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: response.usage?.cache_read_input_tokens ?? 0,
          },
        },
      });
    } catch (error) {
      return makeRunnerResult({
        runner_id: this.id,
        model: this.model,
        task,
        latency_ms: elapsed(),
        success: false,
        error_message: this.describeFailure(error, timeoutSeconds),
      });
    }
  }

  /** Map SDK exceptions onto the same messages the Python implementation produced. */
  private describeFailure(error: unknown, timeoutSeconds: number): string {
    if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) {
      return `Request timed out after ${timeoutSeconds} seconds.`;
    }
    if (error instanceof AuthenticationError) {
      return `Anthropic authentication failed: ${error.message}`;
    }
    if (error instanceof RateLimitError) {
      return `Anthropic rate limit exceeded: ${error.message}`;
    }
    if (error instanceof APIError) {
      return `Anthropic API error (${error.status}): ${error.message}`;
    }
    return `Unexpected error executing Anthropic runner: ${describeError(error)}`;
  }
}
