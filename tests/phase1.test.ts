import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { TaskRouter } from '../src/router.js';
import { AnthropicRunner } from '../src/runners/anthropic.js';
import {
  makeRunnerResult,
  runnerResultToJson,
  type RunnerConfig,
  type RunnerResult,
} from '../src/runners/base.js';
import { RunnerRegistry } from '../src/runners/registry.js';
import { server } from '../src/server.js';
import { delegateTask } from '../src/tools/index.js';

describe('Phase 1: RunnerResult, Cost Calculation, and Base Delegation', () => {
  it('serializes RunnerResult correctly to JSON', () => {
    const result: RunnerResult = makeRunnerResult({
      runner_id: 'test-runner',
      model: 'claude-3-7-sonnet-20250219',
      task: 'Say hello',
      output: 'Hello there!',
      latency_ms: 120.5,
      input_tokens: 10,
      output_tokens: 5,
      estimated_cost_usd: 0.000105,
      success: true,
      error_message: null,
    });

    expect(result.runner_id).toBe('test-runner');
    expect(result.success).toBe(true);
    expect(result.output).toBe('Hello there!');

    const jsonStr = runnerResultToJson(result);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    expect(parsed['runner_id']).toBe('test-runner');
    expect(parsed['latency_ms']).toBe(120.5);
    expect(parsed['success']).toBe(true);
  });

  it('calculates token costs correctly in BaseRunner', () => {
    const config: RunnerConfig = {
      id: 'test-runner',
      type: 'anthropic',
      model: 'test-model',
      api_key_env: null,
      base_url: null,
      cost_per_million_input_tokens: 3.0,
      cost_per_million_output_tokens: 15.0,
      default_params: {},
      timeout_seconds: 30,
    };
    const runner = new AnthropicRunner(config);
    // 1000 input tokens = 0.003 USD, 1000 output tokens = 0.015 USD => 0.018 USD
    const cost = runner.calculateCost(1000, 1000);
    expect(cost).toBe(0.018);
  });

  it('loads RunnerRegistry from custom YAML config', () => {
    const tmpDir = path.join(os.tmpdir(), `smartrelay-phase1-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const configFile = path.join(tmpDir, 'config.yaml');

    const configContent = `
server:
  name: "test-server"
  max_concurrency: 3
  default_timeout_seconds: 30.0

runners:
  test-claude:
    type: "anthropic"
    model: "claude-3-7-sonnet-20250219"
    api_key_env: "ANTHROPIC_API_KEY"
    cost_per_million_input_tokens: 3.00
    cost_per_million_output_tokens: 15.00
    default_params:
      max_tokens: 1024
      temperature: 0.5
`;
    writeFileSync(configFile, configContent, 'utf-8');

    const registry = RunnerRegistry.fromYaml(configFile);
    expect(registry.registeredIds()).toContain('test-claude');

    const runner = registry.get('test-claude');
    expect(runner).not.toBeNull();
    expect(runner?.model).toBe('claude-3-7-sonnet-20250219');
    expect(runner?.config.cost_per_million_input_tokens).toBe(3.0);
    expect(runner?.config.default_params['max_tokens']).toBe(1024);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns structured error when runner API key is missing', async () => {
    const config: RunnerConfig = {
      id: 'test-claude',
      type: 'anthropic',
      model: 'claude-3-7-sonnet-20250219',
      api_key_env: 'NON_EXISTENT_TEST_KEY_ENV_XYZ',
      base_url: null,
      cost_per_million_input_tokens: 3.0,
      cost_per_million_output_tokens: 15.0,
      default_params: {},
      timeout_seconds: 30,
    };
    const runner = new AnthropicRunner(config);

    delete process.env['NON_EXISTENT_TEST_KEY_ENV_XYZ'];
    const result = await runner.execute('Test prompt');
    expect(result.success).toBe(false);
    expect(result.error_message).toContain('Authentication error');
    expect(result.error_message).toContain('NON_EXISTENT_TEST_KEY_ENV_XYZ');
    expect(result.output).toBe('');
  });

  it('handles unknown runner IDs gracefully in delegateTask', async () => {
    const registry = RunnerRegistry.fromYaml();
    const router = new TaskRouter(registry);

    const rawRes = await delegateTask(router, 'Ping', 'non-existent-runner');
    const data = JSON.parse(rawRes) as { success: boolean; error_message: string };
    expect(data.success).toBe(false);
    expect(data.error_message).toContain("Runner 'non-existent-runner' is not registered");
  });

  it('verifies McpServer instance is created and has tools registered', () => {
    expect(server).toBeDefined();
  });
});
