#!/usr/bin/env node
/**
 * Interactive credential setup for SmartRelay.
 *
 * Asks for the provider API keys in the terminal and stores them in
 * `~/.smartrelay/.env` (mode 600), which `loadDotEnv()` reads as its
 * lowest-priority source.
 *
 * This writes prompts to STDOUT, which is only safe because the wizard never
 * runs in a process that connects `StdioServerTransport` — `src/server.ts`
 * dispatches the `setup` subcommand and exits before any transport is created.
 * See the note at the top of `src/logger.ts` for why stdout is otherwise
 * off-limits.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  formatRunnerStatusLines,
  maskKey,
  PROVIDER_KEYS,
  summarizeCredentials,
  validateKeyFormat,
  type KeySpec,
} from './credentials.js';
import { RunnerRegistry } from './runners/registry.js';
import { describeError, globalEnvPath, loadDotEnv, parseEnvText, smartrelayHome } from './util.js';

/** How many times a required key is re-asked before offering to skip it. */
const REQUIRED_ATTEMPTS = 3;

export interface SetupOptions {
  /** Override `~/.smartrelay`; tests point this at a temp dir. */
  home?: string;
  /** Skip all prompts and harvest keys from the environment instead. */
  nonInteractive?: boolean;
  /** Defaults to `process.stdin`. Supplying one marks the run as scriptable. */
  input?: NodeJS.ReadableStream;
  /** Defaults to `process.stdout`. */
  output?: NodeJS.WritableStream;
  /** Passed to the registry when printing the closing readiness summary. */
  configPath?: string | null;
}

// =========================================================================
// FILE WRITING
// =========================================================================

/** Quote a value only when a bare one would not survive `parseEnvText`. */
function formatEnvValue(value: string): string {
  return /[\s#]/.test(value) ? `"${value}"` : value;
}

/**
 * Fold `updates` into existing `.env` text without disturbing anything else.
 *
 * Comments, blank lines, and unrelated keys survive verbatim — the file may hold
 * values a user added by hand (`SMARTRELAY_HTTP_API_KEY`, say) that the wizard
 * knows nothing about and must not drop.
 */
export function mergeEnvText(original: string, updates: Map<string, string>): string {
  const consumed = new Set<string>();
  const kept: string[] = [];

  for (const rawLine of original.split(/\r?\n/)) {
    const line = rawLine.trim();
    const splitAt = line.indexOf('=');
    const key = !line || line.startsWith('#') || splitAt < 0 ? null : line.slice(0, splitAt).trim();

    if (key && updates.has(key)) {
      // Replace the first occurrence in place; drop any later duplicate so the
      // key cannot end up defined twice with different values.
      if (!consumed.has(key)) {
        consumed.add(key);
        kept.push(`${key}=${formatEnvValue(updates.get(key) as string)}`);
      }
      continue;
    }
    kept.push(rawLine);
  }

  const appended = [...updates].filter(([key]) => !consumed.has(key));
  while (kept.length && kept[kept.length - 1]?.trim() === '') kept.pop();

  if (appended.length) {
    if (kept.length) kept.push('');
    kept.push(`# Added by smartrelay setup on ${new Date().toISOString().slice(0, 10)}`);
    for (const [key, value] of appended) kept.push(`${key}=${formatEnvValue(value)}`);
  }

  return `${kept.join('\n')}\n`;
}

/**
 * Write the merged credential file.
 *
 * Written to a temp file and renamed so an interrupted run can never leave a
 * half-written credential file behind, and chmod'd explicitly because the mode
 * passed to `mkdir`/`writeFile` is masked by the process umask.
 */
export function writeGlobalEnv(updates: Map<string, string>, homeOverride?: string): string {
  const dir = smartrelayHome(homeOverride);
  const target = path.join(dir, '.env');

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  tryChmod(dir, 0o700);

  const original = existsSync(target) ? readFileSync(target, 'utf-8') : '';
  const merged = mergeEnvText(original, updates);

  const tmp = path.join(dir, `.env.tmp-${process.pid}`);
  try {
    writeFileSync(tmp, merged, { mode: 0o600 });
    tryChmod(tmp, 0o600);
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }

  return target;
}

/** `chmod` is a no-op on some filesystems and throws on others — never fatal. */
function tryChmod(target: string, mode: number): void {
  try {
    chmodSync(target, mode);
  } catch {
    // Permissions are advisory here; the file is still written.
  }
}

/** Render a path with the home directory collapsed back to `~`. */
function displayPath(filePath: string): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'];
  return home && filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

// =========================================================================
// WIZARD
// =========================================================================

/**
 * Open a prompt session, or return `null` when there is no terminal to prompt on.
 *
 * Shared by `setup` and `init` so a single run can ask for keys and then for
 * client registration over one readline — two competing interfaces on the same
 * stdin would race for lines.
 */
export function openWizardIo(options: SetupOptions = {}): WizardIo | null {
  const out = options.output ?? process.stdout;
  const input = options.input ?? process.stdin;
  // An explicitly injected stream is always scriptable; otherwise both ends must
  // be a real terminal or the prompts would block forever on a closed stdin.
  const scripted = Boolean(options.input);

  if (!scripted && (!process.stdin.isTTY || !process.stdout.isTTY)) return null;

  let muted = false;
  const muteable = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) out.write(chunk as Buffer);
      callback();
    },
  });
  const rl = readline.createInterface({ input, output: muteable, terminal: !scripted });

  return {
    read: createLineReader(rl),
    write: (line = '') => void out.write(`${line}\n`),
    setMuted: (next) => {
      muted = next;
    },
    close: () => {
      muted = false;
      rl.close();
    },
  };
}

/** The message shown when there is no terminal and no `--non-interactive`. */
export function noTerminalMessage(command: string): string {
  return (
    `smartrelay ${command} needs an interactive terminal.\n` +
    'Run it directly in a shell, or use --non-interactive with ' +
    `${PROVIDER_KEYS.filter((s) => s.required).map((s) => s.env).join(' and ')} exported.\n`
  );
}

export async function runSetup(options: SetupOptions = {}, sharedIo?: WizardIo): Promise<number> {
  const out = options.output ?? process.stdout;
  const write = (line = ''): void => void out.write(`${line}\n`);

  const target = globalEnvPath(options.home);
  const fileValues = existsSync(target)
    ? parseEnvText(readFileSync(target, 'utf-8'))
    : new Map<string, string>();

  if (options.nonInteractive) {
    return harvestFromEnvironment(options, write);
  }

  const io = sharedIo ?? openWizardIo(options);
  if (!io) {
    process.stderr.write(noTerminalMessage('setup'));
    return 1;
  }
  const read = io.read;

  write();
  write('SmartRelay setup');
  write('────────────────');
  write(`Keys are saved to ${displayPath(target)} (readable only by you).`);
  write('Your keystrokes are not shown while you type a key.');

  const updates = new Map<string, string>();
  try {
    for (const spec of PROVIDER_KEYS) {
      const existing = fileValues.get(spec.env) ?? process.env[spec.env] ?? '';
      const source = fileValues.has(spec.env)
        ? displayPath(target)
        : existing
          ? 'environment'
          : null;

      write();
      write(`${spec.env} — ${spec.label}  [${spec.required ? 'required' : 'optional'}]`);
      write(`  Get one at ${spec.consoleUrl}`);
      if (existing) {
        write(`  already set: ${maskKey(existing)} (from ${source}) — press Enter to keep`);
        if (source === 'environment') {
          write(`  pressing Enter also copies it into ${displayPath(target)}`);
        }
      } else if (!spec.required) {
        write('  press Enter to skip');
      }

      const value = await promptForKey(read, spec, existing, io);
      if (value) updates.set(spec.env, value);
    }
  } finally {
    // Only tear down a session this call created; a shared one outlives it.
    if (!sharedIo) io.close();
  }

  if (!updates.size) {
    write();
    write('Nothing to save — no keys entered.');
    return 0;
  }

  const saved = writeGlobalEnv(updates, options.home);
  for (const [key, value] of updates) process.env[key] = value;

  write();
  write(`Saved ${updates.size} key${updates.size === 1 ? '' : 's'} to ${displayPath(saved)} (mode 600)`);
  printReadiness(options.configPath ?? null, write);

  const stillMissing = PROVIDER_KEYS.filter((spec) => spec.required && !process.env[spec.env]);
  if (stillMissing.length) {
    write();
    write(`Still missing: ${stillMissing.map((s) => s.env).join(', ')} — re-run setup to add them.`);
  }
  return 0;
}

export interface PromptIo {
  write(line?: string): void;
  setMuted(muted: boolean): void;
}

/** A live prompt session: the reader, the writer, and the mute switch. */
export interface WizardIo extends PromptIo {
  read: LineReader;
  close(): void;
}

/** Reads the next line, or `null` once input is exhausted. */
type LineReader = () => Promise<string | null>;

/**
 * Buffer readline's `line` events into a queue.
 *
 * `rl.question()` only captures input while a question is pending, so a scripted
 * stream that delivers every line at once loses all but the first — and once the
 * stream ends, any later `question()` rejects with "readline was closed". A queue
 * decouples arrival from consumption and turns end-of-input into a `null` the
 * caller can handle.
 */
function createLineReader(rl: readline.Interface): LineReader {
  const buffered: string[] = [];
  const waiting: Array<(line: string | null) => void> = [];
  let closed = false;

  rl.on('line', (line: string) => {
    const next = waiting.shift();
    if (next) next(line);
    else buffered.push(line);
  });
  rl.on('close', () => {
    closed = true;
    while (waiting.length) waiting.shift()?.(null);
  });

  return () => {
    if (buffered.length) return Promise.resolve(buffered.shift() as string);
    if (closed) return Promise.resolve(null);
    return new Promise<string | null>((resolve) => waiting.push(resolve));
  };
}

/** Ask for one provider key, returning the value to persist (or `null` to skip). */
async function promptForKey(
  read: LineReader,
  spec: KeySpec,
  existing: string,
  io: PromptIo,
): Promise<string | null> {
  for (let attempt = 1; ; attempt++) {
    const entered = await promptSecret(read, io);

    // Input ended: keep whatever was already configured and stop asking, rather
    // than spinning on the required-key retry loop forever.
    if (entered === null) return existing || null;

    if (!entered) {
      // Keeping an existing value still persists it — a key that only lived in
      // the shell environment would otherwise vanish with the session.
      if (existing) return existing;
      if (!spec.required) return null;
      if (attempt < REQUIRED_ATTEMPTS) {
        io.write(`  ${spec.env} is required. Paste the key, or press Enter ${REQUIRED_ATTEMPTS - attempt} more time(s) to skip.`);
        continue;
      }
      const skip = await confirm(read, io, `  Skip ${spec.env}? Runners that use it will fail. [y/N]`, false);
      if (skip) return null;
      attempt = 0;
      continue;
    }

    const warning = validateKeyFormat(spec, entered);
    if (warning) {
      io.write(`  warning: ${warning}`);
      // Warn, never reject: providers change key formats, and refusing a valid
      // new-style key is worse than storing a typo the user can correct.
      const save = await confirm(read, io, '  Save anyway? [Y/n]', true);
      if (!save) continue;
    }

    io.write(`  stored ${maskKey(entered)}`);
    return entered;
  }
}

/** Read a line with terminal echo suppressed. `null` means input ended. */
async function promptSecret(read: LineReader, io: PromptIo): Promise<string | null> {
  io.write('  key (input hidden, paste is fine):');
  io.setMuted(true);
  try {
    const line = await read();
    return line === null ? null : line.trim();
  } finally {
    io.setMuted(false);
  }
}

async function confirm(
  read: LineReader,
  io: PromptIo,
  prompt: string,
  defaultYes: boolean,
): Promise<boolean> {
  io.write(prompt);
  const answer = (await read())?.trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith('y');
}

// =========================================================================
// NON-INTERACTIVE MODE
// =========================================================================

/** CI / Dockerfile path: persist whatever is already exported, prompt for nothing. */
function harvestFromEnvironment(options: SetupOptions, write: (line?: string) => void): number {
  const updates = new Map<string, string>();
  for (const spec of PROVIDER_KEYS) {
    const value = process.env[spec.env];
    if (value) updates.set(spec.env, value);
  }

  const missing = PROVIDER_KEYS.filter((spec) => spec.required && !process.env[spec.env]);
  if (missing.length) {
    process.stderr.write(
      `smartrelay setup --non-interactive: ${missing.map((s) => s.env).join(', ')} not set in the environment.\n`,
    );
    return 1;
  }

  const saved = writeGlobalEnv(updates, options.home);
  write(`Saved ${updates.size} key${updates.size === 1 ? '' : 's'} to ${displayPath(saved)} (mode 600)`);
  printReadiness(options.configPath ?? null, write);
  return 0;
}

// =========================================================================
// SUMMARY
// =========================================================================

/** Print how many runners the new credentials actually unlocked. */
function printReadiness(configPath: string | null, write: (line?: string) => void): void {
  let registry: RunnerRegistry;
  try {
    registry = RunnerRegistry.fromYaml(configPath);
  } catch (err) {
    // Never fail the wizard over this — the keys are already safely written.
    write(`Could not load config.yaml to verify runners: ${describeError(err)}`);
    return;
  }

  const metadata = registry.getRunnersMetadata();
  const summary = summarizeCredentials(metadata);

  write();
  write(`${summary.ready} of ${summary.total} runners ready.`);
  for (const line of formatRunnerStatusLines(metadata)) write(line);
  if (summary.missingEnvVars.length) {
    write();
    write(`Not configured: ${summary.missingEnvVars.join(', ')}`);
  }
}

// =========================================================================
// CLI ENTRYPOINT
// =========================================================================

const USAGE = `Usage: smartrelay setup [options]

Prompts for your provider API keys and saves them to ~/.smartrelay/.env (mode 600).

Options:
  -c, --config <path>    config.yaml used for the readiness summary
      --non-interactive  save keys already present in the environment, no prompts
  -h, --help             show this message`;

function checkDirectExecution(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    if (realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))) return true;
  } catch {
    // Fall back to filename checks
  }
  return ['setup', 'smartrelay-setup'].includes(path.basename(script, path.extname(script)));
}

if (checkDirectExecution()) {
  loadDotEnv();
  try {
    const { values } = parseArgs({
      options: {
        config: { type: 'string', short: 'c' },
        'non-interactive': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    });

    if (values.help) {
      process.stdout.write(`${USAGE}\n`);
    } else {
      process.exitCode = await runSetup({
        nonInteractive: values['non-interactive'],
        configPath: values.config ?? null,
      });
    }
  } catch (err) {
    process.stderr.write(`${describeError(err)}\n${USAGE}\n`);
    process.exitCode = 2;
  }
}
