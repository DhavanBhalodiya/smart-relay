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
 * Load variables from the first `.env` found in the current directory or the
 * project root. Existing environment variables always win.
 *
 * Deliberately hand-rolled rather than delegating to a dotenv package so the
 * quote-stripping and precedence behavior stays identical to the Python original.
 */
export function loadDotEnv(): void {
  const candidates = [path.join(process.cwd(), '.env'), path.join(findProjectRoot(), '.env')];

  for (const envFile of candidates) {
    if (!existsSync(envFile)) continue;
    try {
      for (const rawLine of readFileSync(envFile, 'utf-8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;

        const splitAt = line.indexOf('=');
        const key = line.slice(0, splitAt).trim();
        const value = stripChar(stripChar(line.slice(splitAt + 1).trim(), "'"), '"');

        if (key && !(key in process.env)) process.env[key] = value;
      }
    } catch {
      // Matches the Python original: a malformed .env is ignored, not fatal.
    }
    break;
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
