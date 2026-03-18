import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: {
    outDir: 'dist',
  },
  outDir: 'dist',
});
