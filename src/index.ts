/** Main entrypoint for SmartRelay. */

export * from './server.js';
export { createHttpServer, runHttpServer, verifyApiKey } from './http-api.js';
// Exported from the module that owns them, not via the two entrypoints that
// re-export them, so `export *` above cannot make the name ambiguous.
export { createDispatchContext, dispatchTool } from './tools/dispatch.js';
export * from './credentials.js';
export * from './router.js';
export * from './logger.js';
export * from './util.js';
export * from './tools/index.js';
export * from './runners/base.js';
export * from './runners/registry.js';
export * from './runners/anthropic.js';
export * from './runners/openai.js';
export * from './runners/ollama.js';
export * from './runners/openrouter.js';
export * from './runners/nvidia.js';
export * from './benchmark/engine.js';
export * from './benchmark/scorers.js';
