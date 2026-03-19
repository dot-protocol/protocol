import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@dot-protocol/core': resolve(__dirname, '../core/src/index.ts'),
      '@dot-protocol/compression': resolve(__dirname, '../compression/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
