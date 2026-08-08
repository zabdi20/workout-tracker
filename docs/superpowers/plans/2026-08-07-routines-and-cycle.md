# Routines & Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build named routines from the exercise library, order them into a rotation, and see what workout is next.

**Architecture:** Three screens behind a router (Today, Routines, Library), sharing the existing Dexie layer. Ordering and rotation logic lives in pure, I/O-free modules under `src/domain/`; `src/db/` stays thin read/write. The exercise browsing UI built in Plan 1 is extracted into a reusable component so the routine editor can pick exercises without duplicating search and filters.

**Tech Stack:** React 19 · TypeScript · Vite 8 · Dexie 4 · react-router-dom · Vitest 4 · @testing-library/react · fake-indexeddb

**Source spec:** `docs/superpowers/specs/2026-08-04-workout-tracker-design.md`

**Scope:** This is Plan 2 of 4. It ends with an app where you can build routines, order them into a cycle, and see what is next. **Session logging is Plan 3** — nothing in this plan records a performed workout.

## What already exists (Plan 1, complete)

Do not rebuild any of this. It is on `main`, 93 tests passing.

| Module | Exports you will use |
| --- | --- |
| `src/db/db.ts` | `db` (Dexie instance, tables `exercises` `routines` `cycles` `sessions` `sets` `bodyweight` `goals` `settings`), `SETTINGS_ID`, `resetDbForTests()` |
| `src/db/types.ts` | `Exercise` `RoutineItem` `Routine` `Cycle` `Session` `LoggedSet` `Settings` `MuscleGroup` `Equipment` `MeasurementType` `WeightUnit` |
| `src/db/exercises.ts` | `listExercises({includeArchived?})` `getExercise(id)` `createCustomExercise(input)` `updateExercise(id, changes)` `archiveExercise(id)` `unarchiveExercise(id)` |
| `src/db/seed.ts` | `seedExercisesIfEmpty()` — seeds 587 bundled exercises |
| `src/domain/exerciseFilter.ts` | `ExerciseFilter` `EMPTY_FILTER` `filterExercises` `isFilterActive` `availableMuscles` `availableEquipment` |
| `src/domain/labels.ts` | `MUSCLE_GROUPS` `EQUIPMENT_TYPES` `muscleLabel(m)` `equipmentLabel(e)` |
| `src/ui/library/` | `LibraryScreen` `ExerciseList` `FilterSheet` `CustomExerciseForm` |

`src/test-setup.ts` already registers `fake-indexeddb` globally and polyfills `crypto.randomUUID`. Database tests need no per-file setup beyond `await resetDbForTests()`.

## Global Constraints

- **Target platform:** iOS Safari 16.4+, installed via Add to Home Screen. Desktop browsers are for development only.
- **No backend.** No network requests at runtime. Everything works offline after first load.
- **Timestamps** are epoch milliseconds (`number`), always UTC.
- **IDs for user-created entities** — routines, routine items, cycles — use `crypto.randomUUID()`. **Bundled exercise ids are upstream `free-exercise-db` slugs and must never be regenerated**; `LoggedSet.exerciseId` references them.
- **Never hard-delete** a routine. Archive via `isArchived`. Routine *items* may be removed outright — nothing references them.
- **Never `.where()` on a boolean or nullable field.** The Dexie schema deliberately does not index `isCustom`, `isArchived`, `isActive`, or `Session.routineId`, because IndexedDB cannot key booleans or `null` and `.where()` on them throws at runtime. Load with `toArray()` and filter in memory. A regression test in `src/db/db.test.ts` pins this.
- **`src/domain/` is pure and I/O-free.** Type-only imports from `src/db/types` are fine; importing `src/db/db` or any runtime database module is not.
- **Hosting** is GitHub Pages at the subpath `/workout-tracker/`. The router must derive its basename from `import.meta.env.BASE_URL` rather than hardcoding it.
- Tests colocated as `*.test.ts` / `*.test.tsx`.
- **TDD is required.** Write the failing test, run it and watch it fail, implement, run it and watch it pass, commit.
- **Testing balance:** pure logic in `src/domain/` gets thorough unit tests. Screens get smoke tests only — enough to prove wiring, not exhaustive component coverage.
- **Shell:** Git Bash, not PowerShell. PowerShell's Restricted execution policy blocks the `npm.ps1`/`npx.ps1` shims. If `node` is missing from PATH: `export PATH="/c/Program Files/nodejs:$PATH"`.
- **Commit after every task.** Do not batch commits across tasks.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/domain/routineItems.ts` | **Pure.** Add, remove, reorder and renumber `RoutineItem[]`. |
| `src/domain/cycle.ts` | **Pure.** Which routine is next; how the rotation advances. |
| `src/db/routines.ts` | Routine read/write. The only file the UI uses to reach routine data. |
| `src/db/cycles.ts` | Cycle read/write, plus removing a routine from every cycle. |
| `src/ui/AppLayout.tsx` | Router outlet, bottom tab navigation, one-time seeding. |
| `src/ui/library/ExerciseBrowser.tsx` | Search + filters + list, extracted from `LibraryScreen` so two callers can share it. |
| `src/ui/routines/RoutinesScreen.tsx` | List routines; create and archive. |
| `src/ui/routines/RoutineEditor.tsx` | Rename a routine; add, remove and reorder its exercises. |
| `src/ui/cycle/CycleEditor.tsx` | Order routines into the rotation. |
| `src/ui/today/TodayScreen.tsx` | What is next, its exercises, and skip. |

`src/ui/library/LibraryScreen.tsx` shrinks to a thin wrapper around `ExerciseBrowser` in Task 6.

---

## Task 1: Router and app shell

**Files:**
- Modify: `src/App.tsx`, `src/App.test.tsx`
- Create: `src/ui/AppLayout.tsx`, `src/ui/AppLayout.test.tsx`

**Interfaces:**
- Consumes: `seedExercisesIfEmpty()` from `src/db/seed.ts`; `LibraryScreen` from `src/ui/library/LibraryScreen.tsx`.
- Produces: `AppLayout` component rendering an `<Outlet />` plus bottom navigation. `App` mounts a `BrowserRouter` with `basename={import.meta.env.BASE_URL}` and routes `/` (Today placeholder), `/routines`, `/library`.

Today, Routines and Cycle screens arrive in later tasks. This task establishes navigation with placeholder route elements so each later screen has somewhere to mount.

- [ ] **Step 1: Install the router**

```bash
npm install react-router-dom
```

Expected: installs with no `ERR!` lines.

- [ ] **Step 2: Write the failing test**

Create `src/ui/AppLayout.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../db/db';
import { AppLayout } from './AppLayout';

beforeEach(async () => {
  await resetDbForTests();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<p>today here</p>} />
          <Route path="/routines" element={<p>routines here</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

it('renders the routed child', async () => {
  renderAt('/routines');
  expect(await screen.findByText('routines here')).toBeInTheDocument();
});

it('offers navigation to each section', async () => {
  renderAt('/');
  expect(await screen.findByRole('link', { name: 'Today' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Routines' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
});

it('marks the current section as current', async () => {
  renderAt('/routines');
  const current = await screen.findByRole('link', { name: 'Routines' });
  expect(current).toHaveAttribute('aria-current', 'page');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/ui/AppLayout.test.tsx`
Expected: FAIL — `Failed to resolve import "./AppLayout"`.

- [ ] **Step 4: Implement the layout**

Create `src/ui/AppLayout.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { seedExercisesIfEmpty } from '../db/seed';

const TABS = [
  { to: '/', label: 'Today', end: true },
  { to: '/routines', label: 'Routines', end: false },
  { to: '/library', label: 'Library', end: false },
];

export function AppLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    seedExercisesIfEmpty()
      .then(() => { if (!cancelled) setReady(true); })
      .catch((e: unknown) => {
        // Failing loudly matters here: a silent failure would leave the app
        // looking functional while writing to nothing.
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="app">
      <header>
        <h1>Workout Tracker</h1>
      </header>

      <main>
        {error && (
          <p role="alert">
            Could not open the database: {error}. Training data cannot be saved.
          </p>
        )}
        {!error && !ready && <p>Preparing your exercise library…</p>}
        {ready && <Outlet />}
      </main>

      <nav aria-label="Sections">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
```

`NavLink` sets `aria-current="page"` on the active link automatically, which is what the third test asserts.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/ui/AppLayout.test.tsx`
Expected: PASS — 3 tests passed.

- [ ] **Step 6: Rewrite App to mount the router**

Replace `src/App.tsx`:

```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from './ui/AppLayout';
import { LibraryScreen } from './ui/library/LibraryScreen';

export function App() {
  return (
    // basename comes from Vite's configured base so it stays in sync with
    // the GitHub Pages subpath rather than being hardcoded in two places.
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<p>Today lands in a later task.</p>} />
          <Route path="/routines" element={<p>Routines land in a later task.</p>} />
          <Route path="/library" element={<LibraryScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

Replace `src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { db, resetDbForTests } from './db/db';
import { App } from './App';

beforeEach(async () => {
  await resetDbForTests();
});

it('renders the app title', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /workout tracker/i })).toBeInTheDocument();
});

it('seeds the library on first run', async () => {
  render(<App />);
  // Wait for seeding to finish before asserting, so the assertion is not
  // racing an in-flight promise.
  await screen.findByRole('navigation', { name: 'Sections' });
  await screen.findByRole('link', { name: 'Library' });
  await expect.poll(() => db.exercises.count()).toBeGreaterThan(100);
});
```

- [ ] **Step 7: Run the full suite and build**

Run: `npm test`
Expected: PASS — all tests pass, including the Plan 1 suite.

Run: `npm run build`
Expected: type-check and build succeed.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add router and app shell with section navigation

Moves seeding into AppLayout so it runs once for every route rather than
per screen. The router basename derives from Vite's configured base so
the GitHub Pages subpath is not hardcoded twice."
```

---

## Task 2: Routine data access

**Files:**
- Create: `src/db/routines.ts`, `src/db/routines.test.ts`

**Interfaces:**
- Consumes: `db` from `src/db/db.ts`; `Routine`, `RoutineItem` from `src/db/types.ts`.
- Produces:
  - `listRoutines(opts?: { includeArchived?: boolean }): Promise<Routine[]>` — sorted by `name`
  - `getRoutine(id: string): Promise<Routine | undefined>`
  - `createRoutine(name: string): Promise<Routine>`
  - `renameRoutine(id: string, name: string): Promise<void>`
  - `setRoutineItems(id: string, items: RoutineItem[]): Promise<void>`
  - `archiveRoutine(id: string): Promise<void>`
  - `unarchiveRoutine(id: string): Promise<void>`

`archiveRoutine` gains a cross-entity responsibility in Task 4, once cycles exist. Here it only sets the flag.

- [ ] **Step 1: Write the failing test**

Create `src/db/routines.test.ts`:

```ts
import { db, resetDbForTests } from './db';
import {
  listRoutines, getRoutine, createRoutine, renameRoutine,
  setRoutineItems, archiveRoutine, unarchiveRoutine,
} from './routines';
import type { RoutineItem } from './types';

beforeEach(async () => {
  await resetDbForTests();
});

describe('createRoutine', () => {
  it('creates an empty, unarchived routine with timestamps', async () => {
    const before = Date.now();
    const r = await createRoutine('Push Day');

    expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(r.name).toBe('Push Day');
    expect(r.items).toEqual([]);
    expect(r.isArchived).toBe(false);
    expect(r.createdAt).toBeGreaterThanOrEqual(before);
    expect(r.updatedAt).toBe(r.createdAt);
    await expect(getRoutine(r.id)).resolves.toEqual(r);
  });

  it('trims the name', async () => {
    const r = await createRoutine('  Pull Day  ');
    expect(r.name).toBe('Pull Day');
  });

  it('rejects a blank name', async () => {
    await expect(createRoutine('   ')).rejects.toThrow(/name/i);
  });
});

describe('listRoutines', () => {
  it('excludes archived routines by default and sorts by name', async () => {
    const z = await createRoutine('Zercher Day');
    await createRoutine('Arm Day');
    await archiveRoutine(z.id);

    expect((await listRoutines()).map((r) => r.name)).toEqual(['Arm Day']);
  });

  it('includes archived routines when asked', async () => {
    const z = await createRoutine('Zercher Day');
    await archiveRoutine(z.id);
    expect((await listRoutines({ includeArchived: true })).map((r) => r.name))
      .toEqual(['Zercher Day']);
  });
});

describe('renameRoutine', () => {
  it('renames and bumps updatedAt', async () => {
    const r = await createRoutine('Push Day');
    await renameRoutine(r.id, '  Heavy Push  ');

    const updated = await getRoutine(r.id);
    expect(updated?.name).toBe('Heavy Push');
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(r.updatedAt);
    expect(updated?.createdAt).toBe(r.createdAt);
  });

  it('rejects a blank name without writing', async () => {
    const r = await createRoutine('Push Day');
    await expect(renameRoutine(r.id, '  ')).rejects.toThrow(/name/i);
    expect((await getRoutine(r.id))?.name).toBe('Push Day');
  });
});

describe('setRoutineItems', () => {
  it('replaces the item list and bumps updatedAt', async () => {
    const r = await createRoutine('Push Day');
    const items: RoutineItem[] = [
      { id: 'i1', exerciseId: 'Barbell_Bench_Press', order: 0 },
      { id: 'i2', exerciseId: 'Triceps_Pushdown', order: 1 },
    ];

    await setRoutineItems(r.id, items);

    const updated = await getRoutine(r.id);
    expect(updated?.items).toEqual(items);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(r.updatedAt);
  });
});

describe('archiving', () => {
  it('never removes the row', async () => {
    const r = await createRoutine('Push Day');
    await archiveRoutine(r.id);

    expect(await db.routines.count()).toBe(1);
    expect((await getRoutine(r.id))?.isArchived).toBe(true);
  });

  it('can be undone', async () => {
    const r = await createRoutine('Push Day');
    await archiveRoutine(r.id);
    await unarchiveRoutine(r.id);
    expect((await getRoutine(r.id))?.isArchived).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/db/routines.test.ts`
Expected: FAIL — `Failed to resolve import "./routines"`.

- [ ] **Step 3: Implement**

Create `src/db/routines.ts`:

```ts
import { db } from './db';
import type { Routine, RoutineItem } from './types';

export async function listRoutines(
  opts: { includeArchived?: boolean } = {},
): Promise<Routine[]> {
  // toArray + in-memory filter, never .where('isArchived') — IndexedDB
  // cannot key booleans, so the schema deliberately leaves it unindexed.
  const all = await db.routines.toArray();
  const visible = opts.includeArchived ? all : all.filter((r) => !r.isArchived);
  return visible.sort((a, b) => a.name.localeCompare(b.name));
}

export function getRoutine(id: string): Promise<Routine | undefined> {
  return db.routines.get(id);
}

export async function createRoutine(name: string): Promise<Routine> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Routine name is required');

  const now = Date.now();
  const routine: Routine = {
    id: crypto.randomUUID(),
    name: trimmed,
    items: [],
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.routines.add(routine);
  return routine;
}

export async function renameRoutine(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Routine name is required');
  await db.routines.update(id, { name: trimmed, updatedAt: Date.now() });
}

export async function setRoutineItems(
  id: string,
  items: RoutineItem[],
): Promise<void> {
  await db.routines.update(id, { items, updatedAt: Date.now() });
}

/**
 * Archives rather than deletes. A hard delete would orphan every Session
 * whose routineId points here.
 */
export async function archiveRoutine(id: string): Promise<void> {
  await db.routines.update(id, { isArchived: true, updatedAt: Date.now() });
}

export async function unarchiveRoutine(id: string): Promise<void> {
  await db.routines.update(id, { isArchived: false, updatedAt: Date.now() });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/db/routines.test.ts`
Expected: PASS — 10 tests passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add routine data access

Archives rather than deletes, since a hard delete would orphan every
session referencing the routine. Item lists are replaced wholesale;
ordering logic lives in the pure domain layer."
```

---

## Task 3: Routine item ordering (pure)

**Files:**
- Create: `src/domain/routineItems.ts`, `src/domain/routineItems.test.ts`

**Interfaces:**
- Consumes: `RoutineItem` from `src/db/types.ts` — **type-only import**.
- Produces:
  - `addItem(items: RoutineItem[], exerciseId: string, id: string): RoutineItem[]`
  - `removeItem(items: RoutineItem[], itemId: string): RoutineItem[]`
  - `moveItem(items: RoutineItem[], itemId: string, direction: 'up' | 'down'): RoutineItem[]`

All three return new arrays with `order` renumbered contiguously from 0. None mutate their input. The `id` for a new item is passed in rather than generated, so these stay pure and deterministic under test.

- [ ] **Step 1: Write the failing test**

Create `src/domain/routineItems.test.ts`:

```ts
import { addItem, removeItem, moveItem } from './routineItems';
import type { RoutineItem } from '../db/types';

function items(...exerciseIds: string[]): RoutineItem[] {
  return exerciseIds.map((exerciseId, i) => ({
    id: `item-${i}`,
    exerciseId,
    order: i,
  }));
}

describe('addItem', () => {
  it('appends with the next order', () => {
    const result = addItem(items('bench', 'fly'), 'dip', 'new-id');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'fly', 'dip']);
    expect(result.map((i) => i.order)).toEqual([0, 1, 2]);
    expect(result[2].id).toBe('new-id');
  });

  it('appends to an empty list', () => {
    const result = addItem([], 'bench', 'new-id');
    expect(result).toEqual([{ id: 'new-id', exerciseId: 'bench', order: 0 }]);
  });

  it('allows the same exercise twice', () => {
    const result = addItem(items('bench'), 'bench', 'new-id');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'bench']);
  });

  it('does not mutate the input', () => {
    const original = items('bench');
    addItem(original, 'fly', 'new-id');
    expect(original).toHaveLength(1);
  });
});

describe('removeItem', () => {
  it('removes and renumbers', () => {
    const result = removeItem(items('bench', 'fly', 'dip'), 'item-1');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'dip']);
    expect(result.map((i) => i.order)).toEqual([0, 1]);
  });

  it('is a no-op for an unknown id', () => {
    const result = removeItem(items('bench', 'fly'), 'nope');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'fly']);
  });

  it('does not mutate the input', () => {
    const original = items('bench', 'fly');
    removeItem(original, 'item-0');
    expect(original).toHaveLength(2);
  });
});

describe('moveItem', () => {
  it('moves an item up', () => {
    const result = moveItem(items('bench', 'fly', 'dip'), 'item-1', 'up');
    expect(result.map((i) => i.exerciseId)).toEqual(['fly', 'bench', 'dip']);
    expect(result.map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it('moves an item down', () => {
    const result = moveItem(items('bench', 'fly', 'dip'), 'item-1', 'down');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'dip', 'fly']);
  });

  it('leaves the first item alone when moved up', () => {
    const result = moveItem(items('bench', 'fly'), 'item-0', 'up');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'fly']);
  });

  it('leaves the last item alone when moved down', () => {
    const result = moveItem(items('bench', 'fly'), 'item-1', 'down');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'fly']);
  });

  it('is a no-op for an unknown id', () => {
    const result = moveItem(items('bench', 'fly'), 'nope', 'up');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'fly']);
  });

  it('preserves other item fields', () => {
    const withRest: RoutineItem[] = [
      { id: 'a', exerciseId: 'bench', order: 0, restSeconds: 90 },
      { id: 'b', exerciseId: 'fly', order: 1 },
    ];
    const result = moveItem(withRest, 'b', 'up');
    expect(result[1]).toEqual({ id: 'a', exerciseId: 'bench', order: 1, restSeconds: 90 });
  });

  it('does not mutate the input', () => {
    const original = items('bench', 'fly');
    moveItem(original, 'item-0', 'down');
    expect(original.map((i) => i.exerciseId)).toEqual(['bench', 'fly']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/routineItems.test.ts`
Expected: FAIL — `Failed to resolve import "./routineItems"`.

- [ ] **Step 3: Implement**

Create `src/domain/routineItems.ts`:

```ts
import type { RoutineItem } from '../db/types';

/** Renumbers `order` contiguously from 0, preserving array order. */
function renumber(items: RoutineItem[]): RoutineItem[] {
  return items.map((item, index) => ({ ...item, order: index }));
}

export function addItem(
  items: RoutineItem[],
  exerciseId: string,
  id: string,
): RoutineItem[] {
  return renumber([...items, { id, exerciseId, order: items.length }]);
}

export function removeItem(items: RoutineItem[], itemId: string): RoutineItem[] {
  return renumber(items.filter((item) => item.id !== itemId));
}

export function moveItem(
  items: RoutineItem[],
  itemId: string,
  direction: 'up' | 'down',
): RoutineItem[] {
  const index = items.findIndex((item) => item.id === itemId);
  if (index === -1) return renumber(items);

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) return renumber(items);

  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return renumber(next);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/routineItems.test.ts`
Expected: PASS — 14 tests passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add pure routine item ordering

Order is renumbered contiguously on every operation so the stored order
never develops gaps. New item ids are passed in rather than generated,
keeping these functions deterministic under test."
```

---

## Task 4: Cycle rotation (pure) and cycle data access

**Files:**
- Create: `src/domain/cycle.ts`, `src/domain/cycle.test.ts`
- Create: `src/db/cycles.ts`, `src/db/cycles.test.ts`
- Modify: `src/db/routines.ts`, `src/db/routines.test.ts`

**Interfaces:**
- Consumes: `Cycle` from `src/db/types.ts`; `db` from `src/db/db.ts`.
- Produces from `src/domain/cycle.ts` (**pure**):
  - `nextRoutineId(cycle: Cycle): string | null`
  - `advanceAfter(cycle: Cycle, routineId: string): Cycle`
  - `skipNext(cycle: Cycle): Cycle`
  - `withoutRoutine(cycle: Cycle, routineId: string): Cycle`
- Produces from `src/db/cycles.ts`:
  - `getOrCreateActiveCycle(): Promise<Cycle>`
  - `saveCycle(cycle: Cycle): Promise<void>`
  - `removeRoutineFromAllCycles(routineId: string): Promise<void>`

`advanceAfter` implements the spec's rule: completing a session from routine `R` sets `currentIndex = position(R) + 1`, wrapping. Doing a routine out of order re-anchors the cycle there rather than leaving it permanently out of sync. Plan 3 calls it on session completion; this plan only calls `skipNext`.

- [ ] **Step 1: Write the failing test for the pure module**

Create `src/domain/cycle.test.ts`:

```ts
import { nextRoutineId, advanceAfter, skipNext, withoutRoutine } from './cycle';
import type { Cycle } from '../db/types';

function cycle(routineIds: string[], currentIndex = 0): Cycle {
  return { id: 'c1', name: 'Current split', routineIds, currentIndex, isActive: true };
}

describe('nextRoutineId', () => {
  it('returns the routine at the current index', () => {
    expect(nextRoutineId(cycle(['push', 'pull', 'legs'], 1))).toBe('pull');
  });

  it('returns null for an empty cycle', () => {
    expect(nextRoutineId(cycle([]))).toBeNull();
  });

  it('wraps an out-of-range index rather than returning undefined', () => {
    expect(nextRoutineId(cycle(['push', 'pull'], 5))).toBe('push');
  });

  it('wraps a negative index', () => {
    expect(nextRoutineId(cycle(['push', 'pull'], -1))).toBe('pull');
  });
});

describe('advanceAfter', () => {
  it('moves to the position after the completed routine', () => {
    expect(advanceAfter(cycle(['push', 'pull', 'legs'], 0), 'push').currentIndex).toBe(1);
  });

  it('wraps past the end', () => {
    expect(advanceAfter(cycle(['push', 'pull'], 1), 'pull').currentIndex).toBe(0);
  });

  it('re-anchors when a routine is done out of order', () => {
    // Cycle expects push, but legs was done. Next should be whatever
    // follows legs, not whatever follows push.
    expect(advanceAfter(cycle(['push', 'pull', 'legs'], 0), 'legs').currentIndex).toBe(0);
  });

  it('leaves the cycle unchanged for a routine not in it', () => {
    const before = cycle(['push', 'pull'], 1);
    expect(advanceAfter(before, 'yoga')).toEqual(before);
  });

  it('leaves an empty cycle unchanged', () => {
    const before = cycle([]);
    expect(advanceAfter(before, 'push')).toEqual(before);
  });

  it('does not mutate the input', () => {
    const before = cycle(['push', 'pull'], 0);
    advanceAfter(before, 'push');
    expect(before.currentIndex).toBe(0);
  });
});

describe('skipNext', () => {
  it('advances one position', () => {
    expect(skipNext(cycle(['push', 'pull', 'legs'], 0)).currentIndex).toBe(1);
  });

  it('wraps past the end', () => {
    expect(skipNext(cycle(['push', 'pull'], 1)).currentIndex).toBe(0);
  });

  it('leaves an empty cycle unchanged', () => {
    const before = cycle([]);
    expect(skipNext(before)).toEqual(before);
  });

  it('does not mutate the input', () => {
    const before = cycle(['push', 'pull'], 0);
    skipNext(before);
    expect(before.currentIndex).toBe(0);
  });
});

describe('withoutRoutine', () => {
  it('removes every occurrence', () => {
    expect(withoutRoutine(cycle(['push', 'pull', 'push'], 0), 'push').routineIds)
      .toEqual(['pull']);
  });

  it('clamps currentIndex when it would fall off the end', () => {
    const result = withoutRoutine(cycle(['push', 'pull'], 1), 'pull');
    expect(result.routineIds).toEqual(['push']);
    expect(result.currentIndex).toBe(0);
  });

  it('resets currentIndex to 0 when the cycle empties', () => {
    const result = withoutRoutine(cycle(['push'], 0), 'push');
    expect(result.routineIds).toEqual([]);
    expect(result.currentIndex).toBe(0);
  });

  it('does not mutate the input', () => {
    const before = cycle(['push', 'pull'], 0);
    withoutRoutine(before, 'push');
    expect(before.routineIds).toEqual(['push', 'pull']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/cycle.test.ts`
Expected: FAIL — `Failed to resolve import "./cycle"`.

- [ ] **Step 3: Implement the pure module**

Create `src/domain/cycle.ts`:

```ts
import type { Cycle } from '../db/types';

/** Positive modulo, so a negative or oversized index still lands in range. */
function wrap(index: number, length: number): number {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}

export function nextRoutineId(cycle: Cycle): string | null {
  if (cycle.routineIds.length === 0) return null;
  return cycle.routineIds[wrap(cycle.currentIndex, cycle.routineIds.length)];
}

/**
 * The spec's advancement rule: completing routine R sets currentIndex to
 * position(R) + 1. Doing a routine out of order re-anchors the cycle there
 * rather than leaving it permanently out of sync with what was trained.
 */
export function advanceAfter(cycle: Cycle, routineId: string): Cycle {
  const position = cycle.routineIds.indexOf(routineId);
  if (position === -1) return cycle;
  return { ...cycle, currentIndex: wrap(position + 1, cycle.routineIds.length) };
}

export function skipNext(cycle: Cycle): Cycle {
  if (cycle.routineIds.length === 0) return cycle;
  return { ...cycle, currentIndex: wrap(cycle.currentIndex + 1, cycle.routineIds.length) };
}

export function withoutRoutine(cycle: Cycle, routineId: string): Cycle {
  const routineIds = cycle.routineIds.filter((id) => id !== routineId);
  return {
    ...cycle,
    routineIds,
    currentIndex: routineIds.length === 0 ? 0 : wrap(cycle.currentIndex, routineIds.length),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/cycle.test.ts`
Expected: PASS — 17 tests passed.

- [ ] **Step 5: Write the failing test for cycle data access**

Create `src/db/cycles.test.ts`:

```ts
import { db, resetDbForTests } from './db';
import { getOrCreateActiveCycle, saveCycle, removeRoutineFromAllCycles } from './cycles';

beforeEach(async () => {
  await resetDbForTests();
});

describe('getOrCreateActiveCycle', () => {
  it('creates an empty active cycle on first call', async () => {
    const c = await getOrCreateActiveCycle();
    expect(c.routineIds).toEqual([]);
    expect(c.currentIndex).toBe(0);
    expect(c.isActive).toBe(true);
    expect(await db.cycles.count()).toBe(1);
  });

  it('returns the existing cycle on later calls', async () => {
    const first = await getOrCreateActiveCycle();
    const second = await getOrCreateActiveCycle();
    expect(second.id).toBe(first.id);
    expect(await db.cycles.count()).toBe(1);
  });

  it('creates exactly one cycle when called concurrently', async () => {
    // React StrictMode double-invokes effects in development, so two calls
    // can both observe an empty table before either writes.
    await Promise.all([getOrCreateActiveCycle(), getOrCreateActiveCycle()]);
    expect(await db.cycles.count()).toBe(1);
  });
});

describe('saveCycle', () => {
  it('persists changes', async () => {
    const c = await getOrCreateActiveCycle();
    await saveCycle({ ...c, routineIds: ['push', 'pull'], currentIndex: 1 });

    const reloaded = await getOrCreateActiveCycle();
    expect(reloaded.routineIds).toEqual(['push', 'pull']);
    expect(reloaded.currentIndex).toBe(1);
  });
});

describe('removeRoutineFromAllCycles', () => {
  it('removes the routine and clamps the index', async () => {
    const c = await getOrCreateActiveCycle();
    await saveCycle({ ...c, routineIds: ['push', 'pull'], currentIndex: 1 });

    await removeRoutineFromAllCycles('pull');

    const reloaded = await getOrCreateActiveCycle();
    expect(reloaded.routineIds).toEqual(['push']);
    expect(reloaded.currentIndex).toBe(0);
  });

  it('is a no-op when the routine is in no cycle', async () => {
    const c = await getOrCreateActiveCycle();
    await saveCycle({ ...c, routineIds: ['push'], currentIndex: 0 });

    await removeRoutineFromAllCycles('yoga');

    expect((await getOrCreateActiveCycle()).routineIds).toEqual(['push']);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/db/cycles.test.ts`
Expected: FAIL — `Failed to resolve import "./cycles"`.

- [ ] **Step 7: Implement cycle data access**

Create `src/db/cycles.ts`:

```ts
import { db } from './db';
import { withoutRoutine } from '../domain/cycle';
import type { Cycle } from './types';

/**
 * Returns the active cycle, creating an empty one on first use.
 *
 * The check and the insert run in one transaction. React StrictMode
 * double-invokes effects in development, so without it two calls can both
 * observe an empty table and create a second cycle.
 */
export async function getOrCreateActiveCycle(): Promise<Cycle> {
  return db.transaction('rw', db.cycles, async () => {
    // toArray + in-memory find, never .where('isActive') — IndexedDB cannot
    // key booleans, so the schema deliberately leaves it unindexed.
    const all = await db.cycles.toArray();
    const active = all.find((c) => c.isActive);
    if (active) return active;

    const cycle: Cycle = {
      id: crypto.randomUUID(),
      name: 'Current split',
      routineIds: [],
      currentIndex: 0,
      isActive: true,
    };
    await db.cycles.add(cycle);
    return cycle;
  });
}

export async function saveCycle(cycle: Cycle): Promise<void> {
  await db.cycles.put(cycle);
}

/**
 * Keeps cycles referentially clean when a routine is archived. Without this
 * an archived routine would keep coming up as "next" with no way to train it.
 */
export async function removeRoutineFromAllCycles(routineId: string): Promise<void> {
  await db.transaction('rw', db.cycles, async () => {
    const all = await db.cycles.toArray();
    for (const cycle of all) {
      if (!cycle.routineIds.includes(routineId)) continue;
      await db.cycles.put(withoutRoutine(cycle, routineId));
    }
  });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/db/cycles.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 9: Make archiving a routine remove it from cycles**

Append to `src/db/routines.test.ts`:

```ts
Also add this import at the top of `src/db/routines.test.ts`, beside the existing ones:

```ts
import { getOrCreateActiveCycle, saveCycle } from './cycles';
```

```ts
describe('archiveRoutine and cycles', () => {
  it('removes the routine from every cycle', async () => {
    const r = await createRoutine('Push Day');
    const c = await getOrCreateActiveCycle();
    await saveCycle({ ...c, routineIds: [r.id], currentIndex: 0 });

    await archiveRoutine(r.id);

    expect((await getOrCreateActiveCycle()).routineIds).toEqual([]);
  });

  it('does not re-add the routine when unarchived', async () => {
    const r = await createRoutine('Push Day');
    const c = await getOrCreateActiveCycle();
    await saveCycle({ ...c, routineIds: [r.id], currentIndex: 0 });

    await archiveRoutine(r.id);
    await unarchiveRoutine(r.id);

    // Restoring a routine does not silently rebuild the user's rotation;
    // they put it back where they want it.
    expect((await getOrCreateActiveCycle()).routineIds).toEqual([]);
  });
});
```

Run: `npx vitest run src/db/routines.test.ts`
Expected: FAIL — the first new test fails because `archiveRoutine` currently only sets the flag, so `routineIds` is still `[r.id]`.

- [ ] **Step 10: Implement the cross-entity archive**

In `src/db/routines.ts`, add the import at the top:

```ts
import { removeRoutineFromAllCycles } from './cycles';
```

and replace `archiveRoutine`:

```ts
/**
 * Archives rather than deletes. A hard delete would orphan every Session
 * whose routineId points here.
 *
 * Also drops the routine from every cycle: an archived routine left in a
 * rotation would keep coming up as "next" with no way to train it.
 * Unarchiving deliberately does NOT restore it — the user puts it back
 * where they want it.
 */
export async function archiveRoutine(id: string): Promise<void> {
  await db.routines.update(id, { isArchived: true, updatedAt: Date.now() });
  await removeRoutineFromAllCycles(id);
}
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npx vitest run src/db/routines.test.ts src/db/cycles.test.ts`
Expected: PASS — 12 routine tests and 6 cycle tests.

Then run the full suite and build:

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat: add cycle rotation logic and cycle data access

Implements the spec's advancement rule: completing routine R re-anchors
the cycle to position(R)+1, so training out of order does not leave the
rotation permanently out of sync.

Archiving a routine now removes it from every cycle. Left in place it
would keep coming up as next with no way to train it. Unarchiving does
not restore it, since silently rebuilding the rotation would surprise."
```

---

## Task 5: Routines list screen

**Files:**
- Create: `src/ui/routines/RoutinesScreen.tsx`, `src/ui/routines/RoutinesScreen.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `listRoutines`, `createRoutine`, `archiveRoutine` from `src/db/routines.ts`; `useLiveQuery` from `dexie-react-hooks`; `Link` from `react-router-dom`.
- Produces: `RoutinesScreen` component, mounted at `/routines`. Each routine links to `/routines/:id`, the editor route added in Task 7.

- [ ] **Step 1: Write the failing test**

Create `src/ui/routines/RoutinesScreen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { createRoutine, listRoutines, setRoutineItems } from '../../db/routines';
import { RoutinesScreen } from './RoutinesScreen';

beforeEach(async () => {
  await resetDbForTests();
});

function renderScreen() {
  return render(
    <MemoryRouter>
      <RoutinesScreen />
    </MemoryRouter>,
  );
}

it('lists routines and links each to its editor', async () => {
  const r = await createRoutine('Push Day');
  renderScreen();

  const link = await screen.findByRole('link', { name: /push day/i });
  expect(link).toHaveAttribute('href', `/routines/${r.id}`);
});

it('tells the user when there are no routines yet', async () => {
  renderScreen();
  expect(await screen.findByText(/no routines yet/i)).toBeInTheDocument();
});

it('creates a routine', async () => {
  const user = userEvent.setup();
  renderScreen();
  await screen.findByText(/no routines yet/i);

  await user.type(screen.getByLabelText(/new routine name/i), 'Pull Day');
  await user.click(screen.getByRole('button', { name: /add routine/i }));

  expect(await screen.findByRole('link', { name: /pull day/i })).toBeInTheDocument();
  expect((await listRoutines()).map((r) => r.name)).toEqual(['Pull Day']);
});

it('refuses to create a routine with a blank name', async () => {
  const user = userEvent.setup();
  renderScreen();
  await screen.findByText(/no routines yet/i);

  await user.click(screen.getByRole('button', { name: /add routine/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/name/i);
  expect(await listRoutines()).toHaveLength(0);
});

it('archives a routine', async () => {
  const user = userEvent.setup();
  await createRoutine('Push Day');
  renderScreen();
  await screen.findByRole('link', { name: /push day/i });

  await user.click(screen.getByRole('button', { name: /archive push day/i }));

  expect(await screen.findByText(/no routines yet/i)).toBeInTheDocument();
  expect(await listRoutines()).toHaveLength(0);
});

it('shows how many exercises each routine holds', async () => {
  const r = await createRoutine('Push Day');
  await setRoutineItems(r.id, [
    { id: 'i1', exerciseId: 'bench', order: 0 },
    { id: 'i2', exerciseId: 'fly', order: 1 },
  ]);

  renderScreen();
  expect(await screen.findByText(/2 exercises/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/routines/RoutinesScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./RoutinesScreen"`.

- [ ] **Step 3: Implement**

Create `src/ui/routines/RoutinesScreen.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { archiveRoutine, createRoutine, listRoutines } from '../../db/routines';

export function RoutinesScreen() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const routines = useLiveQuery(() => listRoutines(), []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createRoutine(name);
      setName('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2>Routines</h2>

      <form onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}
        <label>
          New routine name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit">Add routine</button>
      </form>

      {routines === undefined ? (
        <p>Loading…</p>
      ) : routines.length === 0 ? (
        <p className="empty">No routines yet. Add one above to get started.</p>
      ) : (
        <ul className="routine-list">
          {routines.map((routine) => (
            <li key={routine.id}>
              <Link to={`/routines/${routine.id}`}>
                <span className="routine-name">{routine.name}</span>
                <span className="routine-meta">
                  {routine.items.length} exercise{routine.items.length === 1 ? '' : 's'}
                </span>
              </Link>
              <button
                type="button"
                aria-label={`Archive ${routine.name}`}
                onClick={() => archiveRoutine(routine.id)}
              >
                Archive
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/routines/RoutinesScreen.test.tsx`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Mount the route**

In `src/App.tsx`, add the import:

```tsx
import { RoutinesScreen } from './ui/routines/RoutinesScreen';
```

and replace the routines route:

```tsx
          <Route path="/routines" element={<RoutinesScreen />} />
```

- [ ] **Step 6: Run the full suite and build**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add routines list screen

Lists routines with their exercise counts, creates new ones, and archives
rather than deletes."
```

---

## Task 6: Extract a reusable exercise browser

**Files:**
- Create: `src/ui/library/ExerciseBrowser.tsx`
- Modify: `src/ui/library/LibraryScreen.tsx`
- Test: existing `src/ui/library/LibraryScreen.test.tsx` must keep passing unchanged

**Interfaces:**
- Consumes: `listExercises` from `src/db/exercises.ts`; `EMPTY_FILTER`, `filterExercises`, `isFilterActive`, `availableMuscles`, `availableEquipment`, `ExerciseFilter` from `src/domain/exerciseFilter.ts`; `ExerciseList`, `FilterSheet` from the same directory.
- Produces: `ExerciseBrowser` with props `{ onSelect?: (exercise: Exercise) => void; headerSlot?: ReactNode }`.

This is a **pure refactor**: no behaviour changes, and `LibraryScreen.test.tsx` is not modified. The routine editor in Task 7 needs search and filters over the library; duplicating that UI would be the second copy of logic already written once.

- [ ] **Step 1: Confirm the existing tests pass before touching anything**

Run: `npx vitest run src/ui/library/LibraryScreen.test.tsx`
Expected: PASS. Record the count — it must be identical after the refactor.

- [ ] **Step 2: Create the extracted component**

Create `src/ui/library/ExerciseBrowser.tsx`:

```tsx
import { useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Exercise } from '../../db/types';
import { listExercises } from '../../db/exercises';
import {
  EMPTY_FILTER, availableEquipment, availableMuscles, filterExercises,
  isFilterActive, type ExerciseFilter,
} from '../../domain/exerciseFilter';
import { ExerciseList } from './ExerciseList';
import { FilterSheet } from './FilterSheet';

interface Props {
  onSelect?: (exercise: Exercise) => void;
  /** Extra controls rendered beside Filters — e.g. the library's New exercise button. */
  headerSlot?: ReactNode;
}

export function ExerciseBrowser({ onSelect, headerSlot }: Props) {
  const [filter, setFilter] = useState<ExerciseFilter>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const exercises = useLiveQuery(() => listExercises(), []);

  const visible = useMemo(
    () => filterExercises(exercises ?? [], filter),
    [exercises, filter],
  );
  const muscleFacets = useMemo(() => availableMuscles(exercises ?? []), [exercises]);
  const equipmentFacets = useMemo(() => availableEquipment(exercises ?? []), [exercises]);

  const activeCount = filter.muscles.length + filter.equipment.length;

  return (
    <>
      <input
        type="search"
        aria-label="Search exercises"
        placeholder="Search exercises"
        value={filter.query}
        onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
      />

      <div className="filter-controls">
        <button
          type="button"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((s) => !s)}
        >
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
        {isFilterActive(filter) && (
          <button type="button" onClick={() => setFilter(EMPTY_FILTER)}>
            Clear filters
          </button>
        )}
        {headerSlot}
      </div>

      {showFilters && (
        <FilterSheet
          filter={filter}
          onChange={setFilter}
          availableMuscles={muscleFacets}
          availableEquipment={equipmentFacets}
        />
      )}

      {exercises === undefined ? (
        <p>Loading…</p>
      ) : (
        <>
          <p className="count">
            {visible.length} exercise{visible.length === 1 ? '' : 's'}
          </p>
          <ExerciseList exercises={visible} onSelect={onSelect} />
        </>
      )}
    </>
  );
}
```

- [ ] **Step 3: Reduce LibraryScreen to a wrapper**

Replace `src/ui/library/LibraryScreen.tsx`:

```tsx
import { useState } from 'react';
import type { Exercise } from '../../db/types';
import { CustomExerciseForm } from './CustomExerciseForm';
import { ExerciseBrowser } from './ExerciseBrowser';

export function LibraryScreen() {
  const [editing, setEditing] = useState<Exercise | 'new' | null>(null);

  return (
    <section>
      <h2>Exercises</h2>

      {editing && (
        // The key is load-bearing. The form seeds its fields from `existing`
        // via useState initialisers, which run only on mount. Without a key
        // that changes with the exercise, opening A then clicking B reuses
        // the instance: fields keep A's values while existing.id points at B,
        // and saving overwrites B with A's data.
        <CustomExerciseForm
          key={editing === 'new' ? 'new' : editing.id}
          existing={editing === 'new' ? undefined : editing}
          onDone={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      )}

      <ExerciseBrowser
        onSelect={(e) => e.isCustom && setEditing(e)}
        headerSlot={
          <button type="button" onClick={() => setEditing('new')}>
            New exercise
          </button>
        }
      />
    </section>
  );
}
```

- [ ] **Step 4: Verify the existing tests still pass, unchanged**

Run: `npx vitest run src/ui/library/LibraryScreen.test.tsx`
Expected: PASS with the same test count as Step 1. **Do not modify the test file.** If a test fails, the refactor changed behaviour — fix the component, not the test.

Then run the full suite:

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: extract ExerciseBrowser from LibraryScreen

The routine editor needs the same search and filter UI. Extracting rather
than duplicating keeps one implementation. LibraryScreen's tests are
unchanged and still pass, which is the check that this was behaviour-neutral."
```

---

## Task 7: Routine editor

**Files:**
- Create: `src/ui/routines/RoutineEditor.tsx`, `src/ui/routines/RoutineEditor.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `getRoutine`, `renameRoutine`, `setRoutineItems` from `src/db/routines.ts`; `getExercise` from `src/db/exercises.ts`; `addItem`, `removeItem`, `moveItem` from `src/domain/routineItems.ts`; `ExerciseBrowser` from `src/ui/library/ExerciseBrowser.tsx`; `useParams` from `react-router-dom`.
- Produces: `RoutineEditor` component, mounted at `/routines/:routineId`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/routines/RoutineEditor.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise } from '../../db/exercises';
import { createRoutine, getRoutine, setRoutineItems } from '../../db/routines';
import { RoutineEditor } from './RoutineEditor';

beforeEach(async () => {
  await resetDbForTests();
});

function renderAt(routineId: string) {
  return render(
    <MemoryRouter initialEntries={[`/routines/${routineId}`]}>
      <Routes>
        <Route path="/routines/:routineId" element={<RoutineEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function seedExercise(name: string) {
  return createCustomExercise({
    name,
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType: 'weight_reps',
  });
}

it('shows the routine name', async () => {
  const r = await createRoutine('Push Day');
  renderAt(r.id);
  expect(await screen.findByDisplayValue('Push Day')).toBeInTheDocument();
});

it('reports a missing routine rather than rendering an empty editor', async () => {
  renderAt('does-not-exist');
  expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
});

it('renames the routine', async () => {
  const user = userEvent.setup();
  const r = await createRoutine('Push Day');
  renderAt(r.id);

  const field = await screen.findByLabelText(/routine name/i);
  await user.clear(field);
  await user.type(field, 'Heavy Push');
  await user.click(screen.getByRole('button', { name: /save name/i }));

  await expect.poll(async () => (await getRoutine(r.id))?.name).toBe('Heavy Push');
});

it('adds an exercise from the browser', async () => {
  const user = userEvent.setup();
  const ex = await seedExercise('Barbell Bench Press');
  const r = await createRoutine('Push Day');
  renderAt(r.id);

  await user.click(await screen.findByRole('button', { name: /add exercise/i }));
  await user.click(await screen.findByRole('button', { name: /barbell bench press/i }));

  await expect.poll(async () => (await getRoutine(r.id))?.items.length).toBe(1);
  expect((await getRoutine(r.id))?.items[0].exerciseId).toBe(ex.id);
});

it('lists the routine exercises in order', async () => {
  const a = await seedExercise('Bench Press');
  const b = await seedExercise('Cable Fly');
  const r = await createRoutine('Push Day');
  await setRoutineItems(r.id, [
    { id: 'i1', exerciseId: a.id, order: 0 },
    { id: 'i2', exerciseId: b.id, order: 1 },
  ]);

  renderAt(r.id);

  const listed = await screen.findAllByTestId('routine-item-name');
  expect(listed.map((el) => el.textContent)).toEqual(['Bench Press', 'Cable Fly']);
});

it('moves an exercise up', async () => {
  const user = userEvent.setup();
  const a = await seedExercise('Bench Press');
  const b = await seedExercise('Cable Fly');
  const r = await createRoutine('Push Day');
  await setRoutineItems(r.id, [
    { id: 'i1', exerciseId: a.id, order: 0 },
    { id: 'i2', exerciseId: b.id, order: 1 },
  ]);

  renderAt(r.id);
  await screen.findAllByTestId('routine-item-name');
  await user.click(screen.getByRole('button', { name: /move cable fly up/i }));

  await expect.poll(async () => {
    const items = (await getRoutine(r.id))?.items ?? [];
    return items.map((i) => i.exerciseId);
  }).toEqual([b.id, a.id]);
});

it('removes an exercise', async () => {
  const user = userEvent.setup();
  const a = await seedExercise('Bench Press');
  const r = await createRoutine('Push Day');
  await setRoutineItems(r.id, [{ id: 'i1', exerciseId: a.id, order: 0 }]);

  renderAt(r.id);
  await screen.findAllByTestId('routine-item-name');
  await user.click(screen.getByRole('button', { name: /remove bench press/i }));

  await expect.poll(async () => (await getRoutine(r.id))?.items.length).toBe(0);
});

it('tells the user when the routine has no exercises', async () => {
  const r = await createRoutine('Push Day');
  renderAt(r.id);
  expect(await screen.findByText(/no exercises yet/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/routines/RoutineEditor.test.tsx`
Expected: FAIL — `Failed to resolve import "./RoutineEditor"`.

- [ ] **Step 3: Implement**

Create `src/ui/routines/RoutineEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getRoutine, renameRoutine, setRoutineItems } from '../../db/routines';
import { listExercises } from '../../db/exercises';
import { addItem, moveItem, removeItem } from '../../domain/routineItems';
import { ExerciseBrowser } from '../library/ExerciseBrowser';

export function RoutineEditor() {
  const { routineId } = useParams<{ routineId: string }>();
  const [name, setName] = useState('');
  const [nameLoaded, setNameLoaded] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolves to `undefined` while loading and `null` when the id matches no
  // routine, so "still loading" and "not found" are distinguishable. Without
  // the `?? null`, a missing routine is indistinguishable from a pending
  // query and the screen would sit on "Loading…" forever.
  const routine = useLiveQuery(
    async () => (routineId ? (await getRoutine(routineId)) ?? null : null),
    [routineId],
  );
  const exercises = useLiveQuery(() => listExercises({ includeArchived: true }), []);

  // Seed the name field once, from the first load. Re-seeding on every
  // live-query emission would discard what the user is typing.
  useEffect(() => {
    if (routine && !nameLoaded) {
      setName(routine.name);
      setNameLoaded(true);
    }
  }, [routine, nameLoaded]);

  if (routine === undefined) return <p>Loading…</p>;
  if (routine === null) return <p role="alert">Routine not found.</p>;

  const nameById = new Map((exercises ?? []).map((e) => [e.id, e.name]));

  // Bound after the guards above, so no non-null assertion is needed.
  const { id: currentId, items } = routine;

  async function saveName() {
    setError(null);
    try {
      await renameRoutine(currentId, name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2>Edit routine</h2>

      {error && <p role="alert">{error}</p>}

      <label>
        Routine name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="button" onClick={saveName}>Save name</button>

      <h3>Exercises</h3>
      {items.length === 0 ? (
        <p className="empty">No exercises yet. Add one below.</p>
      ) : (
        <ol className="routine-items">
          {items.map((item) => {
            const label = nameById.get(item.exerciseId) ?? 'Unknown exercise';
            return (
              <li key={item.id}>
                <span data-testid="routine-item-name">{label}</span>
                <button
                  type="button"
                  aria-label={`Move ${label} up`}
                  onClick={() => setRoutineItems(currentId, moveItem(items, item.id, 'up'))}
                >
                  Up
                </button>
                <button
                  type="button"
                  aria-label={`Move ${label} down`}
                  onClick={() => setRoutineItems(currentId, moveItem(items, item.id, 'down'))}
                >
                  Down
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => setRoutineItems(currentId, removeItem(items, item.id))}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <button type="button" onClick={() => setPicking((p) => !p)}>
        {picking ? 'Done adding' : 'Add exercise'}
      </button>

      {picking && (
        <ExerciseBrowser
          onSelect={(exercise) =>
            setRoutineItems(currentId, addItem(items, exercise.id, crypto.randomUUID()))
          }
        />
      )}
    </section>
  );
}
```

`src/db/routines.ts` is not modified by this task. The loading-versus-missing distinction is handled entirely in the live query's `?? null`, so the data layer keeps its plain `Promise<Routine | undefined>` signature.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/routines/RoutineEditor.test.tsx`
Expected: PASS — 8 tests passed.

- [ ] **Step 5: Mount the route**

In `src/App.tsx`, add the import:

```tsx
import { RoutineEditor } from './ui/routines/RoutineEditor';
```

and add the route after the routines route:

```tsx
          <Route path="/routines/:routineId" element={<RoutineEditor />} />
```

- [ ] **Step 6: Run the full suite and build**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add routine editor

Reorders and removes via the pure routineItems functions, writing the
whole item list back. The name field seeds once from first load rather
than on every live-query emission, so typing is not discarded."
```

---

## Task 8: Cycle editor

**Files:**
- Create: `src/ui/cycle/CycleEditor.tsx`, `src/ui/cycle/CycleEditor.test.tsx`
- Modify: `src/App.tsx`, `src/ui/AppLayout.tsx`

**Interfaces:**
- Consumes: `getOrCreateActiveCycle`, `saveCycle` from `src/db/cycles.ts`; `listRoutines` from `src/db/routines.ts`.
- Produces: `CycleEditor` component, mounted at `/cycle`, plus a fourth navigation tab.

- [ ] **Step 1: Write the failing test**

Create `src/ui/cycle/CycleEditor.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDbForTests } from '../../db/db';
import { createRoutine } from '../../db/routines';
import { getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { CycleEditor } from './CycleEditor';

beforeEach(async () => {
  await resetDbForTests();
});

it('tells the user when no routines exist yet', async () => {
  render(<CycleEditor />);
  expect(await screen.findByText(/create a routine first/i)).toBeInTheDocument();
});

it('adds a routine to the rotation', async () => {
  const user = userEvent.setup();
  const r = await createRoutine('Push Day');
  render(<CycleEditor />);

  await user.click(await screen.findByRole('button', { name: /add push day to rotation/i }));

  await expect.poll(async () => (await getOrCreateActiveCycle()).routineIds).toEqual([r.id]);
});

it('shows the rotation in order', async () => {
  const a = await createRoutine('Push Day');
  const b = await createRoutine('Pull Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id, b.id] });

  render(<CycleEditor />);

  const listed = await screen.findAllByTestId('cycle-slot-name');
  expect(listed.map((el) => el.textContent)).toEqual(['Push Day', 'Pull Day']);
});

it('moves a rotation entry up', async () => {
  const user = userEvent.setup();
  const a = await createRoutine('Push Day');
  const b = await createRoutine('Pull Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id, b.id] });

  render(<CycleEditor />);
  await screen.findAllByTestId('cycle-slot-name');
  await user.click(screen.getByRole('button', { name: /move pull day up/i }));

  await expect.poll(async () => (await getOrCreateActiveCycle()).routineIds)
    .toEqual([b.id, a.id]);
});

it('removes a rotation entry', async () => {
  const user = userEvent.setup();
  const a = await createRoutine('Push Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id] });

  render(<CycleEditor />);
  await screen.findAllByTestId('cycle-slot-name');
  await user.click(screen.getByRole('button', { name: /remove push day from rotation/i }));

  await expect.poll(async () => (await getOrCreateActiveCycle()).routineIds).toEqual([]);
});

it('allows the same routine twice in one rotation', async () => {
  const user = userEvent.setup();
  const a = await createRoutine('Push Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id] });

  render(<CycleEditor />);
  await screen.findAllByTestId('cycle-slot-name');
  await user.click(screen.getByRole('button', { name: /add push day to rotation/i }));

  await expect.poll(async () => (await getOrCreateActiveCycle()).routineIds)
    .toEqual([a.id, a.id]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/cycle/CycleEditor.test.tsx`
Expected: FAIL — `Failed to resolve import "./CycleEditor"`.

- [ ] **Step 3: Implement**

Create `src/ui/cycle/CycleEditor.tsx`:

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { listRoutines } from '../../db/routines';

/** Moves the entry at `index` one place in `direction`, returning a new array. */
function moveAt(ids: string[], index: number, direction: 'up' | 'down'): string[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function CycleEditor() {
  const cycle = useLiveQuery(() => getOrCreateActiveCycle(), []);
  const routines = useLiveQuery(() => listRoutines(), []);

  if (cycle === undefined || routines === undefined) return <p>Loading…</p>;

  const nameById = new Map(routines.map((r) => [r.id, r.name]));

  return (
    <section>
      <h2>Rotation</h2>

      {routines.length === 0 ? (
        <p className="empty">Create a routine first, then order them here.</p>
      ) : (
        <>
          <h3>Order</h3>
          {cycle.routineIds.length === 0 ? (
            <p className="empty">Nothing in the rotation yet.</p>
          ) : (
            <ol className="cycle-slots">
              {cycle.routineIds.map((routineId, index) => {
                const label = nameById.get(routineId) ?? 'Unknown routine';
                return (
                  <li key={`${routineId}-${index}`}>
                    <span data-testid="cycle-slot-name">{label}</span>
                    <button
                      type="button"
                      aria-label={`Move ${label} up`}
                      onClick={() =>
                        saveCycle({ ...cycle, routineIds: moveAt(cycle.routineIds, index, 'up') })
                      }
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${label} down`}
                      onClick={() =>
                        saveCycle({ ...cycle, routineIds: moveAt(cycle.routineIds, index, 'down') })
                      }
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${label} from rotation`}
                      onClick={() =>
                        saveCycle({
                          ...cycle,
                          routineIds: cycle.routineIds.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          <h3>Add to rotation</h3>
          <ul className="routine-picker">
            {routines.map((routine) => (
              <li key={routine.id}>
                <button
                  type="button"
                  aria-label={`Add ${routine.name} to rotation`}
                  onClick={() =>
                    saveCycle({ ...cycle, routineIds: [...cycle.routineIds, routine.id] })
                  }
                >
                  {routine.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

Removal uses the index rather than the id so that a routine appearing twice in a rotation removes only the entry the user clicked.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/cycle/CycleEditor.test.tsx`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Mount the route and add the tab**

In `src/App.tsx`, add the import:

```tsx
import { CycleEditor } from './ui/cycle/CycleEditor';
```

and add the route:

```tsx
          <Route path="/cycle" element={<CycleEditor />} />
```

In `src/ui/AppLayout.tsx`, replace the `TABS` constant:

```tsx
const TABS = [
  { to: '/', label: 'Today', end: true },
  { to: '/routines', label: 'Routines', end: false },
  { to: '/cycle', label: 'Rotation', end: false },
  { to: '/library', label: 'Library', end: false },
];
```

- [ ] **Step 6: Run the full suite and build**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add cycle editor

Orders routines into the rotation. A routine may appear more than once,
so removal is by index rather than id."
```

---

## Task 9: Today screen

**Files:**
- Create: `src/ui/today/TodayScreen.tsx`, `src/ui/today/TodayScreen.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `getOrCreateActiveCycle`, `saveCycle` from `src/db/cycles.ts`; `getRoutine` from `src/db/routines.ts`; `listExercises` from `src/db/exercises.ts`; `nextRoutineId`, `skipNext` from `src/domain/cycle.ts`.
- Produces: `TodayScreen` component, mounted at `/`.

**There is no Start button.** Sessions arrive in Plan 3; a button that starts nothing would be a stub. Skip is a permanent feature — you skip a day in real life — so it earns its place now.

- [ ] **Step 1: Write the failing test**

Create `src/ui/today/TodayScreen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise } from '../../db/exercises';
import { createRoutine, setRoutineItems } from '../../db/routines';
import { getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { TodayScreen } from './TodayScreen';

beforeEach(async () => {
  await resetDbForTests();
});

function renderScreen() {
  return render(
    <MemoryRouter>
      <TodayScreen />
    </MemoryRouter>,
  );
}

it('prompts to build a rotation when none exists', async () => {
  renderScreen();
  expect(await screen.findByText(/nothing in your rotation/i)).toBeInTheDocument();
});

it('names the next routine', async () => {
  const r = await createRoutine('Push Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [r.id], currentIndex: 0 });

  renderScreen();
  expect(await screen.findByText('Push Day')).toBeInTheDocument();
});

it('shows the position in the rotation', async () => {
  const a = await createRoutine('Push Day');
  const b = await createRoutine('Pull Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id, b.id], currentIndex: 1 });

  renderScreen();
  expect(await screen.findByText(/2 of 2/i)).toBeInTheDocument();
});

it('lists the exercises of the next routine', async () => {
  const ex = await createCustomExercise({
    name: 'Barbell Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType: 'weight_reps',
  });
  const r = await createRoutine('Push Day');
  await setRoutineItems(r.id, [{ id: 'i1', exerciseId: ex.id, order: 0 }]);
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [r.id], currentIndex: 0 });

  renderScreen();
  expect(await screen.findByText('Barbell Bench Press')).toBeInTheDocument();
});

it('skips to the next routine', async () => {
  const user = userEvent.setup();
  const a = await createRoutine('Push Day');
  const b = await createRoutine('Pull Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id, b.id], currentIndex: 0 });

  renderScreen();
  await screen.findByText('Push Day');
  await user.click(screen.getByRole('button', { name: /skip/i }));

  expect(await screen.findByText('Pull Day')).toBeInTheDocument();
  await expect.poll(async () => (await getOrCreateActiveCycle()).currentIndex).toBe(1);
});

it('says the routine is empty rather than showing nothing', async () => {
  const r = await createRoutine('Push Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [r.id], currentIndex: 0 });

  renderScreen();
  expect(await screen.findByText(/no exercises in this routine/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/today/TodayScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./TodayScreen"`.

- [ ] **Step 3: Implement**

Create `src/ui/today/TodayScreen.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { getRoutine } from '../../db/routines';
import { listExercises } from '../../db/exercises';
import { nextRoutineId, skipNext } from '../../domain/cycle';

export function TodayScreen() {
  // One query rather than two chained ones. Splitting the cycle read from
  // the routine read makes the second query lag a render behind the first,
  // which flashes "no longer available" every time the rotation changes.
  const data = useLiveQuery(async () => {
    const cycle = await getOrCreateActiveCycle();
    const upNextId = nextRoutineId(cycle);
    const routine = upNextId ? (await getRoutine(upNextId)) ?? null : null;
    return { cycle, routine };
  }, []);
  const exercises = useLiveQuery(() => listExercises({ includeArchived: true }), []);

  if (data === undefined) return <p>Loading…</p>;
  const { cycle, routine } = data;

  if (cycle.routineIds.length === 0) {
    return (
      <section>
        <h2>Today</h2>
        <p className="empty">
          Nothing in your rotation yet. <Link to="/cycle">Build one</Link> to see
          what is next.
        </p>
      </section>
    );
  }

  const position = (cycle.currentIndex % cycle.routineIds.length) + 1;
  const nameById = new Map((exercises ?? []).map((e) => [e.id, e.name]));

  return (
    <section>
      <h2>Today</h2>

      <p className="cycle-position">
        {position} of {cycle.routineIds.length}
      </p>

      {routine === null ? (
        <p role="alert">That routine is no longer available.</p>
      ) : (
        <>
          <h3>{routine.name}</h3>
          {routine.items.length === 0 ? (
            <p className="empty">
              No exercises in this routine.{' '}
              <Link to={`/routines/${routine.id}`}>Add some</Link>.
            </p>
          ) : (
            <ol className="routine-preview">
              {routine.items.map((item) => (
                <li key={item.id}>{nameById.get(item.exerciseId) ?? 'Unknown exercise'}</li>
              ))}
            </ol>
          )}
        </>
      )}

      <button type="button" onClick={() => saveCycle(skipNext(cycle))}>
        Skip to next
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/today/TodayScreen.test.tsx`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Mount the route**

In `src/App.tsx`, add the import:

```tsx
import { TodayScreen } from './ui/today/TodayScreen';
```

and replace the placeholder root route:

```tsx
          <Route path="/" element={<TodayScreen />} />
```

- [ ] **Step 6: Run the full suite and build**

Run: `npm test`
Expected: PASS — every test across every file.

Run: `npm run build`
Expected: type-check and build succeed with no errors.

- [ ] **Step 7: Verify on the phone**

```bash
git push
```

Wait for the Actions run to go green, then open `https://zabdi20.github.io/workout-tracker/` from the home-screen icon. Pull to refresh so the service worker picks up the new build. Confirm:

1. Four tabs appear: Today, Routines, Rotation, Library.
2. A routine can be created, opened, and given exercises from the browser.
3. Exercises reorder and remove.
4. Routines can be ordered into the rotation.
5. Today names the next routine and lists its exercises.
6. Skip advances, and the change survives closing and reopening the app.
7. **Airplane mode:** relaunch from the icon with no signal. Everything above still works.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add Today screen

Names the next routine in the rotation and previews its exercises. No
Start button: sessions arrive in Plan 3, and a button that starts nothing
would be a stub. Skip is permanent — missing a day is normal."
```

---

## Done when

- [ ] `npm test` passes with no failures.
- [ ] `npm run build` completes with no type errors.
- [ ] The deploy workflow is green and the app loads from `https://zabdi20.github.io/workout-tracker/`.
- [ ] A routine can be built from library exercises, reordered, and archived.
- [ ] Routines can be ordered into a rotation, including the same routine twice.
- [ ] Today names the next routine, lists its exercises, and Skip advances the rotation.
- [ ] Archiving a routine removes it from the rotation.
- [ ] Everything above works in airplane mode after a relaunch.

## Not in this plan

Session logging, the set-entry UI, the rest timer, history, PR detection, charts, and backup export/import. Those are Plans 3 and 4.

Also not included, and deliberately:

- **Per-item rest seconds and target sets/reps.** `RoutineItem` carries `restSeconds`, `targetSets`, `targetRepMin` and `targetRepMax`, and this plan writes none of them. They are forward-compatibility hooks; the rest timer that consumes `restSeconds` is Plan 3, and target reps belong to the v3 progression feature.
- **Supersets.** `RoutineItem.supersetGroup` stays unused until Plan 3 at the earliest.
- **Multiple saved cycles.** The schema supports many with one active; the UI exposes exactly one, created on demand. Switching between saved splits is a v3 concern.
- **Drag-and-drop reordering.** Up/down buttons are unambiguous, keyboard-accessible, and work on a touch screen without a gesture library. Revisit only if using it proves annoying.
- **Styling.** The app still has no CSS. Visual design is its own pass, and doing it before the screens settle would mean doing it twice.
