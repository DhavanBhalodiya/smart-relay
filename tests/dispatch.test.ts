import { describe, expect, it } from 'vitest';

import { tools } from '../plugin-smartrelay/src/tools.js';
import { dispatchTool } from '../src/tools/dispatch.js';

describe('dispatchTool', () => {
  it('accepts a tool name with or without the smartrelay_ prefix', async () => {
    const bare = await dispatchTool('list_runners');
    const prefixed = await dispatchTool('smartrelay_list_runners');

    expect(typeof bare).toBe('string');
    expect(typeof prefixed).toBe('string');
  });

  it('rejects an unknown tool by name', async () => {
    await expect(dispatchTool('nope')).rejects.toThrow('Unknown tool: nope');
  });

  it('reports a missing required argument without calling a model', async () => {
    await expect(dispatchTool('review_code', {})).resolves.toEqual({
      error: 'Missing required argument: code',
    });
  });
});

describe('plugin/dispatch tool-surface parity', () => {
  const declared = tools.map((t) => t.name);

  it('declares every tool without duplicates', () => {
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('can dispatch every tool the plugin advertises', async () => {
    // Regression lock: the plugin used to advertise 18 tools while dispatch
    // handled 20, so two audit tools were unreachable through MCPHub.
    const undispatchable: string[] = [];

    for (const name of declared) {
      // Handled inside the plugin, never forwarded to dispatch.
      if (name === 'smartrelay_configure' || name === 'smartrelay_remove') continue;
      try {
        await dispatchTool(name, {});
      } catch (err) {
        if (String(err).includes('Unknown tool')) undispatchable.push(name);
      }
    }

    expect(undispatchable).toEqual([]);
  });
});
