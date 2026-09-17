/**
 * `smartrelay init` — ask for the API keys, then register the MCP server.
 *
 * One command so a new user never has to learn that a separate configuration
 * step exists. The keys are collected by the terminal wizard in `setup.ts`, where
 * input is hidden and nothing is echoed in full; they are deliberately NOT
 * collected through MCP elicitation, whose schema has no masked field type and
 * would put the secrets into the client's transcript.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { PACKAGE_NAME, SETUP_COMMAND } from './credentials.js';
import { noTerminalMessage, openWizardIo, runSetup, type SetupOptions, type WizardIo } from './setup.js';
import { describeError } from './util.js';

/** The MCP server entry every client config ends up holding. */
const SERVER_KEY = 'smartrelay';
const SERVER_ENTRY = { command: 'npx', args: ['-y', PACKAGE_NAME] } as const;

export interface McpClient {
  id: string;
  label: string;
  /** `cli` shells out to a client's own command; `json` edits a config file. */
  kind: 'cli' | 'json';
  /** Config file for `json` clients; `null` for `cli` ones. */
  configPath: string | null;
  /** Whether this client appears to be installed. */
  detected: boolean;
  /** What to tell the user if automatic registration is declined or fails. */
  manual: string;
}

const JSON_SNIPPET = JSON.stringify(
  { mcpServers: { [SERVER_KEY]: SERVER_ENTRY } },
  null,
  2,
);

/** Config locations per platform, mirroring each client's documented path. */
function clientConfigPath(id: string, home: string): string | null {
  const os = platform();
  switch (id) {
    case 'claude-desktop':
      if (os === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      }
      if (os === 'win32') {
        const appData = process.env['APPDATA'];
        return appData ? path.join(appData, 'Claude', 'claude_desktop_config.json') : null;
      }
      return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
    case 'cursor':
      return path.join(home, '.cursor', 'mcp.json');
    case 'windsurf':
      return path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
    default:
      return null;
  }
}

/** Is the `claude` CLI callable? */
function hasClaudeCli(): boolean {
  const probe = spawnSync('claude', ['--version'], { stdio: 'ignore', timeout: 10_000 });
  return probe.status === 0;
}

/** Every client SmartRelay knows how to register with, detected ones first. */
export function detectClients(options?: { home?: string; claudeCli?: boolean }): McpClient[] {
  const home = options?.home ?? homedir();

  const clients: McpClient[] = [
    {
      id: 'claude-code',
      label: 'Claude Code',
      kind: 'cli',
      configPath: null,
      detected: options?.claudeCli ?? hasClaudeCli(),
      manual: `claude mcp add -s user ${SERVER_KEY} -- npx -y ${PACKAGE_NAME}`,
    },
    ...(['claude-desktop', 'cursor', 'windsurf'] as const).map((id) => {
      const configPath = clientConfigPath(id, home);
      return {
        id,
        label: { 'claude-desktop': 'Claude Desktop', cursor: 'Cursor', windsurf: 'Windsurf' }[id],
        kind: 'json' as const,
        configPath,
        // The parent directory is the signal: a client can be installed long
        // before it has ever written an MCP config file.
        detected: Boolean(configPath) && existsSync(path.dirname(configPath as string)),
        manual: `Add to ${configPath ?? 'your MCP config'}:\n${JSON_SNIPPET}`,
      };
    }),
  ];

  return clients;
}

export interface RegisterResult {
  ok: boolean;
  message: string;
  /** Path of the backup taken before a config file was modified. */
  backup?: string;
}

/**
 * Merge the SmartRelay entry into a client's JSON config.
 *
 * Read-modify-write, never a template overwrite: these files hold the user's
 * other MCP servers. A file that does not parse is left completely alone —
 * guessing at malformed JSON risks destroying a working setup.
 */
export function registerJsonClient(client: McpClient): RegisterResult {
  const target = client.configPath;
  if (!target) return { ok: false, message: 'no config path for this platform' };

  let existing: Record<string, unknown> = {};
  let backup: string | undefined;

  if (existsSync(target)) {
    const raw = readFileSync(target, 'utf-8');
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      } else {
        return { ok: false, message: `${target} is not a JSON object — left unchanged` };
      }
    } catch (err) {
      return { ok: false, message: `${target} is not valid JSON (${describeError(err)}) — left unchanged` };
    }

    backup = `${target}.smartrelay-backup`;
    copyFileSync(target, backup);
  }

  const servers =
    existing['mcpServers'] && typeof existing['mcpServers'] === 'object' && !Array.isArray(existing['mcpServers'])
      ? (existing['mcpServers'] as Record<string, unknown>)
      : {};

  const already = SERVER_KEY in servers;
  const merged = { ...existing, mcpServers: { ...servers, [SERVER_KEY]: SERVER_ENTRY } };

  mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`);
  renameSync(tmp, target);

  return {
    ok: true,
    message: already ? `updated the existing entry in ${target}` : `added to ${target}`,
    ...(backup ? { backup } : {}),
  };
}

/** Register through the `claude` CLI, which owns its own config format. */
export function registerClaudeCode(): RegisterResult {
  // `claude mcp add` fails on an existing name, so replace rather than error out.
  spawnSync('claude', ['mcp', 'remove', '-s', 'user', SERVER_KEY], { stdio: 'ignore', timeout: 30_000 });

  const result = spawnSync(
    'claude',
    ['mcp', 'add', '-s', 'user', SERVER_KEY, '--', 'npx', '-y', PACKAGE_NAME],
    { encoding: 'utf-8', timeout: 60_000 },
  );

  if (result.status === 0) return { ok: true, message: 'registered with the claude CLI' };
  const detail = (result.stderr || result.stdout || '').trim().split('\n')[0] ?? 'unknown error';
  return { ok: false, message: `claude mcp add failed: ${detail}` };
}

export function registerClient(client: McpClient): RegisterResult {
  return client.kind === 'cli' ? registerClaudeCode() : registerJsonClient(client);
}

export interface InstallOptions extends SetupOptions {
  /** Client ids to register without asking. Implies no client prompts. */
  clients?: string[];
  /** Skip registration entirely and only print the snippets. */
  printOnly?: boolean;
  /**
   * Home directory used to locate client configs. Distinct from `home`, which
   * overrides `~/.smartrelay` — conflating the two would send client lookups
   * into the credential directory. Tests point this at a temp dir.
   */
  clientHome?: string;
}

export async function runInstall(options: InstallOptions = {}): Promise<number> {
  const out = options.output ?? process.stdout;
  const write = (line = ''): void => void out.write(`${line}\n`);

  // One session for both rounds of prompts — two readline interfaces on the same
  // stdin would compete for lines.
  let io: WizardIo | null = null;
  if (!options.nonInteractive) {
    io = openWizardIo(options);
    if (!io) {
      process.stderr.write(noTerminalMessage('init'));
      return 1;
    }
  }

  try {
    const setupCode = await runSetup(options, io ?? undefined);
    if (setupCode !== 0) return setupCode;

    const clients = detectClients({ ...(options.clientHome ? { home: options.clientHome } : {}) });
    const chosen = await chooseClients(clients, options, io, write);

    write();
    if (!chosen.length) {
      write('No client registered. Add SmartRelay manually with any of:');
      for (const client of clients) {
        write();
        write(`  ${client.label}:`);
        for (const line of client.manual.split('\n')) write(`    ${line}`);
      }
      return 0;
    }

    write('Registering…');
    let restartNeeded = false;
    for (const client of chosen) {
      const result = registerClient(client);
      write(`  ${result.ok ? '✔' : '✖'} ${client.label} — ${result.message}`);
      if (result.backup) write(`      previous config saved to ${result.backup}`);
      if (result.ok) restartNeeded = true;
      else {
        for (const line of client.manual.split('\n')) write(`      ${line}`);
      }
    }

    if (restartNeeded) {
      write();
      write('Restart the client to load SmartRelay.');
    }
    return 0;
  } finally {
    io?.close();
  }
}

/** Decide which clients to register: explicit flag, or one y/n prompt each. */
async function chooseClients(
  clients: McpClient[],
  options: InstallOptions,
  io: WizardIo | null,
  write: (line?: string) => void,
): Promise<McpClient[]> {
  if (options.printOnly) return [];

  if (options.clients?.length) {
    const wanted = new Set(options.clients);
    const unknown = options.clients.filter((id) => !clients.some((c) => c.id === id));
    for (const id of unknown) write(`  unknown client '${id}' — ignored`);
    return clients.filter((c) => wanted.has(c.id));
  }

  // Without a terminal there is nobody to ask; print instructions instead of guessing.
  if (!io) return [];

  const detected = clients.filter((c) => c.detected);
  if (!detected.length) return [];

  write();
  write('Register SmartRelay as an MCP server');
  write('────────────────────────────────────');

  const chosen: McpClient[] = [];
  for (const client of detected) {
    io.write(`  Add to ${client.label}? [Y/n]`);
    const answer = (await io.read())?.trim().toLowerCase();
    if (!answer || answer.startsWith('y')) chosen.push(client);
  }
  return chosen;
}
