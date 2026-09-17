/** Shared helpers: rounding, path resolution, .env loading, and concurrency limiting. */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Round to a fixed number of decimal places.
 *
 * Python's `round()` uses banker's rounding while this rounds half away from
 * zero. The difference only shows up on exact .5 ties, which never occur for
 * the latency and cost values this is used on.
 */
export function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Strip every leading and trailing occurrence of `char`, matching Python's `str.strip(char)`. */
export function stripChar(value: string, char: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === char) start++;
  while (end > start && value[end - 1] === char) end--;
  return value.slice(start, end);
}

/** Expand a leading `~` to the user's home directory (Node's path.resolve does not). */
export function expandUser(filePath: string): string {
  if (filePath === '~') return homedir();
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(homedir(), filePath.slice(2));
  }
  return filePath;
}

/** Equivalent of Python's `Path(p).expanduser().resolve()`. */
export function resolveUserPath(filePath: string): string {
  return path.resolve(expandUser(filePath));
}

/**
 * Walk upward from `startDir` looking for a directory that holds a project
 * marker. Replaces the Python code's reliance on a fixed `__file__` offset,
 * which would break once TypeScript compiles `src/` into `dist/`.
 */
export function findProjectRoot(startDir: string = import.meta.dirname): string {
  let current = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(current, 'config.yaml')) || existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

/**
 * Directory holding SmartRelay's user-level state, `~/.smartrelay` by default.
 *
 * `SMARTRELAY_HOME` overrides it so tests can redirect the credential file to a
 * temp dir without ever touching the developer's real home directory.
 */
export function smartrelayHome(override?: string): string {
  if (override) return override;
  const fromEnv = process.env['SMARTRELAY_HOME'];
  if (fromEnv) return resolveUserPath(fromEnv);
  return path.join(homedir(), '.smartrelay');
}

/** The global credential file written by `smartrelay setup`. */
export function globalEnvPath(homeOverride?: string): string {
  return path.join(smartrelayHome(homeOverride), '.env');
}

/**
 * Parse `.env` text into ordered key/value pairs.
 *
 * A `Map` rather than a plain object: insertion order is preserved and a key
 * literally named `__proto__` cannot poison a prototype.
 *
 * Deliberately hand-rolled rather than delegating to a dotenv package so the
 * quote-stripping behavior stays identical to the Python original. The setup
 * wizard reuses this so the writer and the loader can never disagree about it.
 */
export function parseEnvText(text: string): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;

    const splitAt = line.indexOf('=');
    const key = line.slice(0, splitAt).trim();
    const value = stripChar(stripChar(line.slice(splitAt + 1).trim(), "'"), '"');

    if (key) parsed.set(key, value);
  }
  return parsed;
}

/**
 * Populate `process.env` from the `.env` files SmartRelay knows about.
 *
 * Precedence, highest first:
 *   1. variables already in `process.env`
 *   2. `<cwd>/.env`               — project-local
 *   3. `<project root>/.env`
 *   4. `~/.smartrelay/.env`       — written by `smartrelay setup`
 *
 * Every candidate is read, not just the first that exists: the global file is a
 * fallback for keys a project never defines. Since the assignment below only
 * fills in names that are still unset, reading the list in order produces that
 * precedence for free.
 *
 * `cwd`/`home` exist only so tests can point at temp directories — `process.chdir`
 * is process-global and unsafe across parallel test files.
 */
export function loadDotEnv(options?: { cwd?: string; home?: string }): void {
  const candidates = [
    path.join(options?.cwd ?? process.cwd(), '.env'),
    path.join(findProjectRoot(), '.env'),
  ];
  // Escape hatch for the test suite, which must never read a developer's real
  // credentials just because `server.ts` calls this at module scope.
  if (process.env['SMARTRELAY_SKIP_GLOBAL_ENV'] !== '1') {
    candidates.push(globalEnvPath(options?.home));
  }

  const seen = new Set<string>();
  for (const envFile of candidates) {
    const resolved = path.resolve(envFile);
    if (seen.has(resolved) || !existsSync(resolved)) continue;
    seen.add(resolved);

    try {
      for (const [key, value] of parseEnvText(readFileSync(resolved, 'utf-8'))) {
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch {
      // Matches the Python original: a malformed .env is ignored, not fatal.
    }
  }
}

/** Counting semaphore, replacing `asyncio.Semaphore`. */
export class Semaphore {
  private available: number;
  private readonly waiting: Array<() => void> = [];

  constructor(permits: number) {
    // Guard against a misconfigured `max_concurrency: 0`, which would otherwise
    // deadlock the benchmark fan-out exactly as it does in the Python version.
    this.available = Math.max(1, Math.floor(permits));
  }

  private async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.available++;
  }

  /** Run `fn` while holding a permit. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/** Start a monotonic timer; the returned function yields elapsed milliseconds. */
export function startTimer(): () => number {
  const started = performance.now();
  return () => round(performance.now() - started, 2);
}

/** Format an unknown thrown value the way Python renders `type(e).__name__: e`. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.constructor.name}: ${error.message}`;
  return `Error: ${String(error)}`;
}

/** Truncate by code point (not UTF-16 unit) so multi-byte characters are never split. */
export function truncateByCodePoint(value: string, limit: number): string {
  const points = Array.from(value);
  return points.length > limit ? `${points.slice(0, limit).join('')}...` : value;
}

/** Just the message of a thrown value, matching Python's `str(e)`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
