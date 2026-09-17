import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PROVIDER_KEYS } from '../src/credentials.js';
import { mergeEnvText, runSetup, writeGlobalEnv } from '../src/setup.js';

const onPosix = process.platform !== 'win32';

/** Collects everything the wizard prints so assertions can inspect it. */
function collector(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, text: () => chunks.join('') };
}

describe('mergeEnvText', () => {
  it('replaces a key in place and leaves everything else untouched', () => {
    const original = 'CUSTOM=keepme\n# my note\nNVIDIA_API_KEY=old\n';
    const merged = mergeEnvText(original, new Map([['NVIDIA_API_KEY', 'new']]));

    expect(merged).toContain('CUSTOM=keepme');
    expect(merged).toContain('# my note');
    expect(merged).toContain('NVIDIA_API_KEY=new');
    expect(merged).not.toContain('old');
    expect(merged.match(/^NVIDIA_API_KEY=/gm)).toHaveLength(1);
  });

  it('collapses a key that was already defined twice', () => {
    const merged = mergeEnvText('A=1\nB=2\nA=3\n', new Map([['A', '9']]));
    expect(merged.match(/^A=/gm)).toHaveLength(1);
    expect(merged).toContain('A=9');
    expect(merged).toContain('B=2');
  });

  it('appends unknown keys under a single dated header', () => {
    const merged = mergeEnvText('EXISTING=1\n', new Map([['NEW_A', 'a'], ['NEW_B', 'b']]));
    expect(merged.match(/# Added by smartrelay setup/g)).toHaveLength(1);
    expect(merged).toContain('NEW_A=a');
    expect(merged).toContain('NEW_B=b');
  });

  it('quotes values that a bare write would not round-trip', () => {
    expect(mergeEnvText('', new Map([['K', 'a b']]))).toContain('K="a b"');
    expect(mergeEnvText('', new Map([['K', 'plain']]))).toContain('K=plain');
  });
});

describe('writeGlobalEnv', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'smartrelay-setup-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it.skipIf(!onPosix)('creates the directory 0700 and the file 0600', () => {
    const target = writeGlobalEnv(new Map([['NVIDIA_API_KEY', 'nvapi-x']]), home);

    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('leaves no temp file behind', () => {
    writeGlobalEnv(new Map([['NVIDIA_API_KEY', 'nvapi-x']]), home);
    expect(readdirSync(home).filter((f) => f.includes('.env.tmp'))).toEqual([]);
  });

  it('merges rather than clobbers an existing file', () => {
    writeFileSync(path.join(home, '.env'), 'SMARTRELAY_HTTP_API_KEY=secret\n');
    const target = writeGlobalEnv(new Map([['NVIDIA_API_KEY', 'nvapi-x']]), home);

    const text = readFileSync(target, 'utf-8');
    expect(text).toContain('SMARTRELAY_HTTP_API_KEY=secret');
    expect(text).toContain('NVIDIA_API_KEY=nvapi-x');
  });
});

describe('runSetup', () => {
  let home: string;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'smartrelay-setup-'));
    // The wizard reads process.env to decide what is "already set"; a developer's
    // real keys would otherwise change which branches run.
    for (const spec of PROVIDER_KEYS) {
      saved.set(spec.env, process.env[spec.env]);
      delete process.env[spec.env];
    }
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
    rmSync(home, { recursive: true, force: true });
  });

  it('refuses to run without a terminal instead of hanging on stdin', async () => {
    const out = collector();
    const code = await runSetup({ home, output: out.stream });

    expect(code).toBe(1);
    expect(existsSync(path.join(home, '.env'))).toBe(false);
  });

  it('harvests the environment when non-interactive', async () => {
    process.env['NVIDIA_API_KEY'] = 'nvapi-abcdefghij0123456789';
    process.env['OPENROUTER_API_KEY'] = 'sk-or-v1-abcdefghij0123456789';

    const out = collector();
    const code = await runSetup({ home, nonInteractive: true, output: out.stream });

    expect(code).toBe(0);
    const text = readFileSync(path.join(home, '.env'), 'utf-8');
    expect(text).toContain('NVIDIA_API_KEY=nvapi-abcdefghij0123456789');
    expect(text).toContain('OPENROUTER_API_KEY=sk-or-v1-abcdefghij0123456789');
  });

  it('fails non-interactively when a required key is absent, writing nothing', async () => {
    process.env['NVIDIA_API_KEY'] = 'nvapi-abcdefghij0123456789';

    const out = collector();
    const code = await runSetup({ home, nonInteractive: true, output: out.stream });

    expect(code).toBe(1);
    expect(existsSync(path.join(home, '.env'))).toBe(false);
  });

  it('prompts for each key and skips the optional ones on an empty answer', async () => {
    const out = collector();
    const code = await runSetup({
      home,
      output: out.stream,
      input: Readable.from([
        'nvapi-abcdefghij0123456789\n',
        'sk-or-v1-abcdefghij0123456789\n',
        '\n',
        '\n',
      ]),
    });

    expect(code).toBe(0);
    const text = readFileSync(path.join(home, '.env'), 'utf-8');
    expect(text).toContain('NVIDIA_API_KEY=nvapi-abcdefghij0123456789');
    expect(text).toContain('OPENROUTER_API_KEY=sk-or-v1-abcdefghij0123456789');
    expect(text).not.toContain('ANTHROPIC_API_KEY');
    expect(text).not.toContain('OPENAI_API_KEY');
  });

  it('warns about an unexpected key format but still saves it when confirmed', async () => {
    const out = collector();
    const code = await runSetup({
      home,
      output: out.stream,
      input: Readable.from([
        'wrongprefix-abcdefghij0123456789\n',
        'y\n',
        'sk-or-v1-abcdefghij0123456789\n',
        '\n',
        '\n',
      ]),
    });

    expect(code).toBe(0);
    expect(out.text()).toContain('warning:');
    expect(readFileSync(path.join(home, '.env'), 'utf-8')).toContain(
      'NVIDIA_API_KEY=wrongprefix-abcdefghij0123456789',
    );
  });

  it('never echoes a key back in full', async () => {
    const secret = 'nvapi-abcdefghij0123456789';
    const out = collector();
    await runSetup({
      home,
      output: out.stream,
      input: Readable.from([`${secret}\n`, 'sk-or-v1-abcdefghij0123456789\n', '\n', '\n']),
    });

    expect(out.text()).not.toContain(secret);
    expect(out.text()).toContain('nvapi-…6789');
  });
});
