import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'DOT Messenger',
        short_name: 'DOT',
        description: 'Signed, compressed, encrypted messages. Physics, not features.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: '@dot-protocol/engine',
        replacement: new URL('../engine/src/index.ts', import.meta.url).pathname,
      },
      {
        find: '@dot-protocol/core',
        replacement: new URL('../core/src/index.ts', import.meta.url).pathname,
      },
      // Alias to browser-safe predictor-only barrel — avoids Node.js zstd/fs deps
      {
        find: '@dot-protocol/compression',
        replacement: new URL('../compression/src/predictor.ts', import.meta.url).pathname,
      },
    ],
  },
});
