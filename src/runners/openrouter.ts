/** OpenRouter API runner implementation. */

import { OpenAIRunner } from './openai.js';

/** Runner adapter for models accessed via the OpenRouter API gateway. */
export class OpenRouterRunner extends OpenAIRunner {
  static readonly DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

  protected override readonly providerLabel = 'OpenRouter';
  protected override readonly defaultEnvVar = 'OPENROUTER_API_KEY';
  protected override readonly defaultBaseUrl = OpenRouterRunner.DEFAULT_BASE_URL;

  protected override extraHeaders(): Record<string, string> {
    return {
      'HTTP-Referer': 'https://github.com/mcp-delegation-server',
      'X-Title': 'MCP Delegation Server',
    };
  }

  protected override timeoutMessage(timeoutSeconds: number): string {
    return `Request to OpenRouter timed out after ${timeoutSeconds} seconds.`;
  }
}
