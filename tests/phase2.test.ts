import { describe, expect, it } from 'vitest';

import { AnthropicRunner } from '../src/runners/anthropic.js';
import { NVIDIARunner } from '../src/runners/nvidia.js';
import { OllamaRunner } from '../src/runners/ollama.js';
import { OpenAIRunner } from '../src/runners/openai.js';
import { OpenRouterRunner } from '../src/runners/openrouter.js';
import { RunnerRegistry } from '../src/runners/registry.js';
import { listRunners } from '../src/tools/index.js';

describe('Phase 2: Multi-Runner Adapters and Registry', () => {
  it('instantiates all runner types correctly from config.yaml', () => {
    const registry = RunnerRegistry.fromYaml();
    const runnerIds = registry.registeredIds();

    expect(runnerIds).toContain('claude-3-7-sonnet');
    expect(runnerIds).toContain('gpt-4o');
    expect(runnerIds).toContain('gpt-4o-mini');
    expect(runnerIds).toContain('ollama-llama3.2');
    expect(runnerIds).toContain('nemotron-3-super-120b-a12b');
    expect(runnerIds.some((r) => r.startsWith('openrouter-'))).toBe(true);

    expect(registry.get('claude-3-7-sonnet')).toBeInstanceOf(AnthropicRunner);
    expect(registry.get('gpt-4o')).toBeInstanceOf(OpenAIRunner);
    expect(registry.get('ollama-llama3.2')).toBeInstanceOf(OllamaRunner);
    expect(registry.get('openrouter-claude-sonnet-4.5')).toBeInstanceOf(OpenRouterRunner);
    expect(registry.get('nemotron-3-super-120b-a12b')).toBeInstanceOf(NVIDIARunner);
  });

  it('handles missing API key gracefully for OpenAIRunner', async () => {
    const runner = new OpenAIRunner({
      id: 'test-gpt',
      type: 'openai',
      model: 'gpt-4o',
      api_key_env: 'NON_EXISTENT_OPENAI_KEY_XYZ',
      base_url: null,
      cost_per_million_input_tokens: 2.5,
      cost_per_million_output_tokens: 10.0,
      default_params: {},
      timeout_seconds: 30,
    });

    delete process.env['NON_EXISTENT_OPENAI_KEY_XYZ'];
    const result = await runner.execute('Test prompt');
    expect(result.success).toBe(false);
    expect(result.error_message).toContain('Authentication error');
    expect(result.error_message).toContain('NON_EXISTENT_OPENAI_KEY_XYZ');
  });

  it('returns valid metadata with pricing and auth status in listRunners', () => {
    const registry = RunnerRegistry.fromYaml();
    const rawList = listRunners(registry);
    const metadata = JSON.parse(rawList) as Array<{
      runner_id: string;
      type: string;
      model: string;
      pricing: { cost_per_million_input_tokens: number; cost_per_million_output_tokens: number };
      is_authenticated: boolean;
    }>;

    expect(Array.isArray(metadata)).toBe(true);
    expect(metadata.length).toBeGreaterThanOrEqual(10);

    const first = metadata[0];
    expect(first).toBeDefined();
    expect(first?.runner_id).toBeDefined();
    expect(first?.model).toBeDefined();
    expect(typeof first?.is_authenticated).toBe('boolean');
    expect(typeof first?.pricing.cost_per_million_input_tokens).toBe('number');
  });

  it('resolves aliases correctly via registry', () => {
    const registry = RunnerRegistry.fromYaml();
    // Ollama runners can be resolved by alias
    const qwen = registry.get('qwen-coder');
    expect(qwen).not.toBeNull();
    expect(qwen?.id).toBe('ollama-qwen-coder');
  });
});
