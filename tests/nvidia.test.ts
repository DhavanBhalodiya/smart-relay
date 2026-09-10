import { describe, expect, it } from 'vitest';

import { NVIDIARunner } from '../src/runners/nvidia.js';
import { RunnerRegistry } from '../src/runners/registry.js';

describe('NVIDIA NIM / API Catalog Runner', () => {
  it('loads nvidia runners correctly from config.yaml', () => {
    const registry = RunnerRegistry.fromYaml();
    const runner = registry.get('nemotron-3-super-120b-a12b');

    expect(runner).not.toBeNull();
    expect(runner).toBeInstanceOf(NVIDIARunner);
    expect(runner?.model).toBe('nvidia/nemotron-3-super-120b-a12b');
    expect(runner?.config.base_url).toBe('https://integrate.api.nvidia.com/v1');
    expect(runner?.config.api_key_env).toBe('NVIDIA_API_KEY');
  });

  it('handles missing NVIDIA API key gracefully', async () => {
    const runner = new NVIDIARunner({
      id: 'nvidia-test',
      type: 'nvidia',
      model: 'meta/llama-3.3-70b-instruct',
      api_key_env: 'NON_EXISTENT_NVIDIA_KEY_XYZ',
      base_url: null,
      cost_per_million_input_tokens: 0.7,
      cost_per_million_output_tokens: 0.9,
      default_params: {},
      timeout_seconds: 30,
    });

    delete process.env['NON_EXISTENT_NVIDIA_KEY_XYZ'];
    const result = await runner.execute('Explain GPUs');
    expect(result.success).toBe(false);
    expect(result.error_message).toContain('Authentication error');
    expect(result.error_message).toContain('NON_EXISTENT_NVIDIA_KEY_XYZ');
  });
});
