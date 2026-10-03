import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // The components under test are TSX compiled by Next with the automatic
  // runtime; esbuild defaults to the classic one, which expects `React` in
  // scope and fails with "React is not defined" at render.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Outside Next, `server-only` resolves to a module that throws on import.
      // Point it at the package's own empty build so server modules are
      // testable without loosening the boundary they declare.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    // The DB-backed parity tests share one Postgres connection; running files
    // in parallel would open a pool per worker for no gain.
    fileParallelism: false,
  },
});
