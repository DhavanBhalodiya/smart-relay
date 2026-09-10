import { describe, expect, it } from 'vitest';

import { server } from '../src/server.js';

interface RegisteredTool {
  description: string;
  executor: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

describe('MCP Server Tool Registration and Execution', () => {
  const registeredTools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools;

  it('registers all 13 core MCP tools', () => {
    const expectedTools = [
      'switch_model',
      'get_active_model',
      'create_plan',
      'review_code',
      'generate_tests',
      'ask_subagent',
      'review_file',
      'test_file',
      'explain_code',
      'explain_file',
      'list_runners',
      'delegate_task',
      'benchmark_run',
    ];

    const actualTools = Object.keys(registeredTools);
    for (const expected of expectedTools) {
      expect(actualTools).toContain(expected);
      expect(typeof registeredTools[expected]?.executor).toBe('function');
    }
  });

  it('executes switch_model via tool executor', async () => {
    const tool = registeredTools['switch_model'];
    expect(tool).toBeDefined();

    const res = await tool.executor({ model: 'auto' });
    expect(res.content.length).toBeGreaterThan(0);
    expect(res.content[0]?.text).toContain("Switched to 'auto' mode");
  });

  it('executes get_active_model via tool executor', async () => {
    const tool = registeredTools['get_active_model'];
    expect(tool).toBeDefined();

    const res = await tool.executor({});
    expect(res.content.length).toBeGreaterThan(0);
    const info = JSON.parse(res.content[0]?.text ?? '{}') as { mode: string };
    expect(info.mode).toBe('auto');
  });

  it('executes list_runners via tool executor', async () => {
    const tool = registeredTools['list_runners'];
    expect(tool).toBeDefined();

    const res = await tool.executor({});
    expect(res.content.length).toBeGreaterThan(0);
    const runners = JSON.parse(res.content[0]?.text ?? '[]') as Array<{ runner_id: string }>;
    expect(Array.isArray(runners)).toBe(true);
    expect(runners.some((r) => r.runner_id === 'nemotron-3-super-120b-a12b')).toBe(true);
  });

  it('handles delegate_task with unknown runner gracefully via tool executor', async () => {
    const tool = registeredTools['delegate_task'];
    expect(tool).toBeDefined();

    const res = await tool.executor({
      task: 'Hello world',
      runner_id: 'unknown-runner-id',
    });
    expect(res.content.length).toBeGreaterThan(0);
    const parsed = JSON.parse(res.content[0]?.text ?? '{}') as {
      success: boolean;
      error_message: string;
    };
    expect(parsed.success).toBe(false);
    expect(parsed.error_message).toContain('is not registered');
  });
});
