/** NVIDIA NIM / API Catalog runner implementation. */

import { OpenAIRunner } from './openai.js';
import type { RunnerConfig } from './base.js';

/**
 * Runner adapter for NVIDIA NIM and the NVIDIA API Catalog (build.nvidia.com).
 *
 * Like the Python original this only swaps in NVIDIA's base URL and credential
 * env var; it deliberately inherits OpenAI's error-message wording.
 */
export class NVIDIARunner extends OpenAIRunner {
  static readonly DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';

  constructor(config: RunnerConfig) {
    // Backfilled onto the config itself (before `super`, which is legal because
    // it does not touch `this`) so `getRunnersMetadata()` reports the effective
    // base URL and env var rather than the empty YAML values.
    if (!config.base_url) config.base_url = NVIDIARunner.DEFAULT_BASE_URL;
    if (!config.api_key_env) config.api_key_env = 'NVIDIA_API_KEY';
    super(config);
  }

  protected override readonly defaultEnvVar = 'NVIDIA_API_KEY';
}
