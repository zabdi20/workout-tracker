import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:4173/workout-tracker/';

// The round trip runs against the production build under `vite preview`, so
// it tests what deploys: the base path, the 404 copy and the service worker.
// `vite preview` serves the existing dist/, which is why `npm run test:e2e`
// builds first (and why CI runs this right after its own build).
export default defineConfig({
  testDir: 'e2e',
  // `test.only` left in the file would make the gate pass by running nothing.
  forbidOnly: !!process.env.CI,
  // A flaky round trip is a bug to find, not to retry past.
  retries: 0,
  projects: [
    // WebKit with an iPhone viewport: the engine closest to iOS Safari.
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
  use: {
    baseURL: BASE_URL,
    // The first real run is on a Linux runner nobody can open, and a failure
    // there stops the deploy. These are what the workflow uploads to look at.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
  },
});
