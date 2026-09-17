/** OpenAI API runner implementation. */

import OpenAI from 'openai';

import { authErrorMessage, BaseRunner, makeRunnerResult, resolveParams, type RunnerConfig, type RunnerResult } from './base.js';
import { describeError, startTimer } from '../util.js';

/**
 * Runner adapter for OpenAI models (GPT-4o, GPT-4o-mini, o3-mini, etc.).
 *
 * Serves as the base for every OpenAI-compatible gateway. Subclasses override
 * the protected hooks below to change the base URL, credential env var, extra
 * headers, and the provider name used in error messages.
 */
export class OpenAIRunner extends BaseRunner {
  protected readonly providerLabel: string = 'OpenAI';
  protected readonly defaultEnvVar: string = 'OPENAI_API_KEY';
  protected readonly defaultBaseUrl: string | null = null;

  private client: OpenAI | null = null;
  private clientKey: string | null = null;

  constructor(config: RunnerConfig) {
    super(config);
  }

  protected get envVarName(): string {
    return this.config.api_key_env || this.defaultEnvVar;
  }

  /** Extra headers to send with every request. */
  protected extraHeaders(): Record<string, string> | undefined {
    return undefined;
  }

  /** Message used when the request exceeds its deadline. */
  protected timeoutMessage(timeoutSeconds: number): string {
    return `Request timed out after ${timeoutSeconds} seconds.`;
  }

  /** Resolve the API key strictly from environment variables. */
  protected getApiKey(): string | undefined {
    return process.env[this.envVarName] || undefined;
  }

  private getClient(apiKey: string): OpenAI {
    if (this.client === null || this.clientKey !== apiKey) {
      const baseURL = this.config.base_url || this.defaultBaseUrl;
      const headers = this.extraHeaders();
      this.client = new OpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
        ...(headers ? { defaultHeaders: headers } : {}),
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
        error_message: authErrorMessage(this.envVarName, this.id),
      });
    }

    const timeoutMs = timeoutSeconds * 1000;

    try {
      const client = this.getClient(apiKey);

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: task });

      const response = await client.chat.completions.create(
        {
          model: this.model,
          messages,
          max_tokens: maxTokens,
          temperature,
        },
        { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) },
      );

      const choice = response.choices[0];
      const outputText = choice?.message.content || '';
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;

      return makeRunnerResult({
        runner_id: this.id,
        model: this.model,
        task,
        output: outputText,
        latency_ms: elapsed(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: this.calculateCost(inputTokens, outputTokens),
        success: true,
        error_message: null,
        raw_metadata: {
          finish_reason: choice ? choice.finish_reason : null,
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: response.usage?.total_tokens ?? 0,
          },
          system_fingerprint: response.system_fingerprint ?? null,
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
  protected describeFailure(error: unknown, timeoutSeconds: number): string {
    if (error instanceof OpenAI.APIConnectionTimeoutError || error instanceof OpenAI.APIUserAbortError) {
      return this.timeoutMessage(timeoutSeconds);
    }
    if (error instanceof OpenAI.AuthenticationError) {
      return `${this.providerLabel} authentication failed: ${error.message}`;
    }
    if (error instanceof OpenAI.RateLimitError) {
      return `${this.providerLabel} rate limit exceeded: ${error.message}`;
    }
    if (error instanceof OpenAI.APIError) {
      return `${this.providerLabel} API error (${error.status}): ${error.message}`;
    }
    return `Unexpected error executing ${this.providerLabel} runner: ${describeError(error)}`;
  }
}
