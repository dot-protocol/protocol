import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@dot-protocol/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      exclude: ['scripts/**', 'src/tests/**', '**/*.d.ts', '**/*.config.*'],
    },
  },
});
