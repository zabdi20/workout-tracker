/// <reference types="vitest/config" />
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves a project repo from a subpath, not the domain root.
// Vite's base, the manifest's start_url and scope, and the service worker
// scope must all agree on it. A mismatch produces the worst failure mode:
// the app installs successfully and then fails to load offline.
const BASE = '/workout-tracker/';

/**
 * GitHub Pages has no SPA rewrite, and workbox.navigateFallback only helps
 * once the service worker already controls the page. A cold load of a deep
 * route (a bookmark, a shared link, a hard reload before the SW activates)
 * hits GitHub's own 404 page instead of index.html.
 *
 * GitHub Pages' documented workaround is serving a 404.html, so copy the
 * built index.html there verbatim after the build. This can't be a static
 * public/404.html: Vite copies public/ unprocessed, so it would reference
 * none of the build's hashed asset filenames.
 */
function spa404Fallback(): Plugin {
  return {
    name: 'spa-404-fallback',
    closeBundle() {
      const dist = resolve(import.meta.dirname, 'dist');
      copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'));
    },
  };
}

export default defineConfig({
  base: BASE,
  build: {
    // Explicit rather than relying on Vite's default target, since the
    // spec's platform floor is iOS Safari 16.4+.
    target: 'safari16',
  },
  plugins: [
    react(),
    spa404Fallback(),
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
