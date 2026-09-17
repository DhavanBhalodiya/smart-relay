/**
 * Vitest global setup.
 *
 * `src/server.ts` calls `loadDotEnv()` at module scope, so importing it from a
 * test would otherwise pull in the developer's real `~/.smartrelay/.env` and make
 * credential-dependent assertions pass locally but fail in CI (or vice versa).
 */
process.env['SMARTRELAY_SKIP_GLOBAL_ENV'] = '1';
