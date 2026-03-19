import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        'examples/**',
        'src/index.ts',
        'dist/**',
        'vitest.config.ts',
      ],
    },
  },
});
