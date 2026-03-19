import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@dot-protocol/core': resolve(__dirname, '../core/src/index.ts'),
      '@dot-protocol/compression': resolve(__dirname, '../compression/src/index.ts'),
      '@dot-protocol/identity': resolve(__dirname, '../identity/src/index.ts'),
      '@dot-protocol/chain': resolve(__dirname, '../chain/src/index.ts'),
      '@dot-protocol/relay': resolve(__dirname, '../relay/src/index.ts'),
      '@dot-protocol/wrapper': resolve(__dirname, '../wrapper/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
