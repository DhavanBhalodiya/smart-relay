import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectClients, registerJsonClient, type McpClient } from '../src/install.js';

function jsonClient(configPath: string): McpClient {
  return {
    id: 'cursor',
    label: 'Cursor',
    kind: 'json',
    configPath,
    detected: true,
    manual: 'manual instructions',
  };
}

describe('detectClients', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'smartrelay-clients-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('lists every supported client', () => {
    const ids = detectClients({ home, claudeCli: false }).map((c) => c.id);
    expect(ids).toEqual(['claude-code', 'claude-desktop', 'cursor', 'windsurf']);
  });

  it('marks a client detected once its directory exists', () => {
    const before = detectClients({ home, claudeCli: false }).find((c) => c.id === 'cursor');
    expect(before?.detected).toBe(false);

    mkdirSync(path.join(home, '.cursor'), { recursive: true });
    const after = detectClients({ home, claudeCli: false }).find((c) => c.id === 'cursor');
    expect(after?.detected).toBe(true);
  });

  it('reports Claude Code from the CLI probe rather than a path', () => {
    expect(detectClients({ home, claudeCli: true })[0]?.detected).toBe(true);
    expect(detectClients({ home, claudeCli: false })[0]?.detected).toBe(false);
  });

  it('offers manual instructions for every client', () => {
    for (const client of detectClients({ home, claudeCli: false })) {
      expect(client.manual.length).toBeGreaterThan(0);
    }
  });
});

describe('registerJsonClient', () => {
  let home: string;
  let config: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'smartrelay-clients-'));
    config = path.join(home, '.cursor', 'mcp.json');
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('creates the file and its directory when neither exists', () => {
    const result = registerJsonClient(jsonClient(config));

    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(config, 'utf-8')).mcpServers.smartrelay).toEqual({
      command: 'npx',
      args: ['-y', '@theone1345/smartrelay'],
    });
  });

  it('keeps the user other MCP servers and unrelated top-level keys', () => {
    mkdirSync(path.dirname(config), { recursive: true });
    writeFileSync(
      config,
      JSON.stringify({
        mcpServers: { github: { command: 'gh-mcp' } },
        someOtherSetting: { keep: true },
      }),
    );

    const result = registerJsonClient(jsonClient(config));
    const written = JSON.parse(readFileSync(config, 'utf-8'));

    expect(result.ok).toBe(true);
    expect(written.mcpServers.github).toEqual({ command: 'gh-mcp' });
    expect(written.someOtherSetting).toEqual({ keep: true });
    expect(written.mcpServers.smartrelay).toBeDefined();
  });

  it('backs up the previous config before touching it', () => {
    mkdirSync(path.dirname(config), { recursive: true });
    writeFileSync(config, JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } }));

    const result = registerJsonClient(jsonClient(config));

    expect(result.backup).toBeDefined();
    expect(JSON.parse(readFileSync(result.backup as string, 'utf-8')).mcpServers.smartrelay).toBeUndefined();
  });

  it('replaces an existing smartrelay entry rather than duplicating it', () => {
    mkdirSync(path.dirname(config), { recursive: true });
    writeFileSync(config, JSON.stringify({ mcpServers: { smartrelay: { command: 'old' } } }));

    const result = registerJsonClient(jsonClient(config));
    const written = JSON.parse(readFileSync(config, 'utf-8'));

    expect(result.message).toContain('updated');
    expect(written.mcpServers.smartrelay.command).toBe('npx');
    expect(Object.keys(written.mcpServers)).toEqual(['smartrelay']);
  });

  it('refuses to touch a config that is not valid JSON', () => {
    mkdirSync(path.dirname(config), { recursive: true });
    writeFileSync(config, '{ this is not json');

    const result = registerJsonClient(jsonClient(config));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('left unchanged');
    expect(readFileSync(config, 'utf-8')).toBe('{ this is not json');
  });

  it('refuses to touch a config whose root is not an object', () => {
    mkdirSync(path.dirname(config), { recursive: true });
    writeFileSync(config, '["an array"]');

    const result = registerJsonClient(jsonClient(config));

    expect(result.ok).toBe(false);
    expect(readFileSync(config, 'utf-8')).toBe('["an array"]');
  });

  it('leaves no temp file behind', () => {
    registerJsonClient(jsonClient(config));
    expect(existsSync(`${config}.tmp-${process.pid}`)).toBe(false);
  });
});
