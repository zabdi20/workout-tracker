/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves a project repo from a subpath, not the domain root.
// Vite's base, the manifest's start_url and scope, and the service worker
// scope must all agree on it. A mismatch produces the worst failure mode:
// the app installs successfully and then fails to load offline.
const BASE = '/workout-tracker/';

export default defineConfig({
  base: BASE,
  build: {
    // Explicit rather than relying on Vite's default target, since the
    // spec's platform floor is iOS Safari 16.4+.
    target: 'safari16',
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png'],
      manifest: {
        name: 'Workout Tracker',
        short_name: 'Lifts',
        description: 'Personal gym workout planner and set logger',
        theme_color: '#111111',
        background_color: '#111111',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        icons: [
          // Relative to the manifest, which is served from BASE.
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,png,woff2}'],
        navigateFallback: `${BASE}index.html`,
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
