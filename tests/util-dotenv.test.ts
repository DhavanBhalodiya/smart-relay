import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDotEnv, parseEnvText } from '../src/util.js';

describe('parseEnvText', () => {
  it('strips both quote styles and keeps everything after the first =', () => {
    const parsed = parseEnvText('A="x"\nB=\'y\'\nC=b=c\nD=  spaced  ');
    expect(parsed.get('A')).toBe('x');
    expect(parsed.get('B')).toBe('y');
    expect(parsed.get('C')).toBe('b=c');
    expect(parsed.get('D')).toBe('spaced');
  });

  it('ignores comments, blanks, and lines without an =', () => {
    const parsed = parseEnvText('# comment\n\nNOEQUALS\nREAL=1\n');
    expect([...parsed.keys()]).toEqual(['REAL']);
  });

  it('cannot be used to poison a prototype', () => {
    const parsed = parseEnvText('__proto__=polluted\n');
    expect(parsed.get('__proto__')).toBe('polluted');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('loadDotEnv precedence', () => {
  let root: string;
  let cwd: string;
  let home: string;
  const touched = ['DOTENV_CWD_ONLY', 'DOTENV_HOME_ONLY', 'DOTENV_SHARED', 'DOTENV_PRESET'];
  const skipFlag = process.env['SMARTRELAY_SKIP_GLOBAL_ENV'];

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'smartrelay-dotenv-'));
    cwd = path.join(root, 'project');
    home = path.join(root, 'home');
    mkdirSync(cwd);
    mkdirSync(home);
    for (const key of touched) delete process.env[key];
    // The suite-wide setup file sets this; these tests are about the behavior it disables.
    delete process.env['SMARTRELAY_SKIP_GLOBAL_ENV'];
  });

  afterEach(() => {
    for (const key of touched) delete process.env[key];
    if (skipFlag === undefined) delete process.env['SMARTRELAY_SKIP_GLOBAL_ENV'];
    else process.env['SMARTRELAY_SKIP_GLOBAL_ENV'] = skipFlag;
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the global file when a key is defined nowhere else', () => {
    writeFileSync(path.join(home, '.env'), 'DOTENV_HOME_ONLY=from-home\n');
    loadDotEnv({ cwd, home });
    expect(process.env['DOTENV_HOME_ONLY']).toBe('from-home');
  });

  it('prefers the project file over the global file', () => {
    writeFileSync(path.join(cwd, '.env'), 'DOTENV_SHARED=from-cwd\n');
    writeFileSync(path.join(home, '.env'), 'DOTENV_SHARED=from-home\n');
    loadDotEnv({ cwd, home });
    expect(process.env['DOTENV_SHARED']).toBe('from-cwd');
  });

  it('lets an already-exported variable win over every file', () => {
    process.env['DOTENV_PRESET'] = 'from-environment';
    writeFileSync(path.join(cwd, '.env'), 'DOTENV_PRESET=from-cwd\n');
    writeFileSync(path.join(home, '.env'), 'DOTENV_PRESET=from-home\n');
    loadDotEnv({ cwd, home });
    expect(process.env['DOTENV_PRESET']).toBe('from-environment');
  });

  it('keeps reading later candidates instead of stopping at the first file', () => {
    // Regression lock: loadDotEnv used to `break` after the first existing file,
    // so a key defined only in a lower-priority file was silently never loaded.
    writeFileSync(path.join(cwd, '.env'), 'DOTENV_CWD_ONLY=from-cwd\n');
    writeFileSync(path.join(home, '.env'), 'DOTENV_HOME_ONLY=from-home\n');
    loadDotEnv({ cwd, home });
    expect(process.env['DOTENV_CWD_ONLY']).toBe('from-cwd');
    expect(process.env['DOTENV_HOME_ONLY']).toBe('from-home');
  });

  it('skips the global file when SMARTRELAY_SKIP_GLOBAL_ENV=1', () => {
    process.env['SMARTRELAY_SKIP_GLOBAL_ENV'] = '1';
    writeFileSync(path.join(home, '.env'), 'DOTENV_HOME_ONLY=from-home\n');
    loadDotEnv({ cwd, home });
    expect(process.env['DOTENV_HOME_ONLY']).toBeUndefined();
  });
});
