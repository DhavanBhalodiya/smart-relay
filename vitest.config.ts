import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The plugin imports the published subpath; under test, point it at the
      // TypeScript source so the suite does not depend on `dist/` being built.
      '@theone1345/smartrelay/dispatch': new URL('./src/tools/dispatch.ts', import.meta.url).pathname,
      '@theone1345/smartrelay/credentials': new URL('./src/credentials.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The registry reads config.yaml relative to the project root.
    root: import.meta.dirname,
  },
});
