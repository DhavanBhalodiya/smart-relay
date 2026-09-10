/**
 * Minimal stderr logger mirroring the Python logging setup.
 *
 * Everything goes to stderr so the stdio transport's JSON-RPC stream on stdout
 * stays clean. Format matches the Python `basicConfig` format string:
 * `%(asctime)s [%(levelname)s] %(name)s: %(message)s`.
 */

const LEVELS = { debug: 10, info: 20, warning: 30, error: 40 } as const;

export type LogLevel = keyof typeof LEVELS;

function activeLevel(): number {
  const configured = (process.env['SMARTRELAY_LOG_LEVEL'] ?? 'info').toLowerCase();
  return LEVELS[configured as LogLevel] ?? LEVELS.info;
}

/** `2026-09-09 16:22:01,123` — the Python `asctime` default. */
function timestamp(): string {
  const now = new Date();
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())},${pad(now.getMilliseconds(), 3)}`
  );
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warning(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export function getLogger(name: string): Logger {
  const emit = (level: LogLevel, message: string, args: unknown[]): void => {
    if (LEVELS[level] < activeLevel()) return;
    const suffix = args.length ? ` ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}` : '';
    process.stderr.write(`${timestamp()} [${level.toUpperCase()}] ${name}: ${message}${suffix}\n`);
  };

  return {
    debug: (message, ...args) => emit('debug', message, args),
    info: (message, ...args) => emit('info', message, args),
    warning: (message, ...args) => emit('warning', message, args),
    error: (message, ...args) => emit('error', message, args),
  };
}
