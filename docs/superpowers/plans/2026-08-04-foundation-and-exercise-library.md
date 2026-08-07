# Foundation & Exercise Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an installable offline PWA on iOS that seeds a bundled exercise library, and lets the user search, filter, and create exercises.

**Architecture:** A React + TypeScript SPA with no backend. All persistence is local IndexedDB via Dexie, accessed only through `src/db/`. Filtering and data-transform logic live in pure, I/O-free modules (`src/domain/`, `src/data/mapping.ts`) so they are unit-testable without a database or a DOM. The full v1 database schema — including tables whose UI ships in later plans — is created in this plan so the backup format stays stable across plan boundaries.

**Tech Stack:** Node.js LTS · Vite · React 19 · TypeScript · Dexie 4 · vite-plugin-pwa · Vitest · @testing-library/react · fake-indexeddb

**Source spec:** `docs/superpowers/specs/2026-08-04-workout-tracker-design.md`

**Scope:** This is Plan 1 of 4. It ends with an app deployed to `https://hshadic.github.io/workout-tracker/`, installed on the iPhone home screen, working offline, providing the full exercise library. Routines, cycles, session logging, and backup are Plans 2–4.

**Hosting:** GitHub Pages, project repo `hshadic/workout-tracker`, served from the subpath `/workout-tracker/`. Deployment lands in Task 4 rather than at the end of the plan so that every device verification from Task 5 onward runs against the origin the app will actually live at — no self-signed certificate warnings, no LAN dependency, and no risk of installing a PWA bound to an address that disappears.

## Global Constraints

- **Target platform:** iOS Safari 16.4+, installed via "Add to Home Screen". Desktop browsers are for development only.
- **No backend.** No network requests at runtime. Everything works offline after first load.
- **Timestamps** are stored as epoch milliseconds (`number`), always UTC. Never store local-time strings.
- **IDs** are generated with `crypto.randomUUID()`.
- **Weight** is stored as a number plus the unit it was entered in (`'kg' | 'lb'`) and is **never** converted to a canonical unit on write.
- **Distance** is stored canonically in metres as `distanceMeters`.
- **Never hard-delete** an exercise or routine. Set `isArchived: true`.
- **Tests are colocated** with source as `*.test.ts` / `*.test.tsx`.
- **TDD is required.** Write the failing test, watch it fail, implement, watch it pass, commit.
- **Testing balance** (interpreting the spec's "RTL on Active Session only"): pure logic gets thorough unit tests; screens in this plan get exactly one smoke test each. Exhaustive component tests are out of scope.
- **Shell:** commands are given for **Git Bash** (bundled with Git for Windows), not PowerShell. PowerShell's default `Restricted` execution policy blocks the `npm.ps1` and `npx.ps1` shims; Git Bash invokes the `.exe` directly and is unaffected, so no security setting needs changing. Open the terminal *after* installing Node so it inherits the updated PATH. `npm` scripts themselves are cross-platform.
- **Commit after every task.** Do not batch commits across tasks.

---

## Prerequisites (do before Task 2)

Node.js is **not currently installed** on this machine. Verified: `node` and `npm` are absent from PATH and from all standard install locations.

- [ ] **Step 1: Install Node.js LTS**

Download and run the Windows x64 LTS installer from <https://nodejs.org/en/download>, accepting the default options (this includes npm and adds both to PATH).

Alternatively, via winget in an interactive terminal — note this prompts to accept the source agreement, which must be answered by the user:

```bash
winget install OpenJS.NodeJS.LTS
```

- [ ] **Step 2: Open a NEW terminal and verify**

Run: `node --version; npm --version`
Expected: a version `v20.x` or higher for node, and a version for npm. A new terminal is required — PATH changes do not reach already-open sessions.

If `node` is still not found, log out and back in, or add `C:\Program Files\nodejs` to PATH manually.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `spike/audio-reach.html` | Throwaway device experiment, already run. Never imported by the app; safe to delete. |
| `docs/superpowers/spikes/2026-08-04-rest-alert-reach.md` | Written result of the spike. The decision record. **Complete.** |
| `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` | Build and test configuration. |
| `.gitignore`, `.gitattributes` | Ignore rules; forces LF line endings to stop CRLF churn. |
| `.github/workflows/deploy.yml` | Builds, tests, and publishes to GitHub Pages on push to `main`. |
| `scripts/make-icons.mjs` | Generates PWA PNG icons using only Node builtins. Run once. |
| `scripts/build-exercises.ts` | I/O only: reads vendored source JSON, calls mapping, writes bundled JSON. |
| `src/data/mapping.ts` | **Pure.** Maps `free-exercise-db` records to our schema. Unit-tested. |
| `src/data/exercises.json` | Generated, committed. The bundled library. |
| `src/db/types.ts` | All entity type definitions. No logic. |
| `src/db/db.ts` | Dexie instance and schema. The only file that constructs the database. |
| `src/db/exercises.ts` | Exercise queries and mutations. The only file the UI uses to reach exercise data. |
| `src/db/seed.ts` | First-run seeding of the bundled library. |
| `src/domain/exerciseFilter.ts` | **Pure.** Search and filter logic. Unit-tested. |
| `src/domain/labels.ts` | **Pure.** Display names for muscle/equipment enum values. |
| `src/ui/library/LibraryScreen.tsx` | Library screen composition and state. |
| `src/ui/library/ExerciseList.tsx` | Presentational list. |
| `src/ui/library/FilterSheet.tsx` | Muscle and equipment filter UI. |
| `src/ui/library/CustomExerciseForm.tsx` | Create/edit a custom exercise. |
| `src/pwa/storage.ts` | Persistent-storage request. |
| `src/test-setup.ts` | Registers jest-dom matchers and `fake-indexeddb`. |

No router in this plan. There is one screen; adding routing before a second screen exists is premature. Plan 2 introduces it.

---

## Task 1: Spike — how far does the rest alert reach? — **DONE 2026-08-04**

**No action required. This task is complete; do not re-run it.**

Result: `docs/superpowers/spikes/2026-08-04-rest-alert-reach.md`

**Outcome:** background alerting is impossible on iOS for a PWA. Timers and audio
playback are both suspended when the app is backgrounded, regardless of audio session
category and regardless of whether the app is installed. Measured on iOS 18.7 / Safari
26.5.2: an installed app advanced its audio clock 5.5 s over 58 s away, under 7 % of
real time.

The pre-committed third outcome applies — **foreground tone plus Wake Lock only**, with
app-switched and screen-locked alerting documented as unsupported. Plan 3 builds the
rest timer accordingly: timestamp-based, Wake Lock as the primary mechanism
re-acquired on `visibilitychange`, and elapsed rest made obvious on resume.

`spike/audio-reach.html` is retained as the record of how the measurement was taken. It
is never imported by the app and can be deleted at any time.

---

## Task 2: Project scaffolding and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `.gitattributes`
- Create: `src/main.tsx`, `src/App.tsx`, `src/test-setup.ts`, `src/App.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test`, `npm run dev`, `npm run build`. A mounted React root rendering `<App />`. Vitest configured with jsdom, globals, jest-dom matchers, and `fake-indexeddb` auto-registered for every test.

- [ ] **Step 1: Create ignore and attribute files**

Create `.gitignore`:

```
node_modules
dist
dist-ssr
dev-dist
coverage
*.local
.DS_Store
.vite
```

Create `.gitattributes` (this stops the CRLF warnings seen when committing the spec):

```
* text=auto eol=lf
*.png binary
*.wav binary
*.ico binary
```

- [ ] **Step 2: Initialise the package and install dependencies**

Run each command from the project root:

```bash
npm init -y
```

```bash
npm install react react-dom dexie dexie-react-hooks
```

```bash
npm install -D vite @vitejs/plugin-react typescript @types/node @types/react @types/react-dom vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event fake-indexeddb tsx
```

`@types/node` is required because `src/test-setup.ts` imports `webcrypto` from
`node:crypto`. This has nothing to do with dependency versions — it is needed under
any TypeScript version.

Expected: both installs complete with no `ERR!` lines. Installing latest rather than pinned versions is deliberate — the plan should not encode stale version numbers.

- [ ] **Step 3: Configure package.json scripts**

Replace the `"scripts"` block in `package.json`, and add `"type": "module"` at the top level:

```json
{
  "name": "workout-tracker",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:lan": "vite --host",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "icons": "node scripts/make-icons.mjs",
    "build:exercises": "tsx scripts/build-exercises.ts"
  }
}
```

Leave the generated `dependencies` and `devDependencies` blocks untouched.

- [ ] **Step 4: Write the TypeScript and Vite configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "scripts", "vite.config.ts"]
}
```

Create `vite.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

Create `src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

// jsdom provides a `crypto` object but historically without randomUUID, which
// every entity id depends on. Fall back to Node's implementation when missing.
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}
```

- [ ] **Step 5: Write the failing test**

Create `src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders the app shell with its title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /workout tracker/i })).toBeInTheDocument();
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./App"`.

- [ ] **Step 7: Write the app shell**

Create `src/App.tsx`:

```tsx
export function App() {
  return (
    <main>
      <h1>Workout Tracker</h1>
    </main>
  );
}
```

Create `src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Create `index.html` at the project root:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#111111" />
    <title>Workout Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 1 test passed.

Also run: `npm run build`
Expected: type-check succeeds and `dist/` is produced with no errors.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite + React + TypeScript project

Adds build and test configuration, an app shell, and .gitattributes to
force LF line endings. Vitest runs in jsdom with fake-indexeddb
registered globally so database tests need no per-file setup."
```

---

## Task 3: PWA shell, icons, and home-screen install

**Files:**
- Create: `scripts/make-icons.mjs`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-512-maskable.png`
- Create: `src/pwa/storage.ts`, `src/pwa/storage.test.ts`
- Modify: `vite.config.ts`, `src/main.tsx`

**Interfaces:**
- Consumes: `App` from Task 2.
- Produces: `requestPersistentStorage(): Promise<boolean>` from `src/pwa/storage.ts`. A registered service worker and a web app manifest, making the app installable and offline-capable.

- [ ] **Step 1: Install the PWA plugin**

```bash
npm install -D vite-plugin-pwa
```

No TLS plugin is needed. Wake Lock and service workers require a secure context, and `localhost` already counts as one. Device testing happens against the deployed HTTPS origin from Task 4, not a LAN address.

- [ ] **Step 2: Write the icon generator**

Create `scripts/make-icons.mjs`. This writes valid PNGs using only Node builtins — no image library:

```js
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function png(size, pixel) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    const row = y * stride;
    raw[row] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = row + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A dumbbell: centre bar plus two plates. `inset` shrinks the glyph so
// maskable icons survive the platform's safe-zone crop.
function dumbbell(inset) {
  return (x, y, s) => {
    const u = (s / 32) * inset;
    const cx = s / 2, cy = s / 2;
    const bar = Math.abs(y - cy) <= 2 * u && Math.abs(x - cx) <= 10 * u;
    const plateL = Math.abs(x - (cx - 9 * u)) <= 2.5 * u && Math.abs(y - cy) <= 7 * u;
    const plateR = Math.abs(x - (cx + 9 * u)) <= 2.5 * u && Math.abs(y - cy) <= 7 * u;
    return bar || plateL || plateR ? [245, 245, 245, 255] : [17, 17, 17, 255];
  };
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-192.png', png(192, dumbbell(1)));
writeFileSync('public/icon-512.png', png(512, dumbbell(1)));
writeFileSync('public/icon-512-maskable.png', png(512, dumbbell(0.72)));
console.log('Wrote public/icon-192.png, icon-512.png, icon-512-maskable.png');
```

- [ ] **Step 3: Generate the icons and verify they are valid**

Run: `npm run icons`
Expected: `Wrote public/icon-192.png, icon-512.png, icon-512-maskable.png`

Verify they are real PNGs rather than empty files:

```bash
ls -l public/*.png
```

Expected: three files, each with a non-zero byte size. Open one to confirm a white dumbbell on a dark square.

- [ ] **Step 4: Write the failing test for persistent storage**

Create `src/pwa/storage.test.ts`:

```ts
import { requestPersistentStorage } from './storage';

describe('requestPersistentStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when the Storage API is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it('does not re-request when storage is already persisted', async () => {
    const persist = vi.fn();
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => true, persist },
    });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('requests persistence when not yet granted', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => false, persist },
    });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('returns false when the request throws', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => { throw new Error('denied'); },
        persist: vi.fn(),
      },
    });
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test src/pwa/storage.test.ts`
Expected: FAIL — `Failed to resolve import "./storage"`.

- [ ] **Step 6: Implement persistent storage**

Create `src/pwa/storage.ts`:

```ts
/**
 * Asks the browser to exempt our IndexedDB data from eviction.
 * iOS reclaims web storage more aggressively than native app storage, so this
 * is a meaningful defence for training history. It is best-effort: a false
 * return is not an error, it just means backups matter more.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test src/pwa/storage.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 8: Wire up the manifest, service worker, and HTTPS dev server**

Replace `vite.config.ts` with:

```ts
/// <reference types="vitest" />
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
```

Update `src/main.tsx` to register the service worker and request persistence:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { requestPersistentStorage } from './pwa/storage';

registerSW({ immediate: true });
void requestPersistentStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Add the plugin's client types so `virtual:pwa-register` type-checks. Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

- [ ] **Step 9: Verify the build produces a service worker and manifest**

Run: `npm run build`
Expected: type-check passes, and the output lists `dist/sw.js` and `dist/manifest.webmanifest` among the generated files.

Run: `npm test`
Expected: PASS — all 5 tests pass (1 from Task 2, 4 from this task).

- [ ] **Step 10: Verify locally**

Run: `npm run build && npm run preview`

Open the printed `http://localhost:4173/workout-tracker/` URL. Note the subpath — with `base` set, the app is no longer at the root. `localhost` is a secure context, so the service worker registers over plain HTTP.

**Use `preview`, not `dev`.** `vite-plugin-pwa` defaults `devOptions.enabled` to false, so the dev server registers no service worker and injects no manifest link. `preview` serves the real `dist/` build, which is what GitHub Pages actually ships — a more faithful check than the dev server would be even if it worked.

Expected: the page renders "Workout Tracker". In DevTools → Application, the manifest is detected and a service worker is registered with scope `/workout-tracker/`.

**Do not install on the iPhone yet.** Task 4 publishes to a stable HTTPS URL, and every device test from then on uses it. Installing now from a temporary LAN address would create a PWA bound to an origin that disappears — and reinstalling from a different origin starts with an empty database.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: add PWA shell, icons, and persistent storage request

Generates manifest icons with a dependency-free PNG writer, registers a
service worker for offline use, and requests storage persistence to
reduce the risk of iOS evicting training history.

Sets the /workout-tracker/ base consistently across Vite, the manifest
and the service worker scope, since GitHub Pages serves a project repo
from a subpath."
```

---

## Task 4: Deploy to GitHub Pages

**This task publishes code to a public URL under the user's GitHub account.** It requires an explicit go-ahead and two manual steps only the account owner can perform.

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: the production build configured in Task 3.
- Produces: a stable public HTTPS origin, `https://hshadic.github.io/workout-tracker/`. Every device verification from Task 5 onward uses it in place of a LAN address.

This sits here rather than at the end of the plan so every later device verification runs against the origin the app will permanently live at. Testing against a LAN dev server instead means a self-signed certificate warning each session, an address that changes between sessions, and a real risk of installing a PWA bound to an origin that later disappears — which would silently orphan its database.

- [ ] **Step 1: Rename the default branch**

```bash
git branch -M main
```

`git init` created this repo as `master`; GitHub and the workflow below both assume `main`.

- [ ] **Step 2: Write the deploy workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# Never let two deploys race; the most recent one wins.
concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      # Tests gate the deploy: a red suite must never reach the phone.
      - run: npm test
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Create the repository (manual — account owner only)**

At <https://github.com/new>, create a repository named exactly `workout-tracker`, visibility **Public**, with no README, `.gitignore` or licence — the local repo already has history and GitHub-generated files would conflict with the first push.

The repository name must match the `BASE` constant in `vite.config.ts`. Changing one without the other breaks offline loading.

Public is required because GitHub Pages on a private repository needs a paid plan. Only source code is published; training data lives in on-device IndexedDB and never reaches GitHub.

- [ ] **Step 4: Push**

```bash
git remote add origin https://github.com/hshadic/workout-tracker.git && git push -u origin main
```

Expected: the push succeeds and commits appear on GitHub. Authentication prompts for a browser sign-in or a personal access token.

- [ ] **Step 5: Enable Pages (manual)**

In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

- [ ] **Step 6: Verify the deployment**

Watch the run under the repository's **Actions** tab.

Expected: both the `build` and `deploy` jobs pass. If `npm test` fails, the deploy is correctly blocked — fix the tests rather than removing the gate.

Then confirm the site is live:

```bash
curl -sSI https://hshadic.github.io/workout-tracker/ | head -1
```

Expected: `HTTP/2 200`. The first deploy can take a few minutes to propagate.

- [ ] **Step 7: Install on the iPhone**

On the phone, open `https://hshadic.github.io/workout-tracker/` in Safari. Real HTTPS, no certificate warning, and it works on any network — including the residential one that blocks LAN access.

Tap **Share → Add to Home Screen**, then launch it from the icon.

Expected: opens without Safari chrome and shows "Workout Tracker", with the dumbbell icon on the home screen. Then enable Airplane Mode and relaunch — it still loads, proving the service worker is caching correctly.

This is the origin the app keeps permanently. Everything installed from here survives updates.

- [ ] **Step 8: Commit**

```bash
git add .github && git commit -m "ci: deploy to GitHub Pages on push to main

Tests gate the deploy so a failing suite cannot reach the phone.

A published origin is required rather than optional: a PWA is bound to
the origin it was installed from, so installing from a temporary LAN
address would produce an app that cannot update and whose database is
lost on reinstall." && git push
```

---

## Task 5: Database schema

**Files:**
- Create: `src/db/types.ts`, `src/db/db.ts`, `src/db/db.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Types: `MuscleGroup`, `Equipment`, `MeasurementType`, `WeightUnit`, `SetType`, `SessionStatus`, `GoalType`, `Exercise`, `RoutineItem`, `Routine`, `Cycle`, `Session`, `LoggedSet`, `BodyweightEntry`, `Goal`, `Settings`.
  - `db` — a `WorkoutDb` Dexie instance with tables `exercises`, `routines`, `cycles`, `sessions`, `sets`, `bodyweight`, `goals`, `settings`.
  - `SETTINGS_ID` — the fixed primary key of the singleton settings row.

The full v1 schema is created here even though routines, sessions and sets have no UI until Plans 2–3. Creating them now keeps the backup format stable across plans, as the spec requires.

- [ ] **Step 1: Write the type definitions**

Create `src/db/types.ts`:

```ts
export type MuscleGroup =
  | 'chest'
  | 'delts' | 'front_delts' | 'side_delts' | 'rear_delts'
  | 'lats' | 'traps' | 'upper_back' | 'lower_back'
  | 'biceps' | 'triceps' | 'forearms'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves'
  | 'adductors' | 'abductors'
  | 'abs' | 'obliques' | 'neck';

export type Equipment =
  | 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight'
  | 'kettlebell' | 'band' | 'smith' | 'ez_bar' | 'other';

export type MeasurementType =
  | 'weight_reps'
  | 'bodyweight_reps'
  | 'assisted_reps'
  | 'duration'
  | 'distance_duration'
  | 'weight_duration';

export type WeightUnit = 'kg' | 'lb';
export type SetType = 'working' | 'warmup';
export type SessionStatus = 'in_progress' | 'completed';
export type GoalType = 'lift_1rm' | 'lift_weight_reps' | 'bodyweight' | 'frequency';

export interface Exercise {
  id: string;
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment;
  measurementType: MeasurementType;
  instructions?: string;
  isCustom: boolean;
  isArchived: boolean;
  /** Smallest sensible weight jump, in the exercise's usual unit. Used by
   *  plate maths and progression suggestions in later plans. */
  defaultIncrement?: number;
}

export interface RoutineItem {
  id: string;
  exerciseId: string;
  order: number;
  /** Items sharing a group are performed alternating. Unused until Plan 3+. */
  supersetGroup?: string | null;
  restSeconds?: number;
  /** Forward-compatibility hooks for suggested progression. No v1 UI. */
  targetSets?: number;
  targetRepMin?: number;
  targetRepMax?: number;
}

export interface Routine {
  id: string;
  name: string;
  notes?: string;
  items: RoutineItem[];
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Cycle {
  id: string;
  name: string;
  routineIds: string[];
  currentIndex: number;
  isActive: boolean;
}

export interface Session {
  id: string;
  /** null means a freestyle session not derived from a routine. */
  routineId: string | null;
  /** Snapshotted from the routine so renaming it later does not rewrite history. */
  name: string;
  startedAt: number;
  endedAt?: number;
  status: SessionStatus;
  notes?: string;
  bodyweightAtTime?: number;
}

export interface LoggedSet {
  id: string;
  sessionId: string;
  exerciseId: string;
  order: number;
  setType: SetType;
  /** Stored with the unit it was entered in. NEVER converted on write. */
  weight?: number;
  unit: WeightUnit;
  reps?: number;
  durationSeconds?: number;
  /** Canonical metres, unlike weight. Distance has no exact-recall requirement. */
  distanceMeters?: number;
  /** Forward-compatibility hook for autoregulation. No v1 UI. */
  rpe?: number;
  completedAt: number;
  notes?: string;
}

export interface BodyweightEntry {
  id: string;
  date: number;
  weight: number;
  unit: WeightUnit;
}

export interface Goal {
  id: string;
  type: GoalType;
  exerciseId?: string;
  targetValue: number;
  targetReps?: number;
  unit?: WeightUnit;
  targetDate?: number;
  createdAt: number;
  achievedAt?: number;
}

export interface Settings {
  id: string;
  unitPreference: WeightUnit;
  defaultRestSeconds: number;
  lastBackupAt?: number;
  restAlertSound: boolean;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/db/db.test.ts`:

```ts
import Dexie from 'dexie';
import { db, SETTINGS_ID, resetDbForTests } from './db';
import type { Exercise, LoggedSet } from './types';

function makeExercise(over: Partial<Exercise> = {}): Exercise {
  return {
    id: crypto.randomUUID(),
    name: 'Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'front_delts'],
    equipment: 'barbell',
    measurementType: 'weight_reps',
    isCustom: false,
    isArchived: false,
    ...over,
  };
}

function makeSet(over: Partial<LoggedSet> = {}): LoggedSet {
  return {
    id: crypto.randomUUID(),
    sessionId: 'session-1',
    exerciseId: 'ex-1',
    order: 0,
    setType: 'working',
    weight: 135,
    unit: 'lb',
    reps: 8,
    completedAt: Date.now(),
    ...over,
  };
}

beforeEach(async () => {
  await resetDbForTests();
});

describe('schema', () => {
  it('creates every v1 table', () => {
    const names = db.tables.map((t) => t.name).sort();
    expect(names).toEqual([
      'bodyweight', 'cycles', 'exercises', 'goals',
      'routines', 'sessions', 'sets', 'settings',
    ]);
  });

  it('round-trips an exercise without altering it', async () => {
    const ex = makeExercise();
    await db.exercises.add(ex);
    await expect(db.exercises.get(ex.id)).resolves.toEqual(ex);
  });

  it('preserves the entered weight unit exactly', async () => {
    const set = makeSet({ weight: 135, unit: 'lb' });
    await db.sets.add(set);
    const stored = await db.sets.get(set.id);
    expect(stored?.weight).toBe(135);
    expect(stored?.unit).toBe('lb');
  });
});

describe('[exerciseId+completedAt] index', () => {
  it('returns only the requested exercise, most recent last', async () => {
    await db.sets.bulkAdd([
      makeSet({ exerciseId: 'squat', completedAt: 300 }),
      makeSet({ exerciseId: 'bench', completedAt: 100 }),
      makeSet({ exerciseId: 'bench', completedAt: 200 }),
      makeSet({ exerciseId: 'bench', completedAt: 50 }),
    ]);

    // Dexie.minKey/maxKey rather than ±Infinity: IndexedDB key validity for
    // non-finite numbers is not something to gamble the app's hottest query on.
    const benchSets = await db.sets
      .where('[exerciseId+completedAt]')
      .between(['bench', Dexie.minKey], ['bench', Dexie.maxKey])
      .toArray();

    expect(benchSets.map((s) => s.completedAt)).toEqual([50, 100, 200]);
  });

  it('finds the most recent set for an exercise', async () => {
    await db.sets.bulkAdd([
      makeSet({ exerciseId: 'bench', completedAt: 100 }),
      makeSet({ exerciseId: 'bench', completedAt: 900 }),
    ]);

    const latest = await db.sets
      .where('[exerciseId+completedAt]')
      .between(['bench', Dexie.minKey], ['bench', Dexie.maxKey])
      .last();

    expect(latest?.completedAt).toBe(900);
  });
});

describe('settings singleton', () => {
  it('stores settings under a fixed id', async () => {
    await db.settings.put({
      id: SETTINGS_ID,
      unitPreference: 'lb',
      defaultRestSeconds: 120,
      restAlertSound: true,
    });
    const all = await db.settings.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].unitPreference).toBe('lb');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test src/db/db.test.ts`
Expected: FAIL — `Failed to resolve import "./db"`.

- [ ] **Step 4: Implement the database**

Create `src/db/db.ts`:

```ts
import Dexie, { type EntityTable } from 'dexie';
import type {
  BodyweightEntry, Cycle, Exercise, Goal,
  LoggedSet, Routine, Session, Settings,
} from './types';

export const SETTINGS_ID = 'singleton';

export class WorkoutDb extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>;
  routines!: EntityTable<Routine, 'id'>;
  cycles!: EntityTable<Cycle, 'id'>;
  sessions!: EntityTable<Session, 'id'>;
  sets!: EntityTable<LoggedSet, 'id'>;
  bodyweight!: EntityTable<BodyweightEntry, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor() {
    super('workout-tracker');
    // isCustom/isArchived/isActive are booleans and Session.routineId is
    // string|null: IndexedDB cannot key on booleans or null, so these fields
    // are deliberately left out of the index strings below. Query them by
    // loading with toArray() and filtering in memory instead.
    this.version(1).stores({
      exercises: 'id, name, equipment, measurementType',
      routines: 'id, name, updatedAt',
      cycles: 'id',
      sessions: 'id, startedAt, status',
      // The compound index serves the hottest query in the app:
      // "what did I do last time on this exercise?"
      sets: 'id, sessionId, exerciseId, completedAt, [exerciseId+completedAt]',
      bodyweight: 'id, date',
      goals: 'id, type, exerciseId, achievedAt',
      settings: 'id',
    });
  }
}

export const db = new WorkoutDb();

/** Test-only. Clears every table so each test starts from a known state. */
export async function resetDbForTests(): Promise<void> {
  await db.open();
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test src/db/db.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add v1 database schema

Defines all entity types and the Dexie schema, including tables whose UI
lands in later plans, so the backup format stays stable across plan
boundaries.

Adds the [exerciseId+completedAt] compound index that serves the app's
hottest query: the last-time reference shown on every set."
```

---

## Task 6: Exercise dataset transform

**Files:**
- Create: `vendor/free-exercise-db.json` (downloaded, committed)
- Create: `src/data/mapping.ts`, `src/data/mapping.test.ts`
- Create: `scripts/build-exercises.ts`
- Create: `src/data/exercises.json` (generated, committed)

**Interfaces:**
- Consumes: `Exercise`, `MuscleGroup`, `Equipment`, `MeasurementType` from `src/db/types.ts`.
- Produces from `src/data/mapping.ts`:
  - `interface SourceExercise` — the shape of a `free-exercise-db` record.
  - `mapEquipment(source: string | null): Equipment`
  - `mapMuscle(source: string): MuscleGroup | null`
  - `inferMeasurementType(source: SourceExercise): MeasurementType`
  - `shouldInclude(source: SourceExercise): boolean`
  - `toExercise(source: SourceExercise): Exercise`
  - `buildLibrary(sources: SourceExercise[]): Exercise[]`

`free-exercise-db` records use a coarser muscle vocabulary than ours — notably a single `shoulders` bucket. It maps to our `delts` value rather than being guessed into `front_delts` / `side_delts` / `rear_delts`. Recording the coarse truth beats inventing a precise-looking lie; specific values remain available for custom and hand-corrected exercises.

- [ ] **Step 1: Vendor the source dataset**

```bash
mkdir -p vendor && curl -L -o vendor/free-exercise-db.json https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
```

Verify it downloaded a real dataset:

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('vendor/free-exercise-db.json','utf8')).length)"
```

Expected: a number in the high hundreds (roughly 800). If this errors or prints 0, the download failed — check the URL is still valid before continuing.

The file is vendored and committed rather than fetched at build time so builds are reproducible and work offline.

- [ ] **Step 2: Write the failing test**

Create `src/data/mapping.test.ts`:

```ts
import {
  mapEquipment, mapMuscle, inferMeasurementType,
  shouldInclude, toExercise, buildLibrary,
  type SourceExercise,
} from './mapping';

function source(over: Partial<SourceExercise> = {}): SourceExercise {
  return {
    id: 'Barbell_Bench_Press',
    name: 'Barbell Bench Press',
    equipment: 'barbell',
    category: 'strength',
    mechanic: 'compound',
    force: 'push',
    level: 'beginner',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    instructions: ['Lie on the bench.', 'Press the bar.'],
    ...over,
  };
}

describe('mapEquipment', () => {
  it('maps known equipment to our vocabulary', () => {
    expect(mapEquipment('barbell')).toBe('barbell');
    expect(mapEquipment('body only')).toBe('bodyweight');
    expect(mapEquipment('kettlebells')).toBe('kettlebell');
    expect(mapEquipment('e-z curl bar')).toBe('ez_bar');
    expect(mapEquipment('bands')).toBe('band');
  });

  it('maps unknown or missing equipment to other', () => {
    expect(mapEquipment('foam roll')).toBe('other');
    expect(mapEquipment(null)).toBe('other');
    expect(mapEquipment('something new')).toBe('other');
  });
});

describe('mapMuscle', () => {
  it('renames muscles to our vocabulary', () => {
    expect(mapMuscle('quadriceps')).toBe('quads');
    expect(mapMuscle('abdominals')).toBe('abs');
    expect(mapMuscle('middle back')).toBe('upper_back');
    expect(mapMuscle('lower back')).toBe('lower_back');
  });

  it('maps the coarse shoulders bucket to delts rather than guessing a head', () => {
    expect(mapMuscle('shoulders')).toBe('delts');
  });

  it('returns null for unrecognised muscles', () => {
    expect(mapMuscle('gizzard')).toBeNull();
  });
});

describe('inferMeasurementType', () => {
  it('treats bodyweight movements as bodyweight_reps', () => {
    expect(inferMeasurementType(source({ equipment: 'body only' }))).toBe('bodyweight_reps');
  });

  it('treats cardio as distance_duration', () => {
    expect(inferMeasurementType(source({ category: 'cardio' }))).toBe('distance_duration');
  });

  it('treats stretching as duration', () => {
    expect(inferMeasurementType(source({ category: 'stretching' }))).toBe('duration');
  });

  it('defaults to weight_reps', () => {
    expect(inferMeasurementType(source())).toBe('weight_reps');
  });

  it('applies name-based overrides ahead of the general rules', () => {
    expect(inferMeasurementType(source({ name: 'Plank', equipment: 'body only' }))).toBe('duration');
    expect(inferMeasurementType(source({ name: 'Assisted Pull-Up', equipment: 'machine' })))
      .toBe('assisted_reps');
  });
});

describe('shouldInclude', () => {
  it('keeps strength movements with mapped equipment', () => {
    expect(shouldInclude(source())).toBe(true);
  });

  it('drops non-strength categories', () => {
    expect(shouldInclude(source({ category: 'stretching' }))).toBe(false);
    expect(shouldInclude(source({ category: 'cardio' }))).toBe(false);
  });

  it('drops exercises whose equipment we cannot map', () => {
    expect(shouldInclude(source({ equipment: 'foam roll' }))).toBe(false);
  });

  it('drops exercises with no usable primary muscle', () => {
    expect(shouldInclude(source({ primaryMuscles: [] }))).toBe(false);
    expect(shouldInclude(source({ primaryMuscles: ['gizzard'] }))).toBe(false);
  });
});

describe('toExercise', () => {
  it('produces a valid library entry', () => {
    const ex = toExercise(source());
    expect(ex).toMatchObject({
      id: 'Barbell_Bench_Press',
      name: 'Barbell Bench Press',
      primaryMuscles: ['chest'],
      secondaryMuscles: ['delts', 'triceps'],
      equipment: 'barbell',
      measurementType: 'weight_reps',
      isCustom: false,
      isArchived: false,
    });
  });

  it('joins instructions into a single string', () => {
    expect(toExercise(source()).instructions).toBe('Lie on the bench. Press the bar.');
  });

  it('omits instructions when the source has none', () => {
    expect(toExercise(source({ instructions: [] })).instructions).toBeUndefined();
  });

  it('drops unrecognised muscles rather than emitting nulls', () => {
    const ex = toExercise(source({ secondaryMuscles: ['gizzard', 'triceps'] }));
    expect(ex.secondaryMuscles).toEqual(['triceps']);
  });
});

describe('buildLibrary', () => {
  it('filters, sorts by name, and de-duplicates', () => {
    const library = buildLibrary([
      source({ id: 'z', name: 'Zercher Squat', primaryMuscles: ['quadriceps'] }),
      source({ id: 'a', name: 'Arnold Press', primaryMuscles: ['shoulders'] }),
      source({ id: 'dupe', name: 'Arnold Press', primaryMuscles: ['shoulders'] }),
      source({ id: 'drop', name: 'Foam Roll', equipment: 'foam roll' }),
    ]);

    expect(library.map((e) => e.name)).toEqual(['Arnold Press', 'Zercher Squat']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test src/data/mapping.test.ts`
Expected: FAIL — `Failed to resolve import "./mapping"`.

- [ ] **Step 4: Implement the mapping**

Create `src/data/mapping.ts`:

```ts
import type { Equipment, Exercise, MeasurementType, MuscleGroup } from '../db/types';

/** The shape of a record in free-exercise-db's dist/exercises.json. */
export interface SourceExercise {
  id: string;
  name: string;
  equipment: string | null;
  category: string;
  mechanic: string | null;
  force: string | null;
  level: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
}

const EQUIPMENT: Record<string, Equipment> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  kettlebells: 'kettlebell',
  cable: 'cable',
  machine: 'machine',
  'body only': 'bodyweight',
  bands: 'band',
  'e-z curl bar': 'ez_bar',
};

const MUSCLE: Record<string, MuscleGroup> = {
  abdominals: 'abs',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lower_back',
  'middle back': 'upper_back',
  neck: 'neck',
  quadriceps: 'quads',
  // Source has a single coarse bucket. We record that truth rather than
  // guessing which deltoid head an exercise emphasises.
  shoulders: 'delts',
  traps: 'traps',
  triceps: 'triceps',
};

/** Exercises whose measurement type the general rules get wrong. */
const MEASUREMENT_OVERRIDES: Array<[RegExp, MeasurementType]> = [
  [/\bassisted\b/i, 'assisted_reps'],
  // "dead hang" spelled out: a bare \bhang\b also matches Hang Clean and
  // Hang Snatch, mislabelling 9 Olympic lifts as duration.
  [/\b(plank|hold|iron cross|l-sit)\b|\bdead hang\b/i, 'duration'],
  [/\bfarmer'?s walk\b/i, 'weight_duration'],
];

const KEPT_CATEGORIES = new Set(['strength', 'powerlifting', 'olympic weightlifting']);

export function mapEquipment(source: string | null): Equipment {
  if (!source) return 'other';
  return EQUIPMENT[source] ?? 'other';
}

export function mapMuscle(source: string): MuscleGroup | null {
  return MUSCLE[source] ?? null;
}

function mapMuscles(sources: string[]): MuscleGroup[] {
  const mapped = sources.map(mapMuscle).filter((m): m is MuscleGroup => m !== null);
  return [...new Set(mapped)];
}

export function inferMeasurementType(source: SourceExercise): MeasurementType {
  for (const [pattern, type] of MEASUREMENT_OVERRIDES) {
    if (pattern.test(source.name)) return type;
  }
  if (source.category === 'cardio') return 'distance_duration';
  if (source.category === 'stretching') return 'duration';
  if (mapEquipment(source.equipment) === 'bodyweight') return 'bodyweight_reps';
  return 'weight_reps';
}

export function shouldInclude(source: SourceExercise): boolean {
  if (!KEPT_CATEGORIES.has(source.category)) return false;
  if (mapEquipment(source.equipment) === 'other') return false;
  return mapMuscles(source.primaryMuscles).length > 0;
}

export function toExercise(source: SourceExercise): Exercise {
  const instructions = source.instructions.join(' ').trim();
  return {
    id: source.id,
    name: source.name,
    primaryMuscles: mapMuscles(source.primaryMuscles),
    secondaryMuscles: mapMuscles(source.secondaryMuscles),
    equipment: mapEquipment(source.equipment),
    measurementType: inferMeasurementType(source),
    ...(instructions ? { instructions } : {}),
    isCustom: false,
    isArchived: false,
  };
}

export function buildLibrary(sources: SourceExercise[]): Exercise[] {
  const byName = new Map<string, Exercise>();
  for (const source of sources) {
    if (!shouldInclude(source)) continue;
    const key = source.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, toExercise(source));
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test src/data/mapping.test.ts`
Expected: PASS — 18 tests passed.

- [ ] **Step 6: Write the build script**

Create `scripts/build-exercises.ts`. It does I/O only; all logic lives in the tested module:

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildLibrary, type SourceExercise } from '../src/data/mapping';

const sources: SourceExercise[] = JSON.parse(
  readFileSync('vendor/free-exercise-db.json', 'utf8'),
);

const library = buildLibrary(sources);

mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/exercises.json', JSON.stringify(library, null, 2) + '\n');

const byEquipment = library.reduce<Record<string, number>>((acc, e) => {
  acc[e.equipment] = (acc[e.equipment] ?? 0) + 1;
  return acc;
}, {});

console.log(`Read    ${sources.length} source exercises`);
console.log(`Wrote   ${library.length} exercises to src/data/exercises.json`);
console.log('By equipment:', byEquipment);
```

- [ ] **Step 7: Generate the library and check the count**

Run: `npm run build:exercises`

Expected output, verified by running these filter rules against the vendored dataset on 2026-08-04:

```
Read    873 source exercises
Wrote   587 exercises to src/data/exercises.json
By equipment: {
  barbell: 170, dumbbell: 121, cable: 81, 'body only': 75,
  machine: 58, kettlebells: 53, bands: 20, 'e-z curl bar': 9
}
```

**Acceptance:** the written count should be within roughly ±10% of 587, and every equipment type should be represented. Exact numbers may drift if the upstream dataset changes; the shape is what matters.

If the count is **far below 587**, the filter is too aggressive — use the printed breakdown to find which equipment type or category collapsed to zero.

Do not add a curation pass to shrink this. That was considered and rejected on measurement: the bundle is 102 KB gzipped with instructions, which is negligible for a one-time offline cache, and search plus filters keep 587 entries navigable. Requiring `mechanic !== null` — the obvious extra filter — removes only 4 exercises and is not worth the code.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: build bundled exercise library from free-exercise-db

Vendors the public-domain source dataset and transforms it to our schema
with pure, unit-tested mapping functions. The source's single 'shoulders'
bucket maps to a coarse 'delts' value rather than guessing a deltoid
head, since recording the coarse truth beats inventing a precise-looking
lie.

No images are bundled, per the spec."
```

---

## Task 7: Seeding and exercise queries

**Files:**
- Create: `src/db/exercises.ts`, `src/db/exercises.test.ts`
- Create: `src/db/seed.ts`, `src/db/seed.test.ts`

**Interfaces:**
- Consumes: `db`, `resetDbForTests` from `src/db/db.ts`; `Exercise` from `src/db/types.ts`; `src/data/exercises.json`.
- Produces:
  - From `src/db/exercises.ts`: `listExercises(opts?: { includeArchived?: boolean }): Promise<Exercise[]>`, `getExercise(id: string): Promise<Exercise | undefined>`, `createCustomExercise(input: NewCustomExercise): Promise<Exercise>`, `updateExercise(id: string, changes: Partial<Exercise>): Promise<void>`, `archiveExercise(id: string): Promise<void>`, `unarchiveExercise(id: string): Promise<void>`, and `interface NewCustomExercise`.
  - From `src/db/seed.ts`: `seedExercisesIfEmpty(): Promise<number>` returning the number of exercises inserted.

- [ ] **Step 1: Write the failing test for queries**

Create `src/db/exercises.test.ts`:

```ts
import { db, resetDbForTests } from './db';
import {
  listExercises, getExercise, createCustomExercise,
  updateExercise, archiveExercise, unarchiveExercise,
} from './exercises';

beforeEach(async () => {
  await resetDbForTests();
});

describe('createCustomExercise', () => {
  it('creates a custom, unarchived exercise with a generated id', async () => {
    const ex = await createCustomExercise({
      name: 'Hammer Strength Row',
      primaryMuscles: ['lats'],
      secondaryMuscles: ['biceps'],
      equipment: 'machine',
      measurementType: 'weight_reps',
    });

    expect(ex.id).toMatch(/[0-9a-f-]{36}/);
    expect(ex.isCustom).toBe(true);
    expect(ex.isArchived).toBe(false);
    await expect(getExercise(ex.id)).resolves.toEqual(ex);
  });

  it('trims whitespace from the name', async () => {
    const ex = await createCustomExercise({
      name: '  Cable Fly  ',
      primaryMuscles: ['chest'],
      secondaryMuscles: [],
      equipment: 'cable',
      measurementType: 'weight_reps',
    });
    expect(ex.name).toBe('Cable Fly');
  });

  it('rejects a blank name', async () => {
    await expect(
      createCustomExercise({
        name: '   ',
        primaryMuscles: ['chest'],
        secondaryMuscles: [],
        equipment: 'cable',
        measurementType: 'weight_reps',
      }),
    ).rejects.toThrow(/name/i);
  });

  it('rejects an exercise with no primary muscle', async () => {
    await expect(
      createCustomExercise({
        name: 'Mystery Move',
        primaryMuscles: [],
        secondaryMuscles: [],
        equipment: 'cable',
        measurementType: 'weight_reps',
      }),
    ).rejects.toThrow(/primary muscle/i);
  });
});

describe('listExercises', () => {
  it('excludes archived exercises by default and sorts by name', async () => {
    const a = await createCustomExercise({
      name: 'Zottman Curl', primaryMuscles: ['biceps'], secondaryMuscles: [],
      equipment: 'dumbbell', measurementType: 'weight_reps',
    });
    await createCustomExercise({
      name: 'Ab Wheel', primaryMuscles: ['abs'], secondaryMuscles: [],
      equipment: 'other', measurementType: 'bodyweight_reps',
    });
    await archiveExercise(a.id);

    const names = (await listExercises()).map((e) => e.name);
    expect(names).toEqual(['Ab Wheel']);
  });

  it('includes archived exercises when asked', async () => {
    const a = await createCustomExercise({
      name: 'Zottman Curl', primaryMuscles: ['biceps'], secondaryMuscles: [],
      equipment: 'dumbbell', measurementType: 'weight_reps',
    });
    await archiveExercise(a.id);

    const names = (await listExercises({ includeArchived: true })).map((e) => e.name);
    expect(names).toEqual(['Zottman Curl']);
  });
});

describe('archiving', () => {
  it('never removes the row, so logged history keeps a valid reference', async () => {
    const ex = await createCustomExercise({
      name: 'Pec Deck', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'machine', measurementType: 'weight_reps',
    });

    await archiveExercise(ex.id);

    expect(await db.exercises.count()).toBe(1);
    expect((await getExercise(ex.id))?.isArchived).toBe(true);
  });

  it('can be undone', async () => {
    const ex = await createCustomExercise({
      name: 'Pec Deck', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'machine', measurementType: 'weight_reps',
    });
    await archiveExercise(ex.id);
    await unarchiveExercise(ex.id);
    expect((await getExercise(ex.id))?.isArchived).toBe(false);
  });
});

describe('updateExercise', () => {
  it('applies changes without touching other fields', async () => {
    const ex = await createCustomExercise({
      name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'cable', measurementType: 'weight_reps',
    });

    await updateExercise(ex.id, { name: 'Low-to-High Cable Fly' });

    const updated = await getExercise(ex.id);
    expect(updated?.name).toBe('Low-to-High Cable Fly');
    expect(updated?.equipment).toBe('cable');
    expect(updated?.isCustom).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test src/db/exercises.test.ts`
Expected: FAIL — `Failed to resolve import "./exercises"`.

- [ ] **Step 3: Implement the queries**

Create `src/db/exercises.ts`:

```ts
import { db } from './db';
import type { Equipment, Exercise, MeasurementType, MuscleGroup } from './types';

export interface NewCustomExercise {
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment;
  measurementType: MeasurementType;
  instructions?: string;
  defaultIncrement?: number;
}

export async function listExercises(
  opts: { includeArchived?: boolean } = {},
): Promise<Exercise[]> {
  const all = await db.exercises.toArray();
  const visible = opts.includeArchived ? all : all.filter((e) => !e.isArchived);
  return visible.sort((a, b) => a.name.localeCompare(b.name));
}

export function getExercise(id: string): Promise<Exercise | undefined> {
  return db.exercises.get(id);
}

export async function createCustomExercise(input: NewCustomExercise): Promise<Exercise> {
  const name = input.name.trim();
  if (!name) throw new Error('Exercise name is required');
  if (input.primaryMuscles.length === 0) {
    throw new Error('At least one primary muscle is required');
  }

  const exercise: Exercise = {
    ...input,
    id: crypto.randomUUID(),
    name,
    isCustom: true,
    isArchived: false,
  };
  await db.exercises.add(exercise);
  return exercise;
}

export async function updateExercise(
  id: string,
  changes: Partial<Exercise>,
): Promise<void> {
  await db.exercises.update(id, changes);
}

/**
 * Archives rather than deletes. A hard delete would orphan every LoggedSet
 * that references this exercise.
 */
export async function archiveExercise(id: string): Promise<void> {
  await db.exercises.update(id, { isArchived: true });
}

export async function unarchiveExercise(id: string): Promise<void> {
  await db.exercises.update(id, { isArchived: false });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test src/db/exercises.test.ts`
Expected: PASS — 9 tests passed.

- [ ] **Step 5: Write the failing test for seeding**

Create `src/db/seed.test.ts`:

```ts
import { db, resetDbForTests } from './db';
import { seedExercisesIfEmpty } from './seed';
import { createCustomExercise, archiveExercise, getExercise } from './exercises';

beforeEach(async () => {
  await resetDbForTests();
});

describe('seedExercisesIfEmpty', () => {
  it('populates an empty database with the bundled library', async () => {
    const inserted = await seedExercisesIfEmpty();
    expect(inserted).toBeGreaterThan(100);
    expect(await db.exercises.count()).toBe(inserted);
  });

  it('marks every seeded exercise as bundled and unarchived', async () => {
    await seedExercisesIfEmpty();
    const all = await db.exercises.toArray();
    expect(all.every((e) => e.isCustom === false)).toBe(true);
    expect(all.every((e) => e.isArchived === false)).toBe(true);
  });

  it('is idempotent', async () => {
    const first = await seedExercisesIfEmpty();
    const second = await seedExercisesIfEmpty();
    expect(second).toBe(0);
    expect(await db.exercises.count()).toBe(first);
  });

  it('seeds exactly once when called concurrently', async () => {
    // React StrictMode invokes effects twice in development, so two calls can
    // be in flight before either has written. Without a transaction the second
    // bulkAdd fails on duplicate keys.
    const [a, b] = await Promise.all([
      seedExercisesIfEmpty(),
      seedExercisesIfEmpty(),
    ]);

    expect(Math.min(a, b)).toBe(0);
    expect(Math.max(a, b)).toBeGreaterThan(100);
    expect(await db.exercises.count()).toBe(Math.max(a, b));
  });

  it('does not run when only custom exercises exist', async () => {
    await createCustomExercise({
      name: 'My Move', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'cable', measurementType: 'weight_reps',
    });

    expect(await seedExercisesIfEmpty()).toBeGreaterThan(100);
    // Seeding must not disturb the user's own exercise.
    const mine = (await db.exercises.toArray()).filter((e) => e.isCustom);
    expect(mine).toHaveLength(1);
  });

  it('does not resurrect archived bundled exercises on a later run', async () => {
    await seedExercisesIfEmpty();
    const first = (await db.exercises.toArray())[0];
    await archiveExercise(first.id);

    await seedExercisesIfEmpty();

    expect((await getExercise(first.id))?.isArchived).toBe(true);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test src/db/seed.test.ts`
Expected: FAIL — `Failed to resolve import "./seed"`.

- [ ] **Step 7: Implement seeding**

Create `src/db/seed.ts`:

```ts
import { db } from './db';
import type { Exercise } from './types';
import bundled from '../data/exercises.json';

/**
 * Populates the bundled exercise library on first run.
 *
 * Seeds only when no bundled exercises are present, so it never disturbs the
 * user's custom exercises and never resurrects ones they archived.
 * Returns the number of exercises inserted.
 *
 * The check and the insert run in one transaction. React StrictMode invokes
 * effects twice in development, so without it two calls can both observe an
 * empty table and the second bulkAdd fails on duplicate keys.
 */
export async function seedExercisesIfEmpty(): Promise<number> {
  return db.transaction('rw', db.exercises, async () => {
    const existingBundled = await db.exercises
      .filter((e) => !e.isCustom)
      .count();
    if (existingBundled > 0) return 0;

    const exercises = bundled as Exercise[];
    await db.exercises.bulkAdd(exercises);
    return exercises.length;
  });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test src/db/seed.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: seed bundled exercises and add exercise queries

Seeding runs only when no bundled exercises exist, so it never disturbs
custom exercises and never resurrects archived ones.

Exercises are archived rather than deleted, because a hard delete would
orphan every logged set referencing them."
```

---

## Task 8: Library screen with search

**Files:**
- Create: `src/domain/exerciseFilter.ts`, `src/domain/exerciseFilter.test.ts`
- Create: `src/domain/labels.ts`
- Create: `src/ui/library/ExerciseList.tsx`
- Create: `src/ui/library/LibraryScreen.tsx`, `src/ui/library/LibraryScreen.test.tsx`
- Modify: `src/App.tsx`, `src/App.test.tsx`

**Interfaces:**
- Consumes: `listExercises` from `src/db/exercises.ts`; `seedExercisesIfEmpty` from `src/db/seed.ts`; `Exercise`, `MuscleGroup`, `Equipment` from `src/db/types.ts`.
- Produces:
  - From `src/domain/exerciseFilter.ts`: `interface ExerciseFilter { query: string; muscles: MuscleGroup[]; equipment: Equipment[] }`, `EMPTY_FILTER: ExerciseFilter`, `filterExercises(exercises: Exercise[], filter: ExerciseFilter): Exercise[]`, `isFilterActive(filter: ExerciseFilter): boolean`.
  - From `src/domain/labels.ts`: `muscleLabel(m: MuscleGroup): string`, `equipmentLabel(e: Equipment): string`, `MUSCLE_GROUPS: MuscleGroup[]`, `EQUIPMENT_TYPES: Equipment[]`.
  - From `src/ui/library/ExerciseList.tsx`: `ExerciseList` component, props `{ exercises: Exercise[]; onSelect?: (e: Exercise) => void }`.
  - From `src/ui/library/LibraryScreen.tsx`: `LibraryScreen` component, no props.

- [ ] **Step 1: Write the failing test for filtering**

Create `src/domain/exerciseFilter.test.ts`:

```ts
import { filterExercises, isFilterActive, EMPTY_FILTER } from './exerciseFilter';
import type { Exercise } from '../db/types';

function ex(over: Partial<Exercise> = {}): Exercise {
  return {
    id: crypto.randomUUID(),
    name: 'Barbell Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps'],
    equipment: 'barbell',
    measurementType: 'weight_reps',
    isCustom: false,
    isArchived: false,
    ...over,
  };
}

describe('filterExercises with no filter', () => {
  it('returns everything, sorted by name', () => {
    const result = filterExercises(
      [ex({ name: 'Squat' }), ex({ name: 'Bench' })],
      EMPTY_FILTER,
    );
    expect(result.map((e) => e.name)).toEqual(['Bench', 'Squat']);
  });
});

describe('filterExercises by query', () => {
  const all = [
    ex({ name: 'Barbell Bench Press' }),
    ex({ name: 'Dumbbell Bench Press' }),
    ex({ name: 'Barbell Squat' }),
  ];

  it('matches case-insensitively', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, query: 'BENCH' });
    expect(result).toHaveLength(2);
  });

  it('requires every token to match, in any order', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, query: 'press barbell' });
    expect(result.map((e) => e.name)).toEqual(['Barbell Bench Press']);
  });

  it('ignores extra whitespace', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, query: '  squat  ' });
    expect(result.map((e) => e.name)).toEqual(['Barbell Squat']);
  });

  it('returns nothing when no name matches', () => {
    expect(filterExercises(all, { ...EMPTY_FILTER, query: 'zercher' })).toEqual([]);
  });
});

describe('filterExercises by muscle', () => {
  const all = [
    ex({ name: 'Bench', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }),
    ex({ name: 'Curl', primaryMuscles: ['biceps'], secondaryMuscles: [] }),
    ex({ name: 'Row', primaryMuscles: ['lats'], secondaryMuscles: ['biceps'] }),
  ];

  it('matches primary muscles', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, muscles: ['chest'] });
    expect(result.map((e) => e.name)).toEqual(['Bench']);
  });

  it('matches secondary muscles too', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, muscles: ['biceps'] });
    expect(result.map((e) => e.name)).toEqual(['Curl', 'Row']);
  });

  it('treats multiple muscles as OR', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, muscles: ['chest', 'lats'] });
    expect(result.map((e) => e.name)).toEqual(['Bench', 'Row']);
  });
});

describe('filterExercises by equipment', () => {
  const all = [
    ex({ name: 'Bench', equipment: 'barbell' }),
    ex({ name: 'Fly', equipment: 'cable' }),
    ex({ name: 'Curl', equipment: 'dumbbell' }),
  ];

  it('treats multiple equipment types as OR', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, equipment: ['cable', 'dumbbell'] });
    expect(result.map((e) => e.name)).toEqual(['Curl', 'Fly']);
  });
});

describe('filterExercises combining criteria', () => {
  it('requires all active criteria to match', () => {
    const all = [
      ex({ name: 'Barbell Bench Press', equipment: 'barbell', primaryMuscles: ['chest'] }),
      ex({ name: 'Cable Fly', equipment: 'cable', primaryMuscles: ['chest'] }),
      ex({ name: 'Cable Row', equipment: 'cable', primaryMuscles: ['lats'] }),
    ];

    const result = filterExercises(all, {
      query: 'cable', muscles: ['chest'], equipment: ['cable'],
    });

    expect(result.map((e) => e.name)).toEqual(['Cable Fly']);
  });
});

describe('isFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it('is false for a whitespace-only query', () => {
    expect(isFilterActive({ ...EMPTY_FILTER, query: '   ' })).toBe(false);
  });

  it('is true when any criterion is set', () => {
    expect(isFilterActive({ ...EMPTY_FILTER, query: 'bench' })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, muscles: ['chest'] })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, equipment: ['cable'] })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test src/domain/exerciseFilter.test.ts`
Expected: FAIL — `Failed to resolve import "./exerciseFilter"`.

- [ ] **Step 3: Implement filtering**

Create `src/domain/exerciseFilter.ts`:

```ts
import type { Equipment, Exercise, MuscleGroup } from '../db/types';

export interface ExerciseFilter {
  query: string;
  muscles: MuscleGroup[];
  equipment: Equipment[];
}

export const EMPTY_FILTER: ExerciseFilter = {
  query: '',
  muscles: [],
  equipment: [],
};

export function isFilterActive(filter: ExerciseFilter): boolean {
  return (
    filter.query.trim().length > 0 ||
    filter.muscles.length > 0 ||
    filter.equipment.length > 0
  );
}

function matchesQuery(exercise: Exercise, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const name = exercise.name.toLowerCase();
  return tokens.every((token) => name.includes(token));
}

function matchesMuscles(exercise: Exercise, muscles: MuscleGroup[]): boolean {
  if (muscles.length === 0) return true;
  const worked = new Set([...exercise.primaryMuscles, ...exercise.secondaryMuscles]);
  return muscles.some((m) => worked.has(m));
}

function matchesEquipment(exercise: Exercise, equipment: Equipment[]): boolean {
  if (equipment.length === 0) return true;
  return equipment.includes(exercise.equipment);
}

export function filterExercises(
  exercises: Exercise[],
  filter: ExerciseFilter,
): Exercise[] {
  return exercises
    .filter(
      (e) =>
        matchesQuery(e, filter.query) &&
        matchesMuscles(e, filter.muscles) &&
        matchesEquipment(e, filter.equipment),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test src/domain/exerciseFilter.test.ts`
Expected: PASS — 14 tests passed.

- [ ] **Step 5: Write the display labels**

Create `src/domain/labels.ts`:

```ts
import type { Equipment, MuscleGroup } from '../db/types';

const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  delts: 'Shoulders',
  front_delts: 'Front delts',
  side_delts: 'Side delts',
  rear_delts: 'Rear delts',
  lats: 'Lats',
  traps: 'Traps',
  upper_back: 'Upper back',
  lower_back: 'Lower back',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  adductors: 'Adductors',
  abductors: 'Abductors',
  abs: 'Abs',
  obliques: 'Obliques',
  neck: 'Neck',
};

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  band: 'Band',
  smith: 'Smith machine',
  ez_bar: 'EZ bar',
  other: 'Other',
};

export const MUSCLE_GROUPS = Object.keys(MUSCLE_LABELS) as MuscleGroup[];
export const EQUIPMENT_TYPES = Object.keys(EQUIPMENT_LABELS) as Equipment[];

export function muscleLabel(m: MuscleGroup): string {
  return MUSCLE_LABELS[m];
}

export function equipmentLabel(e: Equipment): string {
  return EQUIPMENT_LABELS[e];
}
```

- [ ] **Step 6: Write the failing smoke test for the screen**

Create `src/ui/library/LibraryScreen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise } from '../../db/exercises';
import { LibraryScreen } from './LibraryScreen';

beforeEach(async () => {
  await resetDbForTests();
  await createCustomExercise({
    name: 'Barbell Bench Press', primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps'], equipment: 'barbell',
    measurementType: 'weight_reps',
  });
  await createCustomExercise({
    name: 'Barbell Squat', primaryMuscles: ['quads'],
    secondaryMuscles: ['glutes'], equipment: 'barbell',
    measurementType: 'weight_reps',
  });
});

it('lists exercises and narrows them as the user searches', async () => {
  const user = userEvent.setup();
  render(<LibraryScreen />);

  expect(await screen.findByText('Barbell Bench Press')).toBeInTheDocument();
  expect(screen.getByText('Barbell Squat')).toBeInTheDocument();

  await user.type(screen.getByRole('searchbox', { name: /search exercises/i }), 'squat');

  expect(await screen.findByText('Barbell Squat')).toBeInTheDocument();
  expect(screen.queryByText('Barbell Bench Press')).not.toBeInTheDocument();
});

it('tells the user when nothing matches', async () => {
  const user = userEvent.setup();
  render(<LibraryScreen />);

  await screen.findByText('Barbell Squat');
  await user.type(screen.getByRole('searchbox', { name: /search exercises/i }), 'zercher');

  expect(await screen.findByText(/no exercises match/i)).toBeInTheDocument();
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test src/ui/library/LibraryScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./LibraryScreen"`.

- [ ] **Step 8: Implement the list and screen**

Create `src/ui/library/ExerciseList.tsx`:

```tsx
import type { Exercise } from '../../db/types';
import { equipmentLabel, muscleLabel } from '../../domain/labels';

interface Props {
  exercises: Exercise[];
  onSelect?: (exercise: Exercise) => void;
}

export function ExerciseList({ exercises, onSelect }: Props) {
  if (exercises.length === 0) {
    return <p className="empty">No exercises match those filters.</p>;
  }

  return (
    <ul className="exercise-list">
      {exercises.map((exercise) => (
        <li key={exercise.id}>
          <button type="button" onClick={() => onSelect?.(exercise)}>
            <span className="exercise-name">{exercise.name}</span>
            <span className="exercise-meta">
              {exercise.primaryMuscles.map(muscleLabel).join(', ')}
              {' · '}
              {equipmentLabel(exercise.equipment)}
              {exercise.isCustom && ' · Custom'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

Create `src/ui/library/LibraryScreen.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listExercises } from '../../db/exercises';
import { EMPTY_FILTER, filterExercises, type ExerciseFilter } from '../../domain/exerciseFilter';
import { ExerciseList } from './ExerciseList';

export function LibraryScreen() {
  const [filter, setFilter] = useState<ExerciseFilter>(EMPTY_FILTER);
  const exercises = useLiveQuery(() => listExercises(), []);

  const visible = useMemo(
    () => filterExercises(exercises ?? [], filter),
    [exercises, filter],
  );

  return (
    <section>
      <h2>Exercises</h2>

      <input
        type="search"
        aria-label="Search exercises"
        placeholder="Search exercises"
        value={filter.query}
        onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
      />

      {exercises === undefined ? (
        <p>Loading…</p>
      ) : (
        <>
          <p className="count">{visible.length} exercises</p>
          <ExerciseList exercises={visible} />
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test src/ui/library/LibraryScreen.test.tsx`
Expected: PASS — 2 tests passed.

- [ ] **Step 10: Mount the screen in the app and seed on start**

Replace `src/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { seedExercisesIfEmpty } from './db/seed';
import { LibraryScreen } from './ui/library/LibraryScreen';

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    seedExercisesIfEmpty()
      .then(() => setReady(true))
      .catch((e: unknown) => {
        // Failing loudly matters here: a silent failure would leave the app
        // looking functional while writing to nothing.
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  return (
    <main>
      <h1>Workout Tracker</h1>
      {error && (
        <p role="alert">
          Could not open the database: {error}. Training data cannot be saved.
        </p>
      )}
      {!error && !ready && <p>Preparing your exercise library…</p>}
      {ready && <LibraryScreen />}
    </main>
  );
}
```

Replace `src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { resetDbForTests, db } from './db/db';
import { App } from './App';

beforeEach(async () => {
  await resetDbForTests();
});

it('renders the app title', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /workout tracker/i })).toBeInTheDocument();
});

it('seeds the library on first run and shows it', async () => {
  render(<App />);
  expect(await screen.findByRole('heading', { name: /exercises/i })).toBeInTheDocument();
  expect(await db.exercises.count()).toBeGreaterThan(100);
});
```

- [ ] **Step 11: Run the full suite**

Run: `npm test`
Expected: PASS — all tests pass across every file.

Run: `npm run build`
Expected: type-check and build succeed.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat: add exercise library screen with search

Search matches all query tokens in any order against the exercise name.
Filtering is a pure function over the in-memory list, unit-tested apart
from React and IndexedDB; the screen itself gets one smoke test.

Database open failures surface to the user rather than leaving the app
looking functional while writing to nothing."
```

---

## Task 9: Muscle and equipment filters

**Files:**
- Create: `src/ui/library/FilterSheet.tsx`
- Modify: `src/ui/library/LibraryScreen.tsx`, `src/ui/library/LibraryScreen.test.tsx`

**Interfaces:**
- Consumes: `ExerciseFilter`, `EMPTY_FILTER`, `isFilterActive` from `src/domain/exerciseFilter.ts`; `MUSCLE_GROUPS`, `EQUIPMENT_TYPES`, `muscleLabel`, `equipmentLabel` from `src/domain/labels.ts`.
- Produces: `FilterSheet` component from `src/ui/library/FilterSheet.tsx`, props `{ filter: ExerciseFilter; onChange: (filter: ExerciseFilter) => void }`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/library/LibraryScreen.test.tsx`:

```tsx
it('filters by equipment', async () => {
  const user = userEvent.setup();
  await createCustomExercise({
    name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
    equipment: 'cable', measurementType: 'weight_reps',
  });

  render(<LibraryScreen />);
  await screen.findByText('Cable Fly');

  await user.click(screen.getByRole('button', { name: /filters/i }));
  await user.click(screen.getByRole('checkbox', { name: 'Cable' }));

  expect(await screen.findByText('Cable Fly')).toBeInTheDocument();
  expect(screen.queryByText('Barbell Squat')).not.toBeInTheDocument();
});

it('filters by muscle, matching secondary muscles too', async () => {
  const user = userEvent.setup();
  render(<LibraryScreen />);
  await screen.findByText('Barbell Squat');

  await user.click(screen.getByRole('button', { name: /filters/i }));
  await user.click(screen.getByRole('checkbox', { name: 'Triceps' }));

  // Bench lists triceps as a secondary muscle; squat does not work them.
  expect(await screen.findByText('Barbell Bench Press')).toBeInTheDocument();
  expect(screen.queryByText('Barbell Squat')).not.toBeInTheDocument();
});

it('clears all filters at once', async () => {
  const user = userEvent.setup();
  render(<LibraryScreen />);
  await screen.findByText('Barbell Squat');

  await user.click(screen.getByRole('button', { name: /filters/i }));
  await user.click(screen.getByRole('checkbox', { name: 'Triceps' }));
  await screen.findByText('Barbell Bench Press');

  await user.click(screen.getByRole('button', { name: /clear filters/i }));

  expect(await screen.findByText('Barbell Squat')).toBeInTheDocument();
  expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test src/ui/library/LibraryScreen.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /filters/i`.

- [ ] **Step 3: Implement the filter sheet**

Create `src/ui/library/FilterSheet.tsx`:

```tsx
import type { Equipment, MuscleGroup } from '../../db/types';
import type { ExerciseFilter } from '../../domain/exerciseFilter';
import {
  EQUIPMENT_TYPES, MUSCLE_GROUPS, equipmentLabel, muscleLabel,
} from '../../domain/labels';

interface Props {
  filter: ExerciseFilter;
  onChange: (filter: ExerciseFilter) => void;
}

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

export function FilterSheet({ filter, onChange }: Props) {
  return (
    <div className="filter-sheet">
      <fieldset>
        <legend>Muscle</legend>
        {MUSCLE_GROUPS.map((muscle: MuscleGroup) => (
          <label key={muscle}>
            <input
              type="checkbox"
              checked={filter.muscles.includes(muscle)}
              onChange={() =>
                onChange({ ...filter, muscles: toggle(filter.muscles, muscle) })
              }
            />
            {muscleLabel(muscle)}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Equipment</legend>
        {EQUIPMENT_TYPES.map((equipment: Equipment) => (
          <label key={equipment}>
            <input
              type="checkbox"
              checked={filter.equipment.includes(equipment)}
              onChange={() =>
                onChange({ ...filter, equipment: toggle(filter.equipment, equipment) })
              }
            />
            {equipmentLabel(equipment)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 4: Wire the sheet into the library screen**

Replace `src/ui/library/LibraryScreen.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listExercises } from '../../db/exercises';
import {
  EMPTY_FILTER, filterExercises, isFilterActive, type ExerciseFilter,
} from '../../domain/exerciseFilter';
import { ExerciseList } from './ExerciseList';
import { FilterSheet } from './FilterSheet';

export function LibraryScreen() {
  const [filter, setFilter] = useState<ExerciseFilter>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const exercises = useLiveQuery(() => listExercises(), []);

  const visible = useMemo(
    () => filterExercises(exercises ?? [], filter),
    [exercises, filter],
  );

  const activeCount = filter.muscles.length + filter.equipment.length;

  return (
    <section>
      <h2>Exercises</h2>

      <input
        type="search"
        aria-label="Search exercises"
        placeholder="Search exercises"
        value={filter.query}
        onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
      />

      <div className="filter-controls">
        <button type="button" onClick={() => setShowFilters((s) => !s)}>
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
        {isFilterActive(filter) && (
          <button type="button" onClick={() => setFilter(EMPTY_FILTER)}>
            Clear filters
          </button>
        )}
      </div>

      {showFilters && <FilterSheet filter={filter} onChange={setFilter} />}

      {exercises === undefined ? (
        <p>Loading…</p>
      ) : (
        <>
          <p className="count">{visible.length} exercises</p>
          <ExerciseList exercises={visible} />
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test src/ui/library/LibraryScreen.test.tsx`
Expected: PASS — 5 tests passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: filter the exercise library by muscle and equipment

Muscle filtering matches secondary muscles as well as primary, so
searching for triceps surfaces bench press. Multiple selections within a
category are OR; across categories they are AND."
```

---

## Task 10: Create and edit custom exercises

**Files:**
- Create: `src/ui/library/CustomExerciseForm.tsx`, `src/ui/library/CustomExerciseForm.test.tsx`
- Modify: `src/ui/library/LibraryScreen.tsx`

**Interfaces:**
- Consumes: `createCustomExercise`, `updateExercise`, `archiveExercise`, `NewCustomExercise` from `src/db/exercises.ts`; label helpers from `src/domain/labels.ts`.
- Produces: `CustomExerciseForm` component, props `{ existing?: Exercise; onDone: () => void; onCancel: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/library/CustomExerciseForm.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise, listExercises, getExercise } from '../../db/exercises';
import { CustomExerciseForm } from './CustomExerciseForm';

beforeEach(async () => {
  await resetDbForTests();
});

async function fillRequired(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.type(screen.getByLabelText(/exercise name/i), name);
  await user.selectOptions(screen.getByLabelText(/equipment/i), 'machine');
  await user.selectOptions(screen.getByLabelText(/primary muscle/i), 'lats');
}

it('creates a custom exercise', async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(<CustomExerciseForm onDone={onDone} onCancel={vi.fn()} />);

  await fillRequired(user, 'Hammer Strength Row');
  await user.click(screen.getByRole('button', { name: /save/i }));

  const all = await listExercises();
  expect(all.map((e) => e.name)).toEqual(['Hammer Strength Row']);
  expect(all[0].isCustom).toBe(true);
  expect(all[0].primaryMuscles).toEqual(['lats']);
  expect(onDone).toHaveBeenCalledOnce();
});

it('refuses to save without a name and does not call onDone', async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(<CustomExerciseForm onDone={onDone} onCancel={vi.fn()} />);

  await user.selectOptions(screen.getByLabelText(/primary muscle/i), 'lats');
  await user.click(screen.getByRole('button', { name: /save/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/name/i);
  expect(await listExercises()).toHaveLength(0);
  expect(onDone).not.toHaveBeenCalled();
});

it('refuses to save without a primary muscle', async () => {
  const user = userEvent.setup();
  render(<CustomExerciseForm onDone={vi.fn()} onCancel={vi.fn()} />);

  await user.type(screen.getByLabelText(/exercise name/i), 'Mystery Move');
  await user.click(screen.getByRole('button', { name: /save/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/primary muscle/i);
  expect(await listExercises()).toHaveLength(0);
});

it('edits an existing exercise', async () => {
  const user = userEvent.setup();
  const existing = await createCustomExercise({
    name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
    equipment: 'cable', measurementType: 'weight_reps',
  });

  render(<CustomExerciseForm existing={existing} onDone={vi.fn()} onCancel={vi.fn()} />);

  const nameField = screen.getByLabelText(/exercise name/i);
  await user.clear(nameField);
  await user.type(nameField, 'Low-to-High Cable Fly');
  await user.click(screen.getByRole('button', { name: /save/i }));

  expect((await getExercise(existing.id))?.name).toBe('Low-to-High Cable Fly');
});

it('archives rather than deletes', async () => {
  const user = userEvent.setup();
  const existing = await createCustomExercise({
    name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
    equipment: 'cable', measurementType: 'weight_reps',
  });

  render(<CustomExerciseForm existing={existing} onDone={vi.fn()} onCancel={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /archive/i }));

  expect((await getExercise(existing.id))?.isArchived).toBe(true);
  expect(await listExercises()).toHaveLength(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test src/ui/library/CustomExerciseForm.test.tsx`
Expected: FAIL — `Failed to resolve import "./CustomExerciseForm"`.

- [ ] **Step 3: Implement the form**

Create `src/ui/library/CustomExerciseForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import type { Equipment, Exercise, MeasurementType, MuscleGroup } from '../../db/types';
import { archiveExercise, createCustomExercise, updateExercise } from '../../db/exercises';
import {
  EQUIPMENT_TYPES, MUSCLE_GROUPS, equipmentLabel, muscleLabel,
} from '../../domain/labels';

const MEASUREMENT_TYPES: Array<[MeasurementType, string]> = [
  ['weight_reps', 'Weight × reps'],
  ['bodyweight_reps', 'Bodyweight reps'],
  ['assisted_reps', 'Assisted reps'],
  ['duration', 'Duration'],
  ['distance_duration', 'Distance & duration'],
  ['weight_duration', 'Weight & duration'],
];

interface Props {
  existing?: Exercise;
  onDone: () => void;
  onCancel: () => void;
}

export function CustomExerciseForm({ existing, onDone, onCancel }: Props) {
  const [name, setName] = useState(existing?.name ?? '');
  const [equipment, setEquipment] = useState<Equipment>(existing?.equipment ?? 'barbell');
  const [primary, setPrimary] = useState<MuscleGroup | ''>(
    existing?.primaryMuscles[0] ?? '',
  );
  const [measurementType, setMeasurementType] = useState<MeasurementType>(
    existing?.measurementType ?? 'weight_reps',
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Exercise name is required');
      return;
    }
    if (!primary) {
      setError('A primary muscle is required');
      return;
    }

    try {
      if (existing) {
        await updateExercise(existing.id, {
          name: name.trim(),
          equipment,
          primaryMuscles: [primary],
          measurementType,
        });
      } else {
        await createCustomExercise({
          name,
          equipment,
          primaryMuscles: [primary],
          secondaryMuscles: [],
          measurementType,
        });
      }
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleArchive() {
    if (!existing) return;
    await archiveExercise(existing.id);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3>{existing ? 'Edit exercise' : 'New exercise'}</h3>

      {error && <p role="alert">{error}</p>}

      <label>
        Exercise name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label>
        Equipment
        <select value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
          {EQUIPMENT_TYPES.map((eq) => (
            <option key={eq} value={eq}>{equipmentLabel(eq)}</option>
          ))}
        </select>
      </label>

      <label>
        Primary muscle
        <select
          value={primary}
          onChange={(e) => setPrimary(e.target.value as MuscleGroup | '')}
        >
          <option value="">Select a muscle…</option>
          {MUSCLE_GROUPS.map((m) => (
            <option key={m} value={m}>{muscleLabel(m)}</option>
          ))}
        </select>
      </label>

      <label>
        Measurement
        <select
          value={measurementType}
          onChange={(e) => setMeasurementType(e.target.value as MeasurementType)}
        >
          {MEASUREMENT_TYPES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>

      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>Cancel</button>
      {existing && (
        <button type="button" onClick={handleArchive}>Archive</button>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test src/ui/library/CustomExerciseForm.test.tsx`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Wire the form into the library screen**

In `src/ui/library/LibraryScreen.tsx`, add the import:

```tsx
import { CustomExerciseForm } from './CustomExerciseForm';
```

Add state below the existing `showFilters` state:

```tsx
const [editing, setEditing] = useState<Exercise | 'new' | null>(null);
```

Add the accompanying type import at the top of the file:

```tsx
import type { Exercise } from '../../db/types';
```

Add a "New exercise" button inside the `filter-controls` div, after the Clear filters button:

```tsx
<button type="button" onClick={() => setEditing('new')}>New exercise</button>
```

Pass a select handler to the list, replacing `<ExerciseList exercises={visible} />`:

```tsx
<ExerciseList exercises={visible} onSelect={(e) => e.isCustom && setEditing(e)} />
```

And render the form above the search input, immediately after the `<h2>`:

```tsx
{editing && (
  <CustomExerciseForm
    existing={editing === 'new' ? undefined : editing}
    onDone={() => setEditing(null)}
    onCancel={() => setEditing(null)}
  />
)}
```

- [ ] **Step 6: Run the full suite and build**

Run: `npm test`
Expected: PASS — every test across every file.

Run: `npm run build`
Expected: type-check and build succeed with no errors.

- [ ] **Step 7: Verify on the iPhone**

Push to `main` so the deploy workflow publishes the current build:

```bash
git push
```

Wait for the Actions run to go green, then open the app from the home-screen icon installed in Task 4. Pull down to refresh once so the service worker picks up the new build. Confirm:

1. The exercise library loads and shows a count in the hundreds.
2. Searching narrows the list.
3. Filters by muscle and equipment work.
4. A new custom exercise can be created and appears in the list.
5. **Enable Airplane Mode and relaunch the app from the home screen.** The library still loads. This proves the service worker and IndexedDB are doing their job — the single most important property of the whole app.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: create, edit, and archive custom exercises

Custom exercises use the same shape as bundled ones, so nothing in the
app treats them as second-class. Archiving is offered instead of
deletion, since deleting would orphan logged sets."
```

---

## Done when

- [ ] `npm test` passes with no failures.
- [ ] `npm run build` completes with no type errors.
- [ ] The GitHub Actions deploy workflow is green and `https://hshadic.github.io/workout-tracker/` returns 200.
- [ ] The app is installed on the iPhone home screen from that URL and opens without browser chrome.
- [ ] The library loads offline in Airplane Mode.
- [ ] A custom exercise survives closing and reopening the app.
- [x] `docs/superpowers/spikes/2026-08-04-rest-alert-reach.md` records a decision, ready for Plan 3. **Done 2026-08-04.**

## Not in this plan

Routines, cycles, the Today screen, session logging, the rest timer, history, PR detection, charts, backup export/import, and the Playwright round-trip test. These are Plans 2–4.

Also deferred: the **units setting UI**. The `Settings` entity and its `unitPreference` field are created here (Task 5), but nothing in this plan displays a weight, so a settings screen would have nothing to affect. It lands in Plan 3 alongside set logging, which is the first thing that reads it.
