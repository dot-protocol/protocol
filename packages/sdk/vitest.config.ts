import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@dotprotocol/core': resolve(__dirname, '../core/src/index.ts'),
      '@dotprotocol/compression': resolve(__dirname, '../compression/src/index.ts'),
      '@dotprotocol/identity': resolve(__dirname, '../identity/src/index.ts'),
      '@dotprotocol/chain': resolve(__dirname, '../chain/src/index.ts'),
      '@dotprotocol/relay': resolve(__dirname, '../relay/src/index.ts'),
      '@dotprotocol/wrapper': resolve(__dirname, '../wrapper/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
