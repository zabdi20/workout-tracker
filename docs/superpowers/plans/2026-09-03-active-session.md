# Active Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app able to log a workout — set by set, across all six measurement types, prefilled from last time, resumable after Safari kills the tab.

**Architecture:** Planned sets are UI state; a `LoggedSet` row is written only when the user confirms a set, so the `sets` table never contains anything that was not performed. Session persistence lives in two new `db/` modules; the prefill and field-shaping rules live in two new pure `domain/` modules. The screen is a thin renderer over both.

**Tech Stack:** React 19 · TypeScript 7 · Vite 8 · Dexie 4.4 over IndexedDB · react-router-dom 7.18 · Vitest 4 with `fake-indexeddb` and React Testing Library

**Spec:** `docs/superpowers/specs/2026-09-03-active-session-design.md` (Plan 3 decisions) and `docs/superpowers/specs/2026-08-04-workout-tracker-design.md` (the app as a whole). Executors read both.

## Global Constraints

Every task's requirements implicitly include this section. Each line cost a real bug.

- **Never `.where()` on a boolean or nullable field.** `isCustom`, `isArchived`, `isActive` and `Session.routineId` are deliberately unindexed — IndexedDB cannot key booleans or `null` and `.where()` on them throws at runtime. Load with `toArray()` and filter in memory. `src/db/db.test.ts` pins this by asserting those names are absent from `schema.idxByName`.
- **`Session.status` is a string and IS indexed.** `.where('status').equals('in_progress')` is legal and correct. Do not hand-filter it — the rule above is about booleans and nulls only.
- **A `liveQuery` querier may not open a readwrite transaction** — Dexie throws `ReadOnlyError`. Anything called from inside `useLiveQuery` must be read-only. Writes happen in event handlers and mount effects.
- **`src/domain/` is pure and I/O-free.** Type-only imports from `src/db/types` are fine; a runtime import of `src/db/db` is not.
- **Every database write from an event handler surfaces its failure** via `run(...)` from `src/ui/useWriteError.ts`. A bare `onClick={() => save(...)}` is fire-and-forget: on rejection the user sees nothing while the app looks like it worked.
- **Weight is stored with the unit it was entered in and never converted.** 135 lb stays exactly `135` + `'lb'`. Round-tripping through kg produces drift that eventually renders as a fake PR. `distanceMeters` is the deliberate exception — canonical metres.
- **Never pass an `id` inside a Dexie `update()` payload.** Dexie turns it into delete-then-add under the new key, which is a real hard delete. `updateExercise` strips it; `updateSet` must too.
- **Archive, never hard-delete, anything other rows reference** — exercises and routines. `Session` and `LoggedSet` are the deliberate exception: nothing references a session except its own sets, so `discardSession` deletes both.
- **No CSS in this plan.** Visual design stays deferred until the screens settle. Markup should be semantic and plain.
- **Use Git Bash, not PowerShell.** PowerShell's Restricted execution policy blocks the `npm.ps1` / `npx.ps1` shims. If `node` is missing: `export PATH="/c/Program Files/nodejs:$PATH"`.
- **Run the full suite with `npx vitest run --fileParallelism=false`.** Parallel runs are flaky in this sandbox from timeouts that pre-exist on bare `main`. A full run takes about 45 seconds. Single files may be run without the flag.
- **Vitest globals are enabled.** Do not import `describe`, `it`, `expect` or `beforeEach` — the existing tests don't.

### Deviation from the spec's task listing

The spec lists Today as task 6 and Active Session as task 7. They are swapped here: as listed, Today would link to `/session` one commit before that route exists, leaving the app broken between two commits. Active Session lands first, reachable by URL and redirecting to Today when nothing is in progress. `src/db/settings.ts` is also folded into Task 1 — the session screen needs `unitPreference` and `defaultRestSeconds`, and nothing reads the settings row today.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/db/sessions.ts` | Session lifecycle: find in progress, start, finish (advancing the cycle), discard |
| `src/db/sets.ts` | `LoggedSet` CRUD plus `lastPerformance`, the hot "what did I do last time" query |
| `src/db/settings.ts` | Read the settings singleton with defaults |
| `src/domain/measurement.ts` | Which inputs each of the six measurement types needs; set formatting |
| `src/domain/setPlan.ts` | Derives the unconfirmed planned rows from prescription, last time, and what's logged |
| `src/ui/session/ActiveSessionScreen.tsx` | The logging screen |

**Modified:**

| File | Change |
| --- | --- |
| `src/db/routines.ts` | Add `updateRoutineItems(id, mutator)` — transactional read-modify-write |
| `src/db/exercises.ts` | Add `resetExerciseToBundled`; correct the stale `updateExercise` comment |
| `src/domain/routineItems.ts` | Add `setItemPrescription` and `validatePrescription` |
| `src/ui/routines/RoutineEditor.tsx` | Prescription inputs; route handlers through `updateRoutineItems`; mark archived exercises |
| `src/ui/library/LibraryScreen.tsx` | Open the edit form for bundled exercises, not just custom ones |
| `src/ui/library/CustomExerciseForm.tsx` | Reset to bundled; make `handleArchive` surface its errors |
| `src/ui/today/TodayScreen.tsx` | Resume / Start / pick a different routine |
| `src/App.tsx` | Add the `/session` route |

---

## Task 1: Session, set, and settings data access

**Files:**
- Create: `src/db/sessions.ts`
- Create: `src/db/sessions.test.ts`
- Create: `src/db/sets.ts`
- Create: `src/db/sets.test.ts`
- Create: `src/db/settings.ts`
- Create: `src/db/settings.test.ts`

**Interfaces:**

- Consumes: `db` and `resetDbForTests` from `src/db/db`; `advanceAfter` from `src/domain/cycle`; types from `src/db/types`; `createRoutine` from `src/db/routines` and `getOrCreateActiveCycle`/`saveCycle` from `src/db/cycles` (tests only).
- Produces:

```ts
// src/db/sessions.ts
export function getInProgressSession(): Promise<Session | undefined>;
export function getSession(id: string): Promise<Session | undefined>;
export function startSession(routine: Routine): Promise<Session>;
export function finishSession(id: string): Promise<void>;
export function discardSession(id: string): Promise<void>;

// src/db/sets.ts
export interface NewLoggedSet {
  sessionId: string;
  exerciseId: string;
  setType: SetType;
  unit: WeightUnit;
  weight?: number;
  reps?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  notes?: string;
}
export function listSetsForSession(sessionId: string): Promise<LoggedSet[]>;
export function logSet(input: NewLoggedSet): Promise<LoggedSet>;
export function updateSet(id: string, changes: Partial<LoggedSet>): Promise<void>;
export function deleteSet(id: string): Promise<void>;
export function lastPerformance(
  exerciseId: string,
  excludeSessionId: string,
): Promise<LoggedSet[]>;

// src/db/settings.ts
export const DEFAULT_SETTINGS: Settings;
export function getSettings(): Promise<Settings>;
```

### Sessions

- [ ] **Step 1: Write the failing tests for `getInProgressSession` and `startSession`**

Create `src/db/sessions.test.ts`:

```ts
import { db, resetDbForTests } from './db';
import { createRoutine } from './routines';
import { getInProgressSession, startSession } from './sessions';

beforeEach(async () => {
  await resetDbForTests();
});

describe('getInProgressSession', () => {
  it('returns undefined when nothing is in progress', async () => {
    expect(await getInProgressSession()).toBeUndefined();
  });

  it('returns the session once one is started', async () => {
    const routine = await createRoutine('Push A');
    const started = await startSession(routine);
    expect((await getInProgressSession())?.id).toBe(started.id);
  });
});

describe('startSession', () => {
  it('snapshots the routine name so a later rename does not rewrite history', async () => {
    const routine = await createRoutine('Push A');
    const session = await startSession(routine);

    expect(session.name).toBe('Push A');
    expect(session.routineId).toBe(routine.id);
    expect(session.status).toBe('in_progress');
    expect(session.endedAt).toBeUndefined();
  });

  it('creates exactly one session when called concurrently', async () => {
    // StrictMode double-invokes effects, and a double-tap on Start is the
    // same race: both calls can observe an empty table before either writes.
    const routine = await createRoutine('Push A');
    await Promise.all([startSession(routine), startSession(routine)]);
    expect(await db.sessions.count()).toBe(1);
  });

  it('is idempotent for the same routine', async () => {
    const routine = await createRoutine('Push A');
    const first = await startSession(routine);
    const second = await startSession(routine);
    expect(second.id).toBe(first.id);
  });

  it('refuses to start a second session for a different routine', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    await startSession(push);

    await expect(startSession(pull)).rejects.toThrow(/already in progress/i);
    expect(await db.sessions.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/db/sessions.test.ts`
Expected: FAIL — `Failed to resolve import "./sessions"`.

- [ ] **Step 3: Implement `getInProgressSession`, `getSession` and `startSession`**

Create `src/db/sessions.ts`:

```ts
import { db } from './db';
import { advanceAfter } from '../domain/cycle';
import type { Routine, Session } from './types';

/**
 * The one session currently being logged, if any.
 *
 * `status` is a string and IS indexed, so .where() is correct here — the
 * never-.where() rule covers booleans and nulls. Session.routineId is the
 * nullable field on this table and stays unindexed.
 *
 * Read-only, so this is safe to call from inside a useLiveQuery querier.
 *
 * Sorted by startedAt rather than taken with .first(), which would return
 * the lowest primary key among matches. At most one session is ever in
 * progress, so this only matters if that invariant is ever broken — in
 * which case resuming the oldest is the predictable answer.
 */
export async function getInProgressSession(): Promise<Session | undefined> {
  const open = await db.sessions.where('status').equals('in_progress').sortBy('startedAt');
  return open[0];
}

export function getSession(id: string): Promise<Session | undefined> {
  return db.sessions.get(id);
}

/**
 * Starts logging `routine`, or returns the session already in progress for
 * it.
 *
 * The check and the insert share one transaction, for the same reason
 * getOrCreateActiveCycle does: StrictMode double-invokes effects and a
 * double-tap on Start is the same race, so two calls can both observe an
 * empty table before either writes.
 *
 * Returning the existing session makes a repeat call idempotent. Throwing
 * for a *different* routine keeps that from silently handing the caller a
 * session they did not ask for — the Today screen shows Resume rather than
 * Start while one is open, so reaching this is already a bug.
 *
 * NEVER call this from inside a useLiveQuery querier: it opens a readwrite
 * transaction and Dexie throws ReadOnlyError.
 */
export async function startSession(routine: Routine): Promise<Session> {
  return db.transaction('rw', db.sessions, async () => {
    const open = await db.sessions.where('status').equals('in_progress').sortBy('startedAt');
    const existing = open[0];
    if (existing) {
      if (existing.routineId === routine.id) return existing;
      throw new Error(
        `A session is already in progress: ${existing.name}. Finish or discard it first.`,
      );
    }

    const session: Session = {
      id: crypto.randomUUID(),
      routineId: routine.id,
      // Snapshotted, so renaming the routine later does not rewrite history.
      name: routine.name,
      startedAt: Date.now(),
      status: 'in_progress',
    };
    await db.sessions.add(session);
    return session;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/db/sessions.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/sessions.ts src/db/sessions.test.ts
git commit -m "feat: start and find the in-progress session"
```

- [ ] **Step 6: Write the failing tests for `finishSession` and `discardSession`**

Append to `src/db/sessions.test.ts`, and extend the import line at the top to
`import { discardSession, finishSession, getInProgressSession, getSession, startSession } from './sessions';`:

```ts
import { getOrCreateActiveCycle, saveCycle, getActiveCycle } from './cycles';
import { archiveRoutine } from './routines';
import { logSet } from './sets';

describe('finishSession', () => {
  it('completes the session and stamps endedAt', async () => {
    const routine = await createRoutine('Push A');
    const session = await startSession(routine);

    await finishSession(session.id);

    const done = await getSession(session.id);
    expect(done?.status).toBe('completed');
    expect(done?.endedAt).toBeGreaterThan(0);
    expect(await getInProgressSession()).toBeUndefined();
  });

  it('advances the rotation past the routine that was trained', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    const cycle = await getOrCreateActiveCycle();
    await saveCycle({ ...cycle, routineIds: [push.id, pull.id], currentIndex: 0 });

    const session = await startSession(push);
    await finishSession(session.id);

    expect((await getActiveCycle())?.currentIndex).toBe(1);
  });

  it('re-anchors the rotation when a routine is trained out of order', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    const legs = await createRoutine('Legs');
    const cycle = await getOrCreateActiveCycle();
    await saveCycle({
      ...cycle,
      routineIds: [push.id, pull.id, legs.id],
      currentIndex: 0,
    });

    const session = await startSession(legs);
    await finishSession(session.id);

    // position(legs) + 1 wraps back to the start, not currentIndex + 1.
    expect((await getActiveCycle())?.currentIndex).toBe(0);
  });

  it('leaves the rotation alone when the routine was archived mid-session', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    const cycle = await getOrCreateActiveCycle();
    await saveCycle({ ...cycle, routineIds: [push.id, pull.id], currentIndex: 1 });

    const session = await startSession(pull);
    // archiveRoutine strips it from every cycle, so advanceAfter can no
    // longer find it. No special case is needed: indexOf returns -1 and
    // advanceAfter returns the cycle unchanged.
    await archiveRoutine(pull.id);
    await finishSession(session.id);

    const after = await getActiveCycle();
    expect(after?.routineIds).toEqual([push.id]);
    expect(after?.currentIndex).toBe(0);
    expect((await getSession(session.id))?.status).toBe('completed');
  });

  it('rejects an unknown session', async () => {
    await expect(finishSession('nope')).rejects.toThrow(/not found/i);
  });
});

describe('discardSession', () => {
  it('removes the session and every set logged into it', async () => {
    const routine = await createRoutine('Push A');
    const session = await startSession(routine);
    await logSet({
      sessionId: session.id,
      exerciseId: 'bench',
      setType: 'working',
      unit: 'lb',
      weight: 135,
      reps: 8,
    });

    await discardSession(session.id);

    expect(await getSession(session.id)).toBeUndefined();
    expect(await db.sets.count()).toBe(0);
  });

  it('leaves other sessions untouched', async () => {
    const push = await createRoutine('Push A');
    const first = await startSession(push);
    await logSet({
      sessionId: first.id,
      exerciseId: 'bench',
      setType: 'working',
      unit: 'lb',
      weight: 135,
      reps: 8,
    });
    await finishSession(first.id);

    const second = await startSession(push);
    await discardSession(second.id);

    expect(await getSession(first.id)).toBeDefined();
    expect(await db.sets.count()).toBe(1);
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run src/db/sessions.test.ts`
Expected: FAIL — `finishSession is not exported` and `Failed to resolve import "./sets"`. Both are expected; `sets.ts` arrives in Step 11.

- [ ] **Step 8: Implement `finishSession` and `discardSession`**

Append to `src/db/sessions.ts`:

```ts
/**
 * Marks the session complete and advances the rotation, in one transaction.
 *
 * The two must not be separable: a failure between them leaves a completed
 * session sitting behind a stale rotation pointer, and the user would train
 * the same routine twice without the app noticing.
 *
 * A routine archived mid-session needs no special case. archiveRoutine
 * strips it from every cycle, and advanceAfter returns the cycle unchanged
 * when indexOf is -1.
 */
export async function finishSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.cycles, async () => {
    const session = await db.sessions.get(id);
    if (!session) throw new Error('Session not found');

    await db.sessions.update(id, { endedAt: Date.now(), status: 'completed' });

    // Freestyle sessions have no routine to advance past. No UI creates one
    // yet, but the schema permits it and this is the natural place to be
    // correct about it.
    if (session.routineId === null) return;

    const cycles = await db.cycles.toArray();
    const active = cycles.find((c) => c.isActive);
    if (!active) return;

    await db.cycles.put(advanceAfter(active, session.routineId));
  });
}

/**
 * Deletes the session and its sets.
 *
 * A real hard delete, and a correct one. The never-hard-delete rule protects
 * rows that other rows reference; nothing references a Session except the
 * LoggedSets that go with it, and both are removed here in one transaction.
 * An 'abandoned' status was considered and rejected — it buys nothing and
 * would make History filter for it forever.
 */
export async function discardSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    await db.sets.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
  });
}
```

### Sets

- [ ] **Step 9: Write the failing tests for `logSet`, `listSetsForSession`, `updateSet` and `deleteSet`**

Create `src/db/sets.test.ts`:

```ts
import { db, resetDbForTests } from './db';
import { deleteSet, listSetsForSession, logSet, updateSet } from './sets';

beforeEach(async () => {
  await resetDbForTests();
});

function bench(sessionId: string, weight: number, reps: number) {
  return {
    sessionId,
    exerciseId: 'bench',
    setType: 'working' as const,
    unit: 'lb' as const,
    weight,
    reps,
  };
}

describe('logSet', () => {
  it('assigns an id and a completedAt timestamp', async () => {
    const set = await logSet(bench('s1', 135, 8));
    expect(set.id).toMatch(/\S/);
    expect(set.completedAt).toBeGreaterThan(0);
    expect(set.weight).toBe(135);
    expect(set.unit).toBe('lb');
  });

  it('numbers sets per exercise within a session', async () => {
    const first = await logSet(bench('s1', 135, 8));
    const second = await logSet(bench('s1', 135, 8));
    const other = await logSet({ ...bench('s1', 0, 10), exerciseId: 'dip' });

    expect(first.order).toBe(0);
    expect(second.order).toBe(1);
    expect(other.order).toBe(0);
  });

  it('assigns distinct orders under concurrent calls', async () => {
    // Two fast taps on the same confirm button. Computing order from an
    // array captured at render would give both the same number; computing
    // it inside the write transaction cannot.
    await Promise.all([
      logSet(bench('s1', 135, 8)),
      logSet(bench('s1', 135, 8)),
      logSet(bench('s1', 135, 8)),
    ]);

    const orders = (await listSetsForSession('s1')).map((s) => s.order);
    expect(new Set(orders).size).toBe(3);
  });

  it('does not reuse the order of a deleted set', async () => {
    await logSet(bench('s1', 135, 8));
    const second = await logSet(bench('s1', 135, 8));
    await logSet(bench('s1', 145, 6));
    await deleteSet(second.id);

    const fourth = await logSet(bench('s1', 145, 6));
    // max(order) + 1, not count: counting would collide with the surviving
    // order-2 set and make the list order nondeterministic.
    expect(fourth.order).toBe(3);
  });

  it('stores weight in the unit it was entered in, never converted', async () => {
    const set = await logSet({ ...bench('s1', 135, 8), unit: 'lb' });
    const stored = await db.sets.get(set.id);
    expect(stored?.weight).toBe(135);
    expect(stored?.unit).toBe('lb');
  });
});

describe('listSetsForSession', () => {
  it('returns the session’s sets in order', async () => {
    await logSet(bench('s1', 135, 8));
    await logSet({ ...bench('s1', 0, 10), exerciseId: 'dip' });
    await logSet(bench('s2', 225, 5));

    const sets = await listSetsForSession('s1');
    expect(sets).toHaveLength(2);
    expect(sets.every((s) => s.sessionId === 's1')).toBe(true);
  });

  it('returns an empty array for a session with no sets', async () => {
    expect(await listSetsForSession('s1')).toEqual([]);
  });
});

describe('updateSet', () => {
  it('applies changes', async () => {
    const set = await logSet(bench('s1', 135, 8));
    await updateSet(set.id, { reps: 7 });
    expect((await db.sets.get(set.id))?.reps).toBe(7);
  });

  it('strips id from the payload', async () => {
    // Dexie turns an id inside an update payload into delete-then-add under
    // the new key. That is a real hard delete of the original row.
    const set = await logSet(bench('s1', 135, 8));
    await updateSet(set.id, { id: 'hijacked', reps: 7 } as Partial<typeof set>);

    expect(await db.sets.get(set.id)).toBeDefined();
    expect(await db.sets.get('hijacked')).toBeUndefined();
  });
});

describe('deleteSet', () => {
  it('removes just that set', async () => {
    const first = await logSet(bench('s1', 135, 8));
    await logSet(bench('s1', 135, 8));

    await deleteSet(first.id);

    expect(await listSetsForSession('s1')).toHaveLength(1);
  });
});
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `npx vitest run src/db/sets.test.ts`
Expected: FAIL — `Failed to resolve import "./sets"`.

- [ ] **Step 11: Implement `src/db/sets.ts`**

Create `src/db/sets.ts`:

```ts
import Dexie from 'dexie';
import { db } from './db';
import type { LoggedSet, SetType, WeightUnit } from './types';

/** Everything a caller supplies; id, order and completedAt are assigned here. */
export interface NewLoggedSet {
  sessionId: string;
  exerciseId: string;
  setType: SetType;
  unit: WeightUnit;
  weight?: number;
  reps?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  notes?: string;
}

/**
 * All sets logged into a session, ordered.
 *
 * `order` is per (session, exercise) and is a monotonic sort key, not a
 * position — deleting a set leaves a gap on purpose. Display numbering is
 * the position within the sorted array, so it stays 1, 2, 3 after a delete.
 */
export async function listSetsForSession(sessionId: string): Promise<LoggedSet[]> {
  const sets = await db.sets.where('sessionId').equals(sessionId).toArray();
  return sets.sort((a, b) => a.order - b.order || a.completedAt - b.completedAt);
}

/**
 * Writes a performed set.
 *
 * `order` is computed inside the transaction from a fresh read, never from
 * an array captured at render. Two fast taps on the same confirm button
 * would otherwise both compute the same number — the Plan 2 stale-array
 * finding, which costs a reorder in a routine list and a logged set here.
 *
 * max(order) + 1 rather than a count: counting would collide with surviving
 * rows after a set is deleted from the middle.
 */
export async function logSet(input: NewLoggedSet): Promise<LoggedSet> {
  return db.transaction('rw', db.sets, async () => {
    const existing = await db.sets
      .where('sessionId')
      .equals(input.sessionId)
      .filter((s) => s.exerciseId === input.exerciseId)
      .toArray();

    const order = existing.reduce((max, s) => Math.max(max, s.order + 1), 0);

    const set: LoggedSet = {
      ...input,
      id: crypto.randomUUID(),
      order,
      completedAt: Date.now(),
    };
    await db.sets.add(set);
    return set;
  });
}

export async function updateSet(id: string, changes: Partial<LoggedSet>): Promise<void> {
  // Dexie turns an `id` inside an update payload into delete-then-add under
  // the new key. That is a real hard delete. Mirrors updateExercise.
  const { id: _discardedId, ...safe } = changes;
  await db.sets.update(id, safe);
}

export async function deleteSet(id: string): Promise<void> {
  await db.sets.delete(id);
}

/**
 * What the user did the last time they trained this exercise, excluding the
 * session currently in progress. Returns that session's sets for this
 * exercise, ordered, or an empty array if there is no history.
 *
 * The hottest query in the app: it renders for every exercise of every
 * workout. Served by the compound [exerciseId+completedAt] index.
 *
 * Two indexed reads rather than one. The obvious single pass — walk
 * backwards collecting until sessionId changes — assumes a session's sets
 * are contiguous in completedAt order. Editing a past session in Plan 5
 * breaks that assumption, and the symptom would be a silently truncated
 * last-time line that nobody connects back to the edit.
 */
export async function lastPerformance(
  exerciseId: string,
  excludeSessionId: string,
): Promise<LoggedSet[]> {
  const newest = await db.sets
    .where('[exerciseId+completedAt]')
    .between([exerciseId, Dexie.minKey], [exerciseId, Dexie.maxKey])
    .reverse()
    .filter((s) => s.sessionId !== excludeSessionId)
    .first();

  if (!newest) return [];

  const sets = await db.sets
    .where('sessionId')
    .equals(newest.sessionId)
    .filter((s) => s.exerciseId === exerciseId)
    .toArray();

  return sets.sort((a, b) => a.order - b.order);
}
```

- [ ] **Step 12: Run both db test files to verify they pass**

Run: `npx vitest run src/db/sets.test.ts src/db/sessions.test.ts`
Expected: PASS — 13 tests in `sessions.test.ts`, 10 in `sets.test.ts`.

- [ ] **Step 13: Commit**

```bash
git add src/db/sets.ts src/db/sets.test.ts src/db/sessions.ts src/db/sessions.test.ts
git commit -m "feat: log sets, finish and discard sessions"
```

- [ ] **Step 14: Write the failing tests for `lastPerformance`**

Append to `src/db/sets.test.ts`, extending the import line to include `lastPerformance`:

```ts
describe('lastPerformance', () => {
  it('returns an empty array when the exercise has no history', async () => {
    expect(await lastPerformance('bench', 'current')).toEqual([]);
  });

  it('returns the previous session’s sets for that exercise, ordered', async () => {
    await logSet(bench('older', 125, 8));
    await logSet(bench('previous', 135, 8));
    await logSet(bench('previous', 145, 6));
    await logSet(bench('current', 155, 5));

    const last = await lastPerformance('bench', 'current');

    expect(last.map((s) => s.weight)).toEqual([135, 145]);
  });

  it('ignores other exercises in that session', async () => {
    await logSet(bench('previous', 135, 8));
    await logSet({ ...bench('previous', 0, 12), exerciseId: 'dip' });

    const last = await lastPerformance('bench', 'current');

    expect(last).toHaveLength(1);
    expect(last[0].exerciseId).toBe('bench');
  });

  it('never returns sets from the excluded session', async () => {
    await logSet(bench('current', 155, 5));
    expect(await lastPerformance('bench', 'current')).toEqual([]);
  });

  it('keeps a session whole when its sets are not contiguous in time', async () => {
    // A set edited in Plan 5 can carry a completedAt later than a newer
    // session's. Selecting by sessionId rather than by a contiguous run
    // keeps the previous session intact instead of truncating it.
    const first = await logSet(bench('previous', 135, 8));
    await logSet(bench('previous', 145, 6));
    await logSet(bench('newer', 150, 5));
    await db.sets.update(first.id, { completedAt: Date.now() + 60_000 });

    const last = await lastPerformance('bench', 'current');

    expect(last.map((s) => s.weight)).toEqual([135, 145]);
  });

  it('includes warm-up sets, leaving the split to the caller', async () => {
    await logSet({ ...bench('previous', 45, 10), setType: 'warmup' });
    await logSet(bench('previous', 135, 8));

    const last = await lastPerformance('bench', 'current');

    expect(last.map((s) => s.setType)).toEqual(['warmup', 'working']);
  });
});
```

- [ ] **Step 15: Run the tests to verify they pass**

`lastPerformance` was written in Step 11, so these should pass immediately. That is expected and fine — the RED phase for it was Step 10, when the module did not exist.

Run: `npx vitest run src/db/sets.test.ts`
Expected: PASS — 16 tests.

If any fail, the implementation is wrong, not the test. Fix `src/db/sets.ts`.

### Settings

- [ ] **Step 16: Write the failing tests for `getSettings`**

Create `src/db/settings.test.ts`:

```ts
import { db, SETTINGS_ID, resetDbForTests } from './db';
import { DEFAULT_SETTINGS, getSettings } from './settings';

beforeEach(async () => {
  await resetDbForTests();
});

it('returns defaults when the singleton has not been written yet', async () => {
  const settings = await getSettings();
  expect(settings.unitPreference).toBe('lb');
  expect(settings.defaultRestSeconds).toBe(90);
  expect(settings.restAlertSound).toBe(true);
});

it('returns the stored row once it exists', async () => {
  await db.settings.put({ ...DEFAULT_SETTINGS, unitPreference: 'kg' });
  expect((await getSettings()).unitPreference).toBe('kg');
});

it('fills in fields missing from a row written by an older build', async () => {
  await db.settings.put({ id: SETTINGS_ID, unitPreference: 'kg' } as never);
  const settings = await getSettings();
  expect(settings.unitPreference).toBe('kg');
  expect(settings.defaultRestSeconds).toBe(90);
});
```

- [ ] **Step 17: Run the tests to verify they fail**

Run: `npx vitest run src/db/settings.test.ts`
Expected: FAIL — `Failed to resolve import "./settings"`.

- [ ] **Step 18: Implement `src/db/settings.ts`**

Create `src/db/settings.ts`:

```ts
import { db, SETTINGS_ID } from './db';
import type { Settings } from './types';

/** Mirrors the values prepareLibrary writes when it creates the row. */
export const DEFAULT_SETTINGS: Settings = {
  id: SETTINGS_ID,
  unitPreference: 'lb',
  defaultRestSeconds: 90,
  restAlertSound: true,
};

/**
 * The settings singleton, with defaults filled in.
 *
 * prepareLibrary writes the row before the app renders, so in practice one
 * exists. Merging over defaults anyway means a row written by an older
 * build, missing a field added since, cannot render `undefined` into an
 * input. Read-only, so it is safe inside a useLiveQuery querier.
 */
export async function getSettings(): Promise<Settings> {
  const stored = await db.settings.get(SETTINGS_ID);
  return { ...DEFAULT_SETTINGS, ...stored };
}
```

- [ ] **Step 19: Run the tests to verify they pass**

Run: `npx vitest run src/db/settings.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 20: Run the full suite and commit**

Run: `npx vitest run --fileParallelism=false`
Expected: PASS — every pre-existing test plus the new ones.

```bash
git add src/db/settings.ts src/db/settings.test.ts src/db/sets.test.ts
git commit -m "feat: read settings and the last performance of an exercise"
```

---

## Task 2: Measurement types — fields and formatting

**Files:**
- Create: `src/domain/measurement.ts`
- Create: `src/domain/measurement.test.ts`

**Interfaces:**

- Consumes: type-only imports from `src/db/types` (`LoggedSet`, `MeasurementType`). **No runtime imports** — `src/domain/` is pure and I/O-free.
- Produces:

```ts
export type SetFieldName = 'weight' | 'assistance' | 'reps' | 'duration' | 'distance';

export interface SetFieldSpec {
  name: SetFieldName;
  /** The LoggedSet property this field reads and writes. */
  property: 'weight' | 'reps' | 'durationSeconds' | 'distanceMeters';
  label: string;
  /** True when the value carries the set's WeightUnit alongside it. */
  unitBearing: boolean;
}

export function measurementFields(type: MeasurementType): SetFieldSpec[];
export function formatDuration(totalSeconds: number): string;
export function formatSet(set: LoggedSet, type: MeasurementType): string;
```

This task depends on nothing and may run in parallel with Tasks 3 and 5.

- [ ] **Step 1: Write the failing tests for `measurementFields`**

Create `src/domain/measurement.test.ts`:

```ts
import type { LoggedSet, MeasurementType } from '../db/types';
import { formatDuration, formatSet, measurementFields } from './measurement';

function names(type: MeasurementType) {
  return measurementFields(type).map((f) => f.name);
}

describe('measurementFields', () => {
  it('asks for weight and reps for a loaded rep set', () => {
    expect(names('weight_reps')).toEqual(['weight', 'reps']);
  });

  it('asks only for reps when the load is the body', () => {
    expect(names('bodyweight_reps')).toEqual(['reps']);
  });

  it('asks for assistance and reps for an assisted rep set', () => {
    expect(names('assisted_reps')).toEqual(['assistance', 'reps']);
  });

  it('asks only for seconds for a timed hold', () => {
    expect(names('duration')).toEqual(['duration']);
  });

  it('asks for metres and seconds for a distance effort', () => {
    expect(names('distance_duration')).toEqual(['distance', 'duration']);
  });

  it('asks for weight and seconds for a loaded carry', () => {
    expect(names('weight_duration')).toEqual(['weight', 'duration']);
  });

  it('maps assistance onto LoggedSet.weight, labelled so it cannot read as load', () => {
    const [assistance] = measurementFields('assisted_reps');
    expect(assistance.property).toBe('weight');
    expect(assistance.label).toBe('Assistance');
    expect(assistance.unitBearing).toBe(true);
  });

  it('marks distance as not unit-bearing — metres are canonical', () => {
    const [distance] = measurementFields('distance_duration');
    expect(distance.property).toBe('distanceMeters');
    expect(distance.unitBearing).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/measurement.test.ts`
Expected: FAIL — `Failed to resolve import "./measurement"`.

- [ ] **Step 3: Implement `measurementFields`**

Create `src/domain/measurement.ts`:

```ts
import type { LoggedSet, MeasurementType } from '../db/types';

export type SetFieldName = 'weight' | 'assistance' | 'reps' | 'duration' | 'distance';

export interface SetFieldSpec {
  name: SetFieldName;
  /** The LoggedSet property this field reads and writes. */
  property: 'weight' | 'reps' | 'durationSeconds' | 'distanceMeters';
  label: string;
  /** True when the value carries the set's WeightUnit alongside it. */
  unitBearing: boolean;
}

const WEIGHT: SetFieldSpec = {
  name: 'weight', property: 'weight', label: 'Weight', unitBearing: true,
};

// Shares LoggedSet.weight with WEIGHT but means the opposite: the
// counterweight the machine takes off, not the load lifted. Stored as a
// positive number so no consumer has to know about a sign convention, and
// labelled here so the UI cannot render it as load.
const ASSISTANCE: SetFieldSpec = {
  name: 'assistance', property: 'weight', label: 'Assistance', unitBearing: true,
};

const REPS: SetFieldSpec = {
  name: 'reps', property: 'reps', label: 'Reps', unitBearing: false,
};

const DURATION: SetFieldSpec = {
  name: 'duration', property: 'durationSeconds', label: 'Seconds', unitBearing: false,
};

// Not unit-bearing: distance is canonical metres, unlike weight, because it
// has no plate-math or exact-recall requirement.
const DISTANCE: SetFieldSpec = {
  name: 'distance', property: 'distanceMeters', label: 'Metres', unitBearing: false,
};

/**
 * Which inputs a measurement type needs, in the order they are shown.
 *
 * This table is what lets planks, dips, assisted pull-ups and treadmill work
 * share one schema. Without measurementType they would each need their own.
 */
const FIELDS: Record<MeasurementType, SetFieldSpec[]> = {
  weight_reps: [WEIGHT, REPS],
  bodyweight_reps: [REPS],
  assisted_reps: [ASSISTANCE, REPS],
  duration: [DURATION],
  distance_duration: [DISTANCE, DURATION],
  weight_duration: [WEIGHT, DURATION],
};

export function measurementFields(type: MeasurementType): SetFieldSpec[] {
  return FIELDS[type];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/measurement.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/measurement.ts src/domain/measurement.test.ts
git commit -m "feat: describe the inputs each measurement type needs"
```

- [ ] **Step 6: Write the failing tests for `formatDuration` and `formatSet`**

Append to `src/domain/measurement.test.ts`:

```ts
describe('formatDuration', () => {
  it('pads seconds under a minute', () => {
    expect(formatDuration(45)).toBe('0:45');
  });

  it('renders whole minutes', () => {
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(120)).toBe('2:00');
  });

  it('lets minutes run past sixty rather than adding an hours field', () => {
    // A gym set is never hours long, and a bare m:ss stays unambiguous.
    expect(formatDuration(3700)).toBe('61:40');
  });

  it('renders zero', () => {
    expect(formatDuration(0)).toBe('0:00');
  });
});

function set(fields: Partial<LoggedSet>): LoggedSet {
  return {
    id: 'x',
    sessionId: 's',
    exerciseId: 'e',
    order: 0,
    setType: 'working',
    unit: 'lb',
    completedAt: 0,
    ...fields,
  };
}

describe('formatSet', () => {
  it('renders a loaded rep set', () => {
    expect(formatSet(set({ weight: 135, reps: 8 }), 'weight_reps')).toBe('135 lb × 8');
  });

  it('renders kilos as entered, never converted', () => {
    expect(formatSet(set({ weight: 60, reps: 8, unit: 'kg' }), 'weight_reps'))
      .toBe('60 kg × 8');
  });

  it('renders a bodyweight rep set', () => {
    expect(formatSet(set({ reps: 12 }), 'bodyweight_reps')).toBe('12 reps');
  });

  it('names assistance so it cannot be misread as load', () => {
    expect(formatSet(set({ weight: 40, reps: 8 }), 'assisted_reps'))
      .toBe('8 reps, 40 lb assist');
  });

  it('renders a timed hold', () => {
    expect(formatSet(set({ durationSeconds: 45 }), 'duration')).toBe('0:45');
  });

  it('renders a distance effort', () => {
    expect(formatSet(set({ distanceMeters: 400, durationSeconds: 90 }), 'distance_duration'))
      .toBe('400 m in 1:30');
  });

  it('renders a loaded carry', () => {
    expect(formatSet(set({ weight: 45, durationSeconds: 30 }), 'weight_duration'))
      .toBe('45 lb for 0:30');
  });

  it('renders a placeholder rather than undefined when a value is missing', () => {
    expect(formatSet(set({}), 'weight_reps')).toBe('—');
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run src/domain/measurement.test.ts`
Expected: FAIL — `formatDuration is not a function`.

- [ ] **Step 8: Implement `formatDuration` and `formatSet`**

Append to `src/domain/measurement.ts`:

```ts
/**
 * m:ss. Minutes run past sixty rather than growing an hours field — a gym
 * set is never hours long, and a bare m:ss stays unambiguous.
 */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * One set as a line of reference text, e.g. "135 lb x 8".
 *
 * Returns an em dash when the values a type needs are absent, so a
 * half-written set can never render the string "undefined".
 */
export function formatSet(set: LoggedSet, type: MeasurementType): string {
  const { weight, reps, durationSeconds: secs, distanceMeters: metres, unit } = set;
  const missing = '—';

  switch (type) {
    case 'weight_reps':
      if (weight === undefined || reps === undefined) return missing;
      return `${weight} ${unit} × ${reps}`;
    case 'bodyweight_reps':
      if (reps === undefined) return missing;
      return `${reps} reps`;
    case 'assisted_reps':
      if (weight === undefined || reps === undefined) return missing;
      return `${reps} reps, ${weight} ${unit} assist`;
    case 'duration':
      if (secs === undefined) return missing;
      return formatDuration(secs);
    case 'distance_duration':
      if (metres === undefined || secs === undefined) return missing;
      return `${metres} m in ${formatDuration(secs)}`;
    case 'weight_duration':
      if (weight === undefined || secs === undefined) return missing;
      return `${weight} ${unit} for ${formatDuration(secs)}`;
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/domain/measurement.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 10: Commit**

```bash
git add src/domain/measurement.ts src/domain/measurement.test.ts
git commit -m "feat: format a logged set for the last-time line"
```

---

## Task 3: Planned-set derivation

**Files:**
- Create: `src/domain/setPlan.ts`
- Create: `src/domain/setPlan.test.ts`

**Interfaces:**

- Consumes: type-only imports from `src/db/types` (`LoggedSet`, `WeightUnit`). **No runtime imports.**
- Produces:

```ts
export interface PlannedSet {
  /** 1-based working-set number shown to the user. */
  position: number;
  unit: WeightUnit;
  weight?: number;
  reps?: number;
  durationSeconds?: number;
  distanceMeters?: number;
}

export interface PlanSetsInput {
  targetSets?: number;
  lastPerformance: LoggedSet[];
  logged: LoggedSet[];
  defaultUnit: WeightUnit;
  /** Signed count of rows the user added or removed this session. */
  adjust?: number;
}

export function planSets(input: PlanSetsInput): PlannedSet[];
```

This task depends on nothing and may run in parallel with Tasks 2 and 5.

- [ ] **Step 1: Write the failing tests**

Create `src/domain/setPlan.test.ts`:

```ts
import type { LoggedSet, SetType, WeightUnit } from '../db/types';
import { planSets } from './setPlan';

let nextId = 0;

function set(
  weight: number,
  reps: number,
  setType: SetType = 'working',
  unit: WeightUnit = 'lb',
): LoggedSet {
  nextId += 1;
  return {
    id: `set-${nextId}`,
    sessionId: 's',
    exerciseId: 'bench',
    order: nextId,
    setType,
    unit,
    weight,
    reps,
    completedAt: nextId,
  };
}

const base = { lastPerformance: [], logged: [], defaultUnit: 'lb' as const };

it('offers one empty row when there is no target and no history', () => {
  expect(planSets(base)).toEqual([{ position: 1, unit: 'lb' }]);
});

it('offers a row per target set when there is no history', () => {
  const rows = planSets({ ...base, targetSets: 4 });
  expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
  expect(rows.every((r) => r.weight === undefined)).toBe(true);
});

it('matches last time’s set count when there is no target', () => {
  const rows = planSets({ ...base, lastPerformance: [set(135, 8), set(135, 8), set(145, 6)] });
  expect(rows.map((r) => r.weight)).toEqual([135, 135, 145]);
});

it('prefills row N from last time’s working set N', () => {
  const rows = planSets({
    ...base,
    targetSets: 3,
    lastPerformance: [set(135, 8), set(135, 8), set(145, 6)],
  });
  expect(rows.map((r) => [r.weight, r.reps])).toEqual([[135, 8], [135, 8], [145, 6]]);
});

it('falls back to last time’s final set when it had fewer', () => {
  const rows = planSets({
    ...base,
    targetSets: 4,
    lastPerformance: [set(135, 8), set(135, 8), set(145, 6)],
  });
  expect(rows.map((r) => r.weight)).toEqual([135, 135, 145, 145]);
});

it('drops rows for working sets already logged', () => {
  const rows = planSets({
    ...base,
    targetSets: 4,
    lastPerformance: [set(135, 8), set(135, 8), set(145, 6), set(145, 6)],
    logged: [set(135, 8), set(135, 8)],
  });
  expect(rows.map((r) => r.position)).toEqual([3, 4]);
  expect(rows.map((r) => r.weight)).toEqual([145, 145]);
});

it('does not let a logged warm-up consume a planned row', () => {
  const rows = planSets({
    ...base,
    targetSets: 3,
    logged: [set(45, 10, 'warmup')],
  });
  expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
});

it('skips last time’s warm-ups when matching positions', () => {
  const rows = planSets({
    ...base,
    targetSets: 2,
    lastPerformance: [set(45, 10, 'warmup'), set(135, 8), set(145, 6)],
  });
  expect(rows.map((r) => r.weight)).toEqual([135, 145]);
});

it('returns no rows once the target is met', () => {
  const rows = planSets({
    ...base,
    targetSets: 2,
    logged: [set(135, 8), set(135, 8)],
  });
  expect(rows).toEqual([]);
});

it('clamps rather than going negative when more sets are logged than prescribed', () => {
  const rows = planSets({
    ...base,
    targetSets: 2,
    logged: [set(135, 8), set(135, 8), set(135, 8)],
  });
  expect(rows).toEqual([]);
});

it('adds a row when the user adds a set', () => {
  const rows = planSets({ ...base, targetSets: 3, adjust: 1 });
  expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
});

it('removes a row when the user removes a planned set', () => {
  const rows = planSets({ ...base, targetSets: 3, adjust: -1 });
  expect(rows.map((r) => r.position)).toEqual([1, 2]);
});

it('never hides a logged set by removing rows', () => {
  const rows = planSets({
    ...base,
    targetSets: 3,
    adjust: -5,
    logged: [set(135, 8), set(135, 8)],
  });
  expect(rows).toEqual([]);
});

it('carries last time’s unit rather than the default', () => {
  const rows = planSets({
    ...base,
    lastPerformance: [set(60, 8, 'working', 'kg')],
  });
  expect(rows[0].unit).toBe('kg');
});

it('uses the default unit when there is nothing to carry', () => {
  expect(planSets({ ...base, defaultUnit: 'kg' })[0].unit).toBe('kg');
});

it('carries duration and distance, not just weight', () => {
  const sprint: LoggedSet = {
    id: 'a', sessionId: 's', exerciseId: 'run', order: 0, setType: 'working',
    unit: 'lb', distanceMeters: 400, durationSeconds: 90, completedAt: 1,
  };
  const rows = planSets({ ...base, lastPerformance: [sprint] });
  expect(rows[0].distanceMeters).toBe(400);
  expect(rows[0].durationSeconds).toBe(90);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/setPlan.test.ts`
Expected: FAIL — `Failed to resolve import "./setPlan"`.

- [ ] **Step 3: Implement `planSets`**

Create `src/domain/setPlan.ts`:

```ts
import type { LoggedSet, WeightUnit } from '../db/types';

/**
 * A row the user has not confirmed yet.
 *
 * Deliberately not a LoggedSet: nothing reaches the sets table until the
 * user taps confirm, so PR detection, volume, history and the backup format
 * never have to filter out sets that were not performed. A filter bug there
 * would render as a fake PR.
 */
export interface PlannedSet {
  /** 1-based working-set number shown to the user. */
  position: number;
  unit: WeightUnit;
  weight?: number;
  reps?: number;
  durationSeconds?: number;
  distanceMeters?: number;
}

export interface PlanSetsInput {
  /** RoutineItem.targetSets, when the routine prescribes one. */
  targetSets?: number;
  /** This exercise's sets from the previous session, warm-ups included. */
  lastPerformance: LoggedSet[];
  /** This exercise's sets already logged in the current session. */
  logged: LoggedSet[];
  /** Settings.unitPreference, used when there is no history to carry. */
  defaultUnit: WeightUnit;
  /** Signed count of rows the user added or removed this session. */
  adjust?: number;
}

function working(sets: LoggedSet[]): LoggedSet[] {
  return sets
    .filter((s) => s.setType === 'working')
    .sort((a, b) => a.order - b.order);
}

/**
 * Derives the unconfirmed rows for one exercise.
 *
 * Count is the prescription, else last time's working-set count, else one.
 * Row N prefills from last time's working set N, falling back to its final
 * set — which preserves last week's ramp, so 135/135/145 leaves 145 waiting
 * on set 3 rather than repeating 135.
 *
 * Warm-ups are additive at both ends: one logged today does not consume a
 * planned row, and one logged last time does not shift the positions.
 */
export function planSets(input: PlanSetsInput): PlannedSet[] {
  const { targetSets, lastPerformance, logged, defaultUnit, adjust = 0 } = input;

  const lastWorking = working(lastPerformance);
  const doneCount = working(logged).length;

  const prescribed =
    targetSets !== undefined && targetSets > 0 ? targetSets : lastWorking.length || 1;

  // Clamped at doneCount, never below: removing rows must not hide a set
  // that was actually performed.
  const total = Math.max(doneCount, prescribed + adjust);

  const rows: PlannedSet[] = [];
  for (let position = doneCount + 1; position <= total; position += 1) {
    const source = lastWorking[position - 1] ?? lastWorking[lastWorking.length - 1];
    rows.push({
      position,
      unit: source?.unit ?? defaultUnit,
      weight: source?.weight,
      reps: source?.reps,
      durationSeconds: source?.durationSeconds,
      distanceMeters: source?.distanceMeters,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/setPlan.test.ts`
Expected: PASS — 16 tests.

Note the first test asserts `toEqual({ position: 1, unit: 'lb' })` against an object that also carries four `undefined` properties. Vitest's `toEqual` ignores `undefined` properties, so this passes. If it does not, use `toMatchObject`.

- [ ] **Step 5: Commit**

```bash
git add src/domain/setPlan.ts src/domain/setPlan.test.ts
git commit -m "feat: derive the planned sets for an exercise"
```

---

## Task 4: Prescription on routine items

**Files:**
- Modify: `src/db/routines.ts` (add `updateRoutineItems`)
- Modify: `src/db/routines.test.ts`
- Modify: `src/domain/routineItems.ts` (add `setItemPrescription`, `validatePrescription`)
- Modify: `src/domain/routineItems.test.ts`
- Modify: `src/ui/routines/RoutineEditor.tsx`
- Modify: `src/ui/routines/RoutineEditor.test.tsx`

**Interfaces:**

- Consumes: `RoutineItem` from `src/db/types`; `addItem`, `moveItem`, `removeItem` from `src/domain/routineItems`; `getRoutine` from `src/db/routines`.
- Produces:

```ts
// src/domain/routineItems.ts
export interface Prescription {
  targetSets?: number;
  targetRepMin?: number;
  targetRepMax?: number;
  restSeconds?: number;
}
export function setItemPrescription(
  items: RoutineItem[],
  itemId: string,
  patch: Prescription,
): RoutineItem[];
export function validatePrescription(patch: Prescription): string | null;

// src/db/routines.ts
export function updateRoutineItems(
  id: string,
  mutate: (items: RoutineItem[]) => RoutineItem[],
): Promise<void>;
```

- [ ] **Step 1: Write the failing tests for the pure prescription helpers**

Append to `src/domain/routineItems.test.ts`, extending its import line to include `setItemPrescription` and `validatePrescription`:

```ts
describe('setItemPrescription', () => {
  const items = [
    { id: 'a', exerciseId: 'bench', order: 0 },
    { id: 'b', exerciseId: 'row', order: 1 },
  ];

  it('applies the patch to the named item only', () => {
    const next = setItemPrescription(items, 'a', { targetSets: 4 });
    expect(next[0].targetSets).toBe(4);
    expect(next[1].targetSets).toBeUndefined();
  });

  it('merges into an existing prescription', () => {
    const withSets = setItemPrescription(items, 'a', { targetSets: 4 });
    const next = setItemPrescription(withSets, 'a', { targetRepMin: 6 });
    expect(next[0].targetSets).toBe(4);
    expect(next[0].targetRepMin).toBe(6);
  });

  it('deletes the key when a field is cleared, rather than storing undefined', () => {
    const withSets = setItemPrescription(items, 'a', { targetSets: 4 });
    const next = setItemPrescription(withSets, 'a', { targetSets: undefined });
    expect('targetSets' in next[0]).toBe(false);
  });

  it('leaves order and exerciseId untouched', () => {
    const next = setItemPrescription(items, 'b', { restSeconds: 120 });
    expect(next[1].order).toBe(1);
    expect(next[1].exerciseId).toBe('row');
  });

  it('returns the list unchanged for an unknown item', () => {
    expect(setItemPrescription(items, 'missing', { targetSets: 4 })).toEqual(items);
  });
});

describe('validatePrescription', () => {
  it('accepts an empty patch', () => {
    expect(validatePrescription({})).toBeNull();
  });

  it('accepts a complete, ordered prescription', () => {
    expect(validatePrescription({
      targetSets: 4, targetRepMin: 6, targetRepMax: 8, restSeconds: 120,
    })).toBeNull();
  });

  it('rejects a rep range that runs backwards', () => {
    expect(validatePrescription({ targetRepMin: 8, targetRepMax: 6 }))
      .toMatch(/rep range/i);
  });

  it('accepts a single-value rep range', () => {
    expect(validatePrescription({ targetRepMin: 8, targetRepMax: 8 })).toBeNull();
  });

  it('rejects zero and negative values', () => {
    expect(validatePrescription({ targetSets: 0 })).toMatch(/whole number/i);
    expect(validatePrescription({ restSeconds: -30 })).toMatch(/whole number/i);
  });

  it('rejects fractional values', () => {
    expect(validatePrescription({ targetSets: 2.5 })).toMatch(/whole number/i);
  });

  it('ignores the range check when only one end is set', () => {
    expect(validatePrescription({ targetRepMin: 8 })).toBeNull();
    expect(validatePrescription({ targetRepMax: 6 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/routineItems.test.ts`
Expected: FAIL — `setItemPrescription is not a function`.

- [ ] **Step 3: Implement the pure prescription helpers**

Append to `src/domain/routineItems.ts`:

```ts
/** The per-item target: "4 x 6-8, 2 min rest". */
export interface Prescription {
  targetSets?: number;
  targetRepMin?: number;
  targetRepMax?: number;
  restSeconds?: number;
}

const FIELDS: Array<keyof Prescription> = [
  'targetSets', 'targetRepMin', 'targetRepMax', 'restSeconds',
];

/**
 * Merges a prescription patch into one item.
 *
 * A cleared field deletes its key rather than storing `undefined`. Both
 * round-trip through IndexedDB, but an absent key is what every reader
 * already tests for, and it keeps exported backups free of null-ish noise.
 */
export function setItemPrescription(
  items: RoutineItem[],
  itemId: string,
  patch: Prescription,
): RoutineItem[] {
  return items.map((item) => {
    if (item.id !== itemId) return item;

    const next: RoutineItem = { ...item };
    for (const field of FIELDS) {
      if (!(field in patch)) continue;
      const value = patch[field];
      if (value === undefined) delete next[field];
      else next[field] = value;
    }
    return next;
  });
}

/**
 * Returns an error message, or null when the patch is storable.
 *
 * Pure and separate from the write so the editor can show the problem
 * without a database round-trip, and so the rules are testable without one.
 */
export function validatePrescription(patch: Prescription): string | null {
  for (const field of FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1) {
      return 'Targets must be a whole number of 1 or more.';
    }
  }

  const { targetRepMin: min, targetRepMax: max } = patch;
  if (min !== undefined && max !== undefined && min > max) {
    return 'The rep range runs backwards — the low end must not exceed the high end.';
  }

  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/routineItems.test.ts`
Expected: PASS — the 12 new tests plus the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/domain/routineItems.ts src/domain/routineItems.test.ts
git commit -m "feat: set and validate a routine item's prescription"
```

- [ ] **Step 6: Write the failing tests for `updateRoutineItems`**

Append to `src/db/routines.test.ts`, extending its import line to include `updateRoutineItems`:

```ts
describe('updateRoutineItems', () => {
  it('applies the mutator to the stored items', async () => {
    const routine = await createRoutine('Push A');
    await setRoutineItems(routine.id, [{ id: 'a', exerciseId: 'bench', order: 0 }]);

    await updateRoutineItems(routine.id, (items) =>
      items.map((i) => ({ ...i, targetSets: 4 })),
    );

    expect((await getRoutine(routine.id))?.items[0].targetSets).toBe(4);
  });

  it('bumps updatedAt', async () => {
    const routine = await createRoutine('Push A');
    const before = (await getRoutine(routine.id))!.updatedAt;

    await new Promise((r) => setTimeout(r, 2));
    await updateRoutineItems(routine.id, (items) => items);

    expect((await getRoutine(routine.id))!.updatedAt).toBeGreaterThan(before);
  });

  it('reads fresh items rather than trusting a stale caller array', async () => {
    // The Plan 2 finding: two fast taps recompute from an array captured at
    // render, so the second silently discards the first. Reading inside the
    // transaction makes both land.
    const routine = await createRoutine('Push A');
    await setRoutineItems(routine.id, [
      { id: 'a', exerciseId: 'bench', order: 0 },
      { id: 'b', exerciseId: 'row', order: 1 },
    ]);

    await updateRoutineItems(routine.id, (items) => items.filter((i) => i.id === 'a'));
    await updateRoutineItems(routine.id, (items) => items.filter((i) => i.id !== 'a'));

    expect((await getRoutine(routine.id))?.items).toEqual([]);
  });

  it('rejects an unknown routine', async () => {
    await expect(updateRoutineItems('nope', (items) => items)).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run src/db/routines.test.ts`
Expected: FAIL — `updateRoutineItems is not a function`.

- [ ] **Step 8: Implement `updateRoutineItems`**

Add to `src/db/routines.ts`, directly below `setRoutineItems`:

```ts
/**
 * Read-modify-write of a routine's items, inside one transaction.
 *
 * Prefer this over setRoutineItems from UI handlers. A handler that computes
 * the next array from one captured at render works from stale input the
 * moment a second tap lands before the first write completes, silently
 * discarding the earlier change — the deferred Plan 2 finding. Passing a
 * mutator instead means the array is always read fresh.
 *
 * setRoutineItems remains for callers that genuinely mean "these exact
 * items", chiefly test fixtures.
 */
export async function updateRoutineItems(
  id: string,
  mutate: (items: RoutineItem[]) => RoutineItem[],
): Promise<void> {
  await db.transaction('rw', db.routines, async () => {
    const routine = await db.routines.get(id);
    if (!routine) throw new Error('Routine not found');
    await db.routines.update(id, {
      items: mutate(routine.items),
      updatedAt: Date.now(),
    });
  });
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/db/routines.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/db/routines.ts src/db/routines.test.ts
git commit -m "feat: mutate routine items inside a transaction"
```

- [ ] **Step 11: Write the failing tests for the editor's prescription inputs**

Append to `src/ui/routines/RoutineEditor.test.tsx`. That file already provides
`renderAt(routineId)` and `seedExercise(name)` — which builds a chest / barbell /
`weight_reps` exercise, exactly the shape these tests need. Use both rather than
inlining new ones.

Its imports already include `getRoutine`. Add only what is missing: `waitFor` to the
`@testing-library/react` import, and `archiveExercise` to the `../../db/exercises`
import.

```tsx
it('saves a prescription when the field loses focus', async () => {
  const user = userEvent.setup();
  const ex = await seedExercise('Barbell Bench Press');
  const routine = await createRoutine('Push A');
  await setRoutineItems(routine.id, [{ id: 'i1', exerciseId: ex.id, order: 0 }]);

  renderAt(routine.id);

  const sets = await screen.findByLabelText(/sets for barbell bench press/i);
  await user.type(sets, '4');
  await user.tab();

  await waitFor(async () => {
    expect((await getRoutine(routine.id))?.items[0].targetSets).toBe(4);
  });
});

it('shows the stored prescription when the editor opens', async () => {
  const ex = await seedExercise('Barbell Bench Press');
  const routine = await createRoutine('Push A');
  await setRoutineItems(routine.id, [
    { id: 'i1', exerciseId: ex.id, order: 0, targetSets: 4, targetRepMin: 6, targetRepMax: 8 },
  ]);

  renderAt(routine.id);

  expect(await screen.findByLabelText(/^sets for barbell bench press/i)).toHaveValue(4);
  expect(screen.getByLabelText(/lowest reps for barbell bench press/i)).toHaveValue(6);
  expect(screen.getByLabelText(/highest reps for barbell bench press/i)).toHaveValue(8);
});

it('refuses a backwards rep range and does not write it', async () => {
  const user = userEvent.setup();
  const ex = await seedExercise('Barbell Bench Press');
  const routine = await createRoutine('Push A');
  await setRoutineItems(routine.id, [
    { id: 'i1', exerciseId: ex.id, order: 0, targetRepMax: 6 },
  ]);

  renderAt(routine.id);

  const min = await screen.findByLabelText(/lowest reps for barbell bench press/i);
  await user.type(min, '8');
  await user.tab();

  expect(await screen.findByRole('alert')).toHaveTextContent(/rep range/i);
  expect((await getRoutine(routine.id))?.items[0].targetRepMin).toBeUndefined();
});

it('clears a prescription field when it is emptied', async () => {
  const user = userEvent.setup();
  const ex = await seedExercise('Barbell Bench Press');
  const routine = await createRoutine('Push A');
  await setRoutineItems(routine.id, [
    { id: 'i1', exerciseId: ex.id, order: 0, targetSets: 4 },
  ]);

  renderAt(routine.id);

  const sets = await screen.findByLabelText(/^sets for barbell bench press/i);
  await user.clear(sets);
  await user.tab();

  await waitFor(async () => {
    expect((await getRoutine(routine.id))?.items[0].targetSets).toBeUndefined();
  });
});

it('marks an archived exercise so it is not mistaken for an active one', async () => {
  const ex = await seedExercise('Barbell Bench Press');
  await archiveExercise(ex.id);
  const routine = await createRoutine('Push A');
  await setRoutineItems(routine.id, [{ id: 'i1', exerciseId: ex.id, order: 0 }]);

  renderAt(routine.id);

  expect(await screen.findByText(/archived/i)).toBeInTheDocument();
});
```

- [ ] **Step 12: Run the tests to verify they fail**

Run: `npx vitest run src/ui/routines/RoutineEditor.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: /sets for barbell bench press/i`.

- [ ] **Step 13: Add the prescription inputs and route the handlers through `updateRoutineItems`**

In `src/ui/routines/RoutineEditor.tsx`:

Replace the import of `setRoutineItems` with `updateRoutineItems`, and extend the `routineItems` import:

```tsx
import { getRoutine, renameRoutine, updateRoutineItems } from '../../db/routines';
import {
  addItem, moveItem, removeItem, setItemPrescription, validatePrescription,
  type Prescription,
} from '../../domain/routineItems';
```

Add local state beside `draftName`:

```tsx
// Draft values keyed by `${itemId}:${field}`, so typing stays smooth and the
// stored value shows through until the user edits. Same shape as draftName:
// deriving the displayed value removes the seeding effect entirely, which
// could otherwise fire after the user started typing and discard their input.
const [drafts, setDrafts] = useState<Record<string, string>>({});
const [prescriptionError, setPrescriptionError] = useState<string | null>(null);
```

Add a lookup for archived exercises, beside `nameById`:

```tsx
const archivedIds = new Set(exercises.filter((e) => e.isArchived).map((e) => e.id));
```

Hoist the field table to module scope, above the component, so it is not rebuilt on every render:

```tsx
const PRESCRIPTION_FIELDS = [
  { field: 'targetSets', fieldLabel: 'Sets' },
  { field: 'targetRepMin', fieldLabel: 'Lowest reps' },
  { field: 'targetRepMax', fieldLabel: 'Highest reps' },
  { field: 'restSeconds', fieldLabel: 'Rest seconds' },
] as const;
```

Add the read and commit helpers inside the component, after `saveName`:

```tsx
  function prescriptionValue(itemId: string, field: keyof Prescription): string {
    const key = `${itemId}:${field}`;
    if (key in drafts) return drafts[key];
    const stored = items.find((i) => i.id === itemId)?.[field];
    return stored === undefined ? '' : String(stored);
  }

  // Commits on blur rather than behind a button. Four fields per item would
  // otherwise need a Save button per item, and updateRoutineItems makes
  // overlapping commits safe.
  async function commitPrescription(itemId: string, field: keyof Prescription) {
    const key = `${itemId}:${field}`;
    if (!(key in drafts)) return;

    const raw = drafts[key].trim();
    const value = raw === '' ? undefined : Number(raw);

    const item = items.find((i) => i.id === itemId);
    const merged: Prescription = {
      targetSets: item?.targetSets,
      targetRepMin: item?.targetRepMin,
      targetRepMax: item?.targetRepMax,
      restSeconds: item?.restSeconds,
      [field]: value,
    };

    const problem = value !== undefined && Number.isNaN(value)
      ? 'Targets must be a whole number of 1 or more.'
      : validatePrescription(merged);

    if (problem) {
      setPrescriptionError(problem);
      return;
    }

    setPrescriptionError(null);
    setDrafts((d) => {
      const { [key]: _committed, ...rest } = d;
      return rest;
    });
    await run(() =>
      updateRoutineItems(currentId, (current) =>
        setItemPrescription(current, itemId, { [field]: value }),
      ),
    );
  }
```

Inside the existing `items.map(...)` callback the exercise name is already bound as
`const label = nameById.get(item.exerciseId) ?? 'Unknown exercise'` — which is why the
field table above names its display text `fieldLabel` rather than `label`.

Add the archived marker beside the name, replacing the existing `<span>`:

```tsx
<span data-testid="routine-item-name">{label}</span>
{archivedIds.has(item.exerciseId) && <span> (archived)</span>}
```

and render the four inputs inside the same `<li>`, after the Remove button:

```tsx
<div className="prescription">
  {PRESCRIPTION_FIELDS.map(({ field, fieldLabel }) => (
    <label key={field}>
      <span>{fieldLabel}</span>
      <input
        type="number"
        min={1}
        aria-label={`${fieldLabel} for ${label}`}
        value={prescriptionValue(item.id, field)}
        onChange={(e) =>
          setDrafts((d) => ({ ...d, [`${item.id}:${field}`]: e.target.value }))
        }
        onBlur={() => void commitPrescription(item.id, field)}
      />
    </label>
  ))}
</div>
```

The `aria-label` the tests look for is built from those two: `Sets for Barbell Bench Press`,
`Lowest reps for Barbell Bench Press`, and so on.

Render the validation message beside the existing write error, near the top of the form:

```tsx
{prescriptionError && <p role="alert">{prescriptionError}</p>}
```

Finally, change the three existing item handlers from `setRoutineItems(currentId, moveItem(items, ...))` to the mutator form:

```tsx
onClick={() => run(() => updateRoutineItems(currentId, (current) => moveItem(current, item.id, 'up')))}
onClick={() => run(() => updateRoutineItems(currentId, (current) => moveItem(current, item.id, 'down')))}
onClick={() => run(() => updateRoutineItems(currentId, (current) => removeItem(current, item.id)))}
```

and the picker's add handler:

```tsx
onSelect={(exercise) =>
  run(() =>
    updateRoutineItems(currentId, (current) =>
      addItem(current, exercise.id, crypto.randomUUID()),
    ),
  )
}
```

- [ ] **Step 14: Run the editor tests to verify they pass**

Run: `npx vitest run src/ui/routines/RoutineEditor.test.tsx`
Expected: PASS — the five new tests plus every pre-existing one.

- [ ] **Step 15: Run the full suite and commit**

Run: `npx vitest run --fileParallelism=false`
Expected: PASS.

```bash
git add src/ui/routines/RoutineEditor.tsx src/ui/routines/RoutineEditor.test.tsx
git commit -m "feat: set per-item targets and rest in the routine editor"
```

---

## Task 5: Editing bundled exercises

**Files:**
- Modify: `src/db/exercises.ts` (add `resetExerciseToBundled`; correct the stale comment)
- Modify: `src/db/exercises.test.ts`
- Modify: `src/ui/library/LibraryScreen.tsx` (open the form for bundled entries)
- Modify: `src/ui/library/LibraryScreen.test.tsx`
- Modify: `src/ui/library/CustomExerciseForm.tsx` (Reset to bundled; surface archive errors)
- Modify: `src/ui/library/CustomExerciseForm.test.tsx`

**Interfaces:**

- Consumes: `updateExercise` from `src/db/exercises`; the bundled library at `src/data/exercises.json`.
- Produces: `export function resetExerciseToBundled(id: string): Promise<void>;`

This task depends on nothing and may run in parallel with Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests for `resetExerciseToBundled`**

Append to `src/db/exercises.test.ts`, extending its import line to include `resetExerciseToBundled` and `getExercise`:

```ts
import bundled from '../data/exercises.json';
import type { Exercise } from './types';
import { prepareLibrary } from './seed';

describe('resetExerciseToBundled', () => {
  const original = (bundled as Exercise[])[0];

  beforeEach(async () => {
    await prepareLibrary();
  });

  it('restores every field the user changed', async () => {
    await updateExercise(original.id, {
      name: 'Renamed',
      measurementType: 'duration',
      equipment: 'other',
    });

    await resetExerciseToBundled(original.id);

    const restored = await getExercise(original.id);
    expect(restored?.name).toBe(original.name);
    expect(restored?.measurementType).toBe(original.measurementType);
    expect(restored?.equipment).toBe(original.equipment);
    expect(restored?.primaryMuscles).toEqual(original.primaryMuscles);
  });

  it('keeps the row bundled', async () => {
    await resetExerciseToBundled(original.id);
    expect((await getExercise(original.id))?.isCustom).toBe(false);
  });

  it('does not un-archive a reset exercise', async () => {
    // Resetting restores the exercise's data, not the user's decision to
    // hide it. Un-archiving is a separate, explicit action.
    await archiveExercise(original.id);
    await resetExerciseToBundled(original.id);
    expect((await getExercise(original.id))?.isArchived).toBe(true);
  });

  it('refuses an exercise that is not part of the bundled library', async () => {
    const custom = await createCustomExercise({
      name: 'Explosive Box Step-Up',
      primaryMuscles: ['quads'],
      secondaryMuscles: [],
      equipment: 'bodyweight',
      measurementType: 'bodyweight_reps',
    });

    await expect(resetExerciseToBundled(custom.id)).rejects.toThrow(/bundled/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/db/exercises.test.ts`
Expected: FAIL — `resetExerciseToBundled is not a function`.

- [ ] **Step 3: Implement `resetExerciseToBundled` and correct the stale comment**

In `src/db/exercises.ts`, add the bundled import at the top:

```ts
import bundled from '../data/exercises.json';
```

Replace the second paragraph of the comment inside `updateExercise` — the one beginning "isCustom is stripped for a different reason" — with:

```ts
  // isCustom is stripped for a different reason: a bundled row claiming to
  // be custom would mislabel itself in the library list and in the filters.
  // (An earlier version of this comment blamed a seed gate that counted
  // non-custom rows. prepareLibrary replaced it and is keyed on ids, so that
  // gate no longer exists — the strip is still right, the reason was stale.)
```

Add at the end of the file:

```ts
/**
 * Restores a bundled exercise to the data shipped with this build.
 *
 * Bundled entries are editable — renaming Side to Side Box Shuffle to
 * Lateral Shuffle, or retyping a timed drill mistyped as rep-counted, is the
 * point. Reset is the escape hatch, and it is cheap because all 650 entries
 * ship inside the app bundle: restoring one is a lookup, not a download.
 *
 * Deliberately does not restore isArchived. Resetting an exercise's data is
 * not the same as undoing the user's decision to hide it.
 */
export async function resetExerciseToBundled(id: string): Promise<void> {
  const original = (bundled as Exercise[]).find((e) => e.id === id);
  if (!original) {
    throw new Error('That exercise is not part of the bundled library.');
  }

  const {
    id: _id, isCustom: _isCustom, isArchived: _isArchived, ...fields
  } = original;
  await updateExercise(id, fields);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/db/exercises.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/exercises.ts src/db/exercises.test.ts
git commit -m "feat: reset a bundled exercise to its shipped data"
```

- [ ] **Step 6: Write the failing tests for the Library and form changes**

`src/ui/library/LibraryScreen.test.tsx` renders directly with `render(<LibraryScreen />)`
— it has no render helper. Add `db` to its imports from `../../db/db`, then append:

```tsx
it('opens the edit form for a bundled exercise', async () => {
  const user = userEvent.setup();
  // One bundled-shaped row inserted directly rather than seeding all 650.
  // Seeding would make the click ambiguous — many bundled names share a
  // prefix, and some contain regex metacharacters.
  await db.exercises.add({
    id: 'side-to-side-box-shuffle',
    name: 'Side to Side Box Shuffle',
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: 'other',
    measurementType: 'bodyweight_reps',
    isCustom: false,
    isArchived: false,
  });

  render(<LibraryScreen />);

  await user.click(
    await screen.findByRole('button', { name: /side to side box shuffle/i }),
  );

  expect(await screen.findByRole('heading', { name: /edit exercise/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/exercise name/i)).toHaveValue('Side to Side Box Shuffle');
});
```

`src/ui/library/CustomExerciseForm.test.tsx` already imports `createCustomExercise`,
`listExercises` and `getExercise`. Add `waitFor` to the `@testing-library/react`
import, `updateExercise` to the `../../db/exercises` import, and
`import { prepareLibrary } from '../../db/seed';`. Then append:

```tsx
it('offers Reset to bundled only for bundled exercises', async () => {
  await prepareLibrary();
  const bundledExercise = (await listExercises()).find((e) => !e.isCustom)!;

  render(
    <CustomExerciseForm existing={bundledExercise} onDone={vi.fn()} onCancel={vi.fn()} />,
  );

  expect(screen.getByRole('button', { name: /reset to bundled/i })).toBeInTheDocument();
});

it('hides Reset to bundled for custom exercises', async () => {
  const custom = await createCustomExercise({
    name: 'Explosive Box Step-Up',
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: 'bodyweight',
    measurementType: 'bodyweight_reps',
  });

  render(<CustomExerciseForm existing={custom} onDone={vi.fn()} onCancel={vi.fn()} />);

  expect(screen.queryByRole('button', { name: /reset to bundled/i })).toBeNull();
});

it('restores the shipped data when reset is pressed', async () => {
  const user = userEvent.setup();
  await prepareLibrary();
  const original = (await listExercises()).find((e) => !e.isCustom)!;
  await updateExercise(original.id, { name: 'Renamed', measurementType: 'duration' });
  const edited = (await getExercise(original.id))!;

  const onDone = vi.fn();
  render(<CustomExerciseForm existing={edited} onDone={onDone} onCancel={vi.fn()} />);

  await user.click(screen.getByRole('button', { name: /reset to bundled/i }));

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  const restored = await getExercise(original.id);
  expect(restored?.name).toBe(original.name);
  expect(restored?.measurementType).toBe(original.measurementType);
});

it('waits for the archive write before closing the form', async () => {
  // handleArchive was fire-and-forget: it called onDone without awaiting, so a
  // rejected write closed the form as though it had succeeded. Asserting that
  // the row is archived by the time onDone fires pins the await.
  const user = userEvent.setup();
  const custom = await createCustomExercise({
    name: 'Explosive Box Step-Up',
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: 'bodyweight',
    measurementType: 'bodyweight_reps',
  });
  const onDone = vi.fn();

  render(<CustomExerciseForm existing={custom} onDone={onDone} onCancel={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /archive/i }));

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect((await getExercise(custom.id))?.isArchived).toBe(true);
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run src/ui/library/`
Expected: FAIL — the bundled exercise does not open the form, and no Reset button exists.

- [ ] **Step 8: Open the form for bundled exercises**

In `src/ui/library/LibraryScreen.tsx`, change the gate:

```tsx
<ExerciseBrowser
  onSelect={(e) => setEditing(e)}
```

- [ ] **Step 9: Add Reset to bundled and make archive surface its errors**

In `src/ui/library/CustomExerciseForm.tsx`, extend the import:

```tsx
import {
  archiveExercise, createCustomExercise, resetExerciseToBundled, updateExercise,
} from '../../db/exercises';
```

Replace `handleArchive` and add `handleReset`:

```tsx
  // Was fire-and-forget: it predates useWriteError and on rejection the user
  // saw nothing while the form closed as though it had worked. This form
  // already owns an `error` state, so it uses that rather than introducing a
  // second error surface inside one component.
  async function handleArchive() {
    if (!existing) return;
    setError(null);
    try {
      await archiveExercise(existing.id);
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleReset() {
    if (!existing) return;
    setError(null);
    try {
      await resetExerciseToBundled(existing.id);
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
```

Add the button beside Archive:

```tsx
      {existing && !existing.isCustom && (
        <button type="button" onClick={handleReset}>Reset to bundled</button>
      )}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run src/ui/library/`
Expected: PASS.

- [ ] **Step 11: Run the full suite and commit**

Run: `npx vitest run --fileParallelism=false`
Expected: PASS.

```bash
git add src/ui/library/
git commit -m "feat: edit and reset bundled exercises"
```

---

## Task 6: The Active Session screen

**Files:**
- Create: `src/ui/session/ActiveSessionScreen.tsx`
- Create: `src/ui/session/ActiveSessionScreen.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**

- Consumes: `getInProgressSession` from `src/db/sessions`; `listSetsForSession`, `lastPerformance`, `logSet`, `deleteSet` from `src/db/sets`; `getSettings` from `src/db/settings`; `getRoutine` from `src/db/routines`; `listExercises` from `src/db/exercises`; `planSets` from `src/domain/setPlan`; `measurementFields`, `formatSet`, `formatDuration` from `src/domain/measurement`; `useWriteError` from `src/ui/useWriteError`.
- Produces: `export function ActiveSessionScreen(): JSX.Element;` mounted at `/session`.

Task 8 extends this same component. This task stops short of Add exercise, Finish and Discard.

- [ ] **Step 1: Write the failing test for the redirect guard**

Create `src/ui/session/ActiveSessionScreen.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise } from '../../db/exercises';
import { createRoutine, setRoutineItems } from '../../db/routines';
import { startSession } from '../../db/sessions';
import { listSetsForSession, logSet } from '../../db/sets';
import { ActiveSessionScreen } from './ActiveSessionScreen';

beforeEach(async () => {
  await resetDbForTests();
});

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/session']}>
      <Routes>
        <Route path="/session" element={<ActiveSessionScreen />} />
        <Route path="/" element={<p>Today screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function benchRoutine(name = 'Push A', targetSets?: number) {
  const exercise = await createCustomExercise({
    name: 'Barbell Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType: 'weight_reps',
  });
  const routine = await createRoutine(name);
  const items = [{ id: 'i1', exerciseId: exercise.id, order: 0, targetSets }];
  await setRoutineItems(routine.id, items);
  return { exercise, routine, items };
}

it('redirects to Today when no session is in progress', async () => {
  renderScreen();
  expect(await screen.findByText('Today screen')).toBeInTheDocument();
});

it('never creates a session of its own', async () => {
  const { db } = await import('../../db/db');
  renderScreen();
  await screen.findByText('Today screen');
  expect(await db.sessions.count()).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./ActiveSessionScreen"`.

- [ ] **Step 3: Create the screen with its loading and redirect states**

Create `src/ui/session/ActiveSessionScreen.tsx`:

```tsx
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getInProgressSession } from '../../db/sessions';
import { getRoutine } from '../../db/routines';
import { listExercises } from '../../db/exercises';
import { getSettings } from '../../db/settings';
import { lastPerformance, listSetsForSession } from '../../db/sets';
import { useWriteError } from '../useWriteError';

export function ActiveSessionScreen() {
  const { error, run } = useWriteError();

  // One querier rather than several chained ones: splitting the session read
  // from the routine read would make the second lag a render behind the
  // first, flashing an empty screen on every write.
  //
  // Every call in here is read-only. Dexie throws ReadOnlyError if a
  // liveQuery querier opens a readwrite transaction, so this screen creates
  // nothing — Today starts the session, and landing here without one
  // redirects rather than starting one.
  const data = useLiveQuery(async () => {
    const session = await getInProgressSession();
    if (!session) return null;

    const routine = session.routineId ? (await getRoutine(session.routineId)) ?? null : null;
    const [sets, exercises, settings] = await Promise.all([
      listSetsForSession(session.id),
      listExercises({ includeArchived: true }),
      getSettings(),
    ]);

    const exerciseIds = new Set([
      ...(routine?.items ?? []).map((i) => i.exerciseId),
      ...sets.map((s) => s.exerciseId),
    ]);
    const history = Object.fromEntries(
      await Promise.all(
        [...exerciseIds].map(async (id) =>
          [id, await lastPerformance(id, session.id)] as const,
        ),
      ),
    );

    return { session, routine, sets, exercises, settings, history };
  }, []);

  if (data === undefined) return <p>Loading…</p>;
  if (data === null) return <Navigate to="/" replace />;

  return (
    <section>
      <h2>{data.session.name}</h2>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
```

Add the route in `src/App.tsx`:

```tsx
import { ActiveSessionScreen } from './ui/session/ActiveSessionScreen';
```

```tsx
<Route path="/session" element={<ActiveSessionScreen />} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/session/ src/App.tsx
git commit -m "feat: add the active session route with its redirect guard"
```

- [ ] **Step 6: Write the failing tests for the exercise strip and focus**

Append to `src/ui/session/ActiveSessionScreen.test.tsx`:

```tsx
it('lists the routine’s exercises and focuses the first', async () => {
  const { routine, items } = await benchRoutine();
  const squat = await createCustomExercise({
    name: 'Back Squat',
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType: 'weight_reps',
  });
  await setRoutineItems(routine.id, [
    ...items,
    { id: 'i2', exerciseId: squat.id, order: 1 },
  ]);
  await startSession(routine);

  renderScreen();

  expect(await screen.findByRole('button', { name: /back squat/i })).toBeInTheDocument();
  expect(
    await screen.findByRole('heading', { level: 3, name: /barbell bench press/i }),
  ).toBeInTheDocument();
});

it('switches focus when another exercise is tapped', async () => {
  const user = userEvent.setup();
  const { routine, items } = await benchRoutine();
  const squat = await createCustomExercise({
    name: 'Back Squat',
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType: 'weight_reps',
  });
  await setRoutineItems(routine.id, [
    ...items,
    { id: 'i2', exerciseId: squat.id, order: 1 },
  ]);
  await startSession(routine);

  renderScreen();
  await user.click(await screen.findByRole('button', { name: /back squat/i }));

  expect(
    await screen.findByRole('heading', { level: 3, name: /back squat/i }),
  ).toBeInTheDocument();
});

it('shows the prescription beside the exercise', async () => {
  const { routine, items } = await benchRoutine('Push A', 4);
  await setRoutineItems(routine.id, [
    { ...items[0], targetSets: 4, targetRepMin: 6, targetRepMax: 8, restSeconds: 120 },
  ]);
  await startSession(routine);

  renderScreen();

  expect(await screen.findByText(/4 × 6–8/)).toBeInTheDocument();
  expect(screen.getByText(/rest 2:00/i)).toBeInTheDocument();
});

it('marks an archived exercise but still allows logging against it', async () => {
  const { exercise, routine } = await benchRoutine();
  const { archiveExercise } = await import('../../db/exercises');
  await archiveExercise(exercise.id);
  await startSession(routine);

  renderScreen();

  expect(await screen.findByText(/archived/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /log set 1/i })).toBeEnabled();
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx`
Expected: FAIL — no strip buttons and no heading for the focused exercise.

- [ ] **Step 8: Render the strip, the focused exercise, and its planned rows**

Replace the body of `ActiveSessionScreen.tsx` below the `data === null` guard, and add the imports it needs:

```tsx
import { formatDuration, formatSet, measurementFields } from '../../domain/measurement';
import { planSets } from '../../domain/setPlan';
import { deleteSet, logSet } from '../../db/sets';
import type { LoggedSet, RoutineItem } from '../../db/types';
```

Add state beside `useWriteError`:

```tsx
  // Identity-based, not positional: the exercise list grows when one is added
  // mid-session, and an index would silently point at a different movement.
  // The same lesson the rotation pointer taught.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Per-exercise signed count of rows the user added or removed.
  const [adjust, setAdjust] = useState<Record<string, number>>({});
  // Edits to unconfirmed rows, keyed `${exerciseId}:${position}:${property}`.
  // Overlaid on the derived prefill, the same way RoutineEditor overlays
  // draftName — which avoids a seeding effect that could land after the user
  // has started typing and discard their input.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [warmup, setWarmup] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
```

Then the render:

```tsx
  const { session, routine, sets, exercises, settings, history } = data;
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const itemByExerciseId = new Map<string, RoutineItem>(
    (routine?.items ?? []).map((i) => [i.exerciseId, i]),
  );

  // Derived, never stored: the routine's items in order, then anything with
  // logged sets that is not in the routine. That is what makes Add exercise
  // free — it writes nothing.
  const routineIds = (routine?.items ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((i) => i.exerciseId);
  const extraIds = [...new Set(sets.map((s) => s.exerciseId))].filter(
    (id) => !routineIds.includes(id),
  );
  const exerciseIds = [...routineIds, ...extraIds];

  const focused = focusedId && exerciseIds.includes(focusedId) ? focusedId : exerciseIds[0];

  if (exerciseIds.length === 0) {
    return (
      <section>
        <h2>{session.name}</h2>
        {error && <p role="alert">{error}</p>}
        <p className="empty">This routine has no exercises.</p>
      </section>
    );
  }

  const exercise = exerciseById.get(focused);
  if (!exercise) {
    // Unreachable in practice: exercises are archived rather than deleted,
    // and the querier above loads archived ones. Guarding here once keeps
    // every use below non-null instead of scattering `!` assertions.
    return (
      <section>
        <h2>{session.name}</h2>
        <p role="alert">That exercise is no longer in the library.</p>
      </section>
    );
  }

  const item = itemByExerciseId.get(focused);
  const logged = sets.filter((s) => s.exerciseId === focused);
  const last = history[focused] ?? [];
  const fields = measurementFields(exercise.measurementType);
  const restSeconds = item?.restSeconds ?? settings.defaultRestSeconds;

  const planned = planSets({
    targetSets: item?.targetSets,
    lastPerformance: last,
    logged,
    defaultUnit: settings.unitPreference,
    adjust: adjust[focused] ?? 0,
  });

  function draftKey(position: number, property: string) {
    return `${focused}:${position}:${property}`;
  }

  function valueFor(row: { position: number }, property: string, derived?: number) {
    const key = draftKey(row.position, property);
    if (key in drafts) return drafts[key];
    return derived === undefined ? '' : String(derived);
  }

  async function confirmSet(row: (typeof planned)[number]) {
    const key = `${focused}:${row.position}`;
    if (busy === key) return;
    setBusy(key);

    const values: Partial<LoggedSet> = {};
    for (const field of fields) {
      const raw = valueFor(row, field.property, row[field.property]);
      const parsed = raw.trim() === '' ? undefined : Number(raw);
      // Cast deliberately: field.property is a union of four keys, and
      // TypeScript narrows a union-keyed write to their intersection, which
      // is `never`. The runtime shape is correct by construction.
      if (parsed !== undefined && !Number.isNaN(parsed)) {
        (values as Record<string, number>)[field.property] = parsed;
      }
    }

    await run(async () => {
      await logSet({
        sessionId: session.id,
        exerciseId: exercise.id,
        setType: warmup[key] ? 'warmup' : 'working',
        unit: row.unit,
        ...values,
      });
    });

    setDrafts((d) => {
      const next = { ...d };
      for (const field of fields) delete next[draftKey(row.position, field.property)];
      return next;
    });
    setWarmup((w) => {
      const { [key]: _cleared, ...rest } = w;
      return rest;
    });
    setBusy(null);
  }

  return (
    <section>
      <h2>{session.name}</h2>
      {error && <p role="alert">{error}</p>}

      <nav aria-label="Exercises in this session">
        {exerciseIds.map((id) => (
          <button
            key={id}
            type="button"
            aria-current={id === focused}
            onClick={() => setFocusedId(id)}
          >
            {exerciseById.get(id)?.name ?? 'Unknown exercise'}
          </button>
        ))}
      </nav>

      <h3>{exercise.name}</h3>
      {exercise.isArchived && <p>This exercise is archived.</p>}

      {item?.targetSets !== undefined && (
        <p className="prescription">
          {item.targetSets} &times;{' '}
          {item.targetRepMin !== undefined && item.targetRepMax !== undefined
            ? `${item.targetRepMin}–${item.targetRepMax}`
            : (item.targetRepMin ?? item.targetRepMax ?? '')}
        </p>
      )}
      <p className="rest">Rest {formatDuration(restSeconds)}</p>

      <p className="last-time">
        {last.length === 0
          ? 'No history for this exercise yet.'
          : `Last time: ${last
              .map((s) => formatSet(s, exercise.measurementType))
              .join(' · ')}`}
      </p>

      <ol className="logged-sets">
        {logged.map((set, index) => (
          <li key={set.id}>
            <span>
              {index + 1}. {formatSet(set, exercise.measurementType)}
              {set.setType === 'warmup' && ' (warm-up)'}
            </span>
            <button
              type="button"
              aria-label={`Remove logged set ${index + 1}`}
              onClick={() => run(() => deleteSet(set.id))}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>

      <ol className="planned-sets">
        {planned.map((row) => (
          <li key={row.position}>
            {fields.map((field) => (
              <label key={field.property}>
                {field.label}
                {field.unitBearing ? ` (${row.unit})` : ''}
                <input
                  type="number"
                  aria-label={`${field.label} for set ${row.position}`}
                  value={valueFor(row, field.property, row[field.property])}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [draftKey(row.position, field.property)]: e.target.value,
                    }))
                  }
                />
              </label>
            ))}

            <label>
              Warm-up
              <input
                type="checkbox"
                aria-label={`Mark set ${row.position} as a warm-up`}
                checked={warmup[`${focused}:${row.position}`] ?? false}
                onChange={(e) =>
                  setWarmup((w) => ({ ...w, [`${focused}:${row.position}`]: e.target.checked }))
                }
              />
            </label>

            <button
              type="button"
              // Disabled while its own write is in flight. Two fast taps
              // would otherwise log the set twice; logSet's transactional
              // order assignment keeps them distinct, but the second set is
              // still one the user did not perform.
              disabled={busy === `${focused}:${row.position}`}
              onClick={() => void confirmSet(row)}
            >
              Log set {row.position}
            </button>

            <button
              type="button"
              aria-label={`Remove planned set ${row.position}`}
              onClick={() => setAdjust((a) => ({ ...a, [focused]: (a[focused] ?? 0) - 1 }))}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => setAdjust((a) => ({ ...a, [focused]: (a[focused] ?? 0) + 1 }))}
      >
        Add set
      </button>
    </section>
  );
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 10: Commit**

```bash
git add src/ui/session/
git commit -m "feat: render the focused exercise and its planned sets"
```

- [ ] **Step 11: Write the failing tests for prefill, logging, and resume**

Append to `src/ui/session/ActiveSessionScreen.test.tsx`:

```tsx
it('prefills each row from last time’s matching set', async () => {
  const { exercise, routine } = await benchRoutine('Push A', 3);
  const previous = await startSession(routine);
  await logSet({
    sessionId: previous.id, exerciseId: exercise.id, setType: 'working',
    unit: 'lb', weight: 135, reps: 8,
  });
  await logSet({
    sessionId: previous.id, exerciseId: exercise.id, setType: 'working',
    unit: 'lb', weight: 145, reps: 6,
  });
  await (await import('../../db/sessions')).finishSession(previous.id);
  await startSession(routine);

  renderScreen();

  expect(await screen.findByLabelText(/weight for set 1/i)).toHaveValue(135);
  expect(screen.getByLabelText(/weight for set 2/i)).toHaveValue(145);
  // Row 3 has no matching set, so it falls back to last time's final set.
  expect(screen.getByLabelText(/weight for set 3/i)).toHaveValue(145);
});

it('shows the last-time line', async () => {
  const { exercise, routine } = await benchRoutine();
  const previous = await startSession(routine);
  await logSet({
    sessionId: previous.id, exerciseId: exercise.id, setType: 'working',
    unit: 'lb', weight: 135, reps: 8,
  });
  await (await import('../../db/sessions')).finishSession(previous.id);
  await startSession(routine);

  renderScreen();

  expect(await screen.findByText(/last time: 135 lb × 8/i)).toBeInTheDocument();
});

it('writes a set when the row is confirmed', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 2);
  const session = await startSession(routine);

  renderScreen();

  await user.type(await screen.findByLabelText(/weight for set 1/i), '135');
  await user.type(screen.getByLabelText(/reps for set 1/i), '8');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));

  await waitFor(async () => {
    const stored = await listSetsForSession(session.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].weight).toBe(135);
    expect(stored[0].reps).toBe(8);
    expect(stored[0].setType).toBe('working');
  });
});

it('keeps logged sets and resumes the remaining rows after a remount', async () => {
  // The test that encodes the whole autosave decision. Safari killing the
  // tab must lose nothing that was actually performed, and the unconfirmed
  // rows must re-derive rather than being replayed from anywhere.
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 3);
  await startSession(routine);

  const first = renderScreen();
  await user.type(await screen.findByLabelText(/weight for set 1/i), '135');
  await user.type(screen.getByLabelText(/reps for set 1/i), '8');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));
  await screen.findByText(/1\. 135 lb × 8/);
  first.unmount();

  renderScreen();

  expect(await screen.findByText(/1\. 135 lb × 8/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /log set 2/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /log set 1/i })).toBeNull();
});

it('flags a warm-up and keeps it out of the working count', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 2);
  const session = await startSession(routine);

  renderScreen();

  await user.type(await screen.findByLabelText(/weight for set 1/i), '45');
  await user.type(screen.getByLabelText(/reps for set 1/i), '10');
  await user.click(screen.getByLabelText(/mark set 1 as a warm-up/i));
  await user.click(screen.getByRole('button', { name: /log set 1/i }));

  await waitFor(async () => {
    expect((await listSetsForSession(session.id))[0].setType).toBe('warmup');
  });
  // A warm-up does not consume a planned row: set 1 is still to do.
  expect(await screen.findByRole('button', { name: /log set 1/i })).toBeInTheDocument();
});

it('adds and removes planned rows mid-workout', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 2);
  await startSession(routine);

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /^add set$/i }));
  expect(await screen.findByRole('button', { name: /log set 3/i })).toBeInTheDocument();

  await user.click(screen.getByLabelText(/remove planned set 3/i));
  expect(screen.queryByRole('button', { name: /log set 3/i })).toBeNull();
});

it('removes a logged set', async () => {
  const user = userEvent.setup();
  const { exercise, routine } = await benchRoutine('Push A', 2);
  const session = await startSession(routine);
  await logSet({
    sessionId: session.id, exerciseId: exercise.id, setType: 'working',
    unit: 'lb', weight: 135, reps: 8,
  });

  renderScreen();

  await user.click(await screen.findByLabelText(/remove logged set 1/i));

  await waitFor(async () => {
    expect(await listSetsForSession(session.id)).toHaveLength(0);
  });
});

it('renders only the fields a duration exercise needs', async () => {
  const plank = await createCustomExercise({
    name: 'Plank',
    primaryMuscles: ['abs'],
    secondaryMuscles: [],
    equipment: 'bodyweight',
    measurementType: 'duration',
  });
  const routine = await createRoutine('Core');
  await setRoutineItems(routine.id, [{ id: 'i1', exerciseId: plank.id, order: 0 }]);
  await startSession(routine);

  renderScreen();

  expect(await screen.findByLabelText(/seconds for set 1/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/weight for set 1/i)).toBeNull();
  expect(screen.queryByLabelText(/reps for set 1/i)).toBeNull();
});
```

- [ ] **Step 12: Run the tests**

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx`
Expected: PASS — the rendering written in Step 8 already covers these. That is expected; the RED phase for this component was Steps 2 and 7.

If any fail, fix `ActiveSessionScreen.tsx` — the tests encode the spec and are not the thing to adjust. The likely failures are `aria-label` text not matching and the `busy` guard leaving a button permanently disabled after a rejected write; the guard must clear in both outcomes.

- [ ] **Step 13: Run the full suite and commit**

Run: `npx vitest run --fileParallelism=false`
Expected: PASS.

```bash
git add src/ui/session/
git commit -m "test: pin prefill, logging, warm-ups and resume"
```

---

## Task 7: Today — Resume, Start, and picking a routine

**Files:**
- Modify: `src/ui/today/TodayScreen.tsx`
- Modify: `src/ui/today/TodayScreen.test.tsx`

**Interfaces:**

- Consumes: `getInProgressSession`, `startSession` from `src/db/sessions`; `listRoutines` from `src/db/routines`; the `/session` route created in Task 6.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/today/TodayScreen.test.tsx`. The file's existing `renderScreen` renders inside a bare `MemoryRouter`; replace it with one that carries a `/session` destination so navigation is observable:

```tsx
function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<TodayScreen />} />
        <Route path="/session" element={<p>Session screen</p>} />
        <Route path="/cycle" element={<p>Cycle editor</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
```

Add `Route`, `Routes` to the `react-router-dom` import and `waitFor` to the testing-library import, then append:

```tsx
it('starts a session for the routine that is up next', async () => {
  const user = userEvent.setup();
  const routine = await createRoutine('Push Day');
  const cycle = await getOrCreateActiveCycle();
  await saveCycle({ ...cycle, routineIds: [routine.id], currentIndex: 0 });

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /start push day/i }));

  expect(await screen.findByText('Session screen')).toBeInTheDocument();
  expect((await getInProgressSession())?.routineId).toBe(routine.id);
});

it('offers Resume instead of Start while a session is open', async () => {
  const routine = await createRoutine('Push Day');
  const cycle = await getOrCreateActiveCycle();
  await saveCycle({ ...cycle, routineIds: [routine.id], currentIndex: 0 });
  await startSession(routine);

  renderScreen();

  expect(await screen.findByRole('link', { name: /resume push day/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start push day/i })).toBeNull();
});

it('starts a routine other than the one up next', async () => {
  const user = userEvent.setup();
  const push = await createRoutine('Push Day');
  const legs = await createRoutine('Leg Day');
  const cycle = await getOrCreateActiveCycle();
  await saveCycle({ ...cycle, routineIds: [push.id, legs.id], currentIndex: 0 });

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /do a different one/i }));
  await user.click(await screen.findByRole('button', { name: /^leg day$/i }));

  expect(await screen.findByText('Session screen')).toBeInTheDocument();
  expect((await getInProgressSession())?.routineId).toBe(legs.id);
});

it('does not offer Start when the routine has no exercises to log', async () => {
  const routine = await createRoutine('Push Day');
  const cycle = await getOrCreateActiveCycle();
  await saveCycle({ ...cycle, routineIds: [routine.id], currentIndex: 0 });

  renderScreen();

  await screen.findByText(/no exercises in this routine/i);
  expect(screen.queryByRole('button', { name: /start push day/i })).toBeNull();
});

it('surfaces a refusal to start rather than failing silently', async () => {
  const user = userEvent.setup();
  const push = await createRoutine('Push Day');
  const legs = await createRoutine('Leg Day');
  const cycle = await getOrCreateActiveCycle();
  await saveCycle({ ...cycle, routineIds: [push.id, legs.id], currentIndex: 0 });
  await setRoutineItems(legs.id, [{ id: 'i1', exerciseId: 'squat', order: 0 }]);
  await startSession(push);

  renderScreen();

  // Resume is showing, so reaching startSession for another routine means
  // the picker was opened first. Open it and try.
  await user.click(await screen.findByRole('button', { name: /do a different one/i }));
  await user.click(await screen.findByRole('button', { name: /^leg day$/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/already in progress/i);
});
```

Add to that file's imports: `getInProgressSession` and `startSession` from `../../db/sessions`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/today/TodayScreen.test.tsx`
Expected: FAIL — no Start button exists.

- [ ] **Step 3: Add Resume, Start, and the routine picker**

In `src/ui/today/TodayScreen.tsx`, extend the imports:

```tsx
import { useNavigate } from 'react-router-dom';
import { getInProgressSession, startSession } from '../../db/sessions';
import { listRoutines } from '../../db/routines';
import type { Routine } from '../../db/types';
```

Extend the existing querier to carry the in-progress session and the routine list. Both reads are read-only, so they belong in the same querier rather than in a second one that would lag a render behind:

```tsx
  const data = useLiveQuery(async () => {
    const cycle = await getActiveCycle();
    if (!cycle) return null;
    const upNextId = nextRoutineId(cycle);
    const routine = upNextId ? (await getRoutine(upNextId)) ?? null : null;
    const inProgress = await getInProgressSession();
    const routines = await listRoutines();
    return { cycle, routine, inProgress, routines };
  }, []);
```

Add state and the start handler:

```tsx
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);

  async function start(routine: Routine) {
    // startSession opens a readwrite transaction, which is why it is called
    // from a handler and never from the querier above — Dexie throws
    // ReadOnlyError for a readwrite transaction inside a liveQuery.
    let started = false;
    await run(async () => {
      await startSession(routine);
      started = true;
    });
    if (started) navigate('/session');
  }
```

Destructure the new fields and render. Place this above the existing "Skip to next" button:

```tsx
  const { cycle, routine, inProgress, routines } = data;
```

```tsx
      {inProgress ? (
        <p>
          <Link to="/session">
            Resume {inProgress.name}
          </Link>
          , started {new Date(inProgress.startedAt).toLocaleString()}
        </p>
      ) : (
        routine !== null && routine.items.length > 0 && (
          <button type="button" onClick={() => void start(routine)}>
            Start {routine.name}
          </button>
        )
      )}

      <button type="button" onClick={() => setPicking((p) => !p)}>
        {picking ? 'Never mind' : 'Do a different one'}
      </button>

      {picking && (
        <ul className="routine-picker">
          {routines
            .filter((r) => r.items.length > 0)
            .map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => void start(r)}>
                  {r.name}
                </button>
              </li>
            ))}
        </ul>
      )}
```

The `aria-label` the Resume test looks for comes from the link's own text — `Resume {inProgress.name}` renders as "Resume Push Day", which matches `/resume push day/i`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/today/TodayScreen.test.tsx`
Expected: PASS — the five new tests plus every pre-existing one.

- [ ] **Step 5: Run the full suite and commit**

Run: `npx vitest run --fileParallelism=false`
Expected: PASS.

```bash
git add src/ui/today/
git commit -m "feat: start and resume a session from Today"
```

---

## Task 8: Add an exercise mid-session, finish, and discard

**Files:**
- Modify: `src/ui/session/ActiveSessionScreen.tsx`
- Modify: `src/ui/session/ActiveSessionScreen.test.tsx`

**Interfaces:**

- Consumes: `finishSession`, `discardSession` from `src/db/sessions`; `ExerciseBrowser` from `src/ui/library/ExerciseBrowser`; `getActiveCycle` from `src/db/cycles`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/session/ActiveSessionScreen.test.tsx`:

```tsx
it('adds an exercise that is not in the routine', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 1);
  await createCustomExercise({
    name: 'Cable Fly',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'cable',
    measurementType: 'weight_reps',
  });
  await startSession(routine);

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /add exercise/i }));
  await user.click(await screen.findByRole('button', { name: /cable fly/i }));

  expect(
    await screen.findByRole('heading', { level: 3, name: /cable fly/i }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /log set 1/i })).toBeInTheDocument();
});

it('keeps an added exercise after a set is logged into it', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 1);
  const fly = await createCustomExercise({
    name: 'Cable Fly',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'cable',
    measurementType: 'weight_reps',
  });
  const session = await startSession(routine);
  await logSet({
    sessionId: session.id, exerciseId: fly.id, setType: 'working',
    unit: 'lb', weight: 30, reps: 12,
  });

  renderScreen();

  // Derived from the logged sets, so it survives a reload with no storage.
  expect(await screen.findByRole('button', { name: /cable fly/i })).toBeInTheDocument();
});

it('finishes the session and advances the rotation', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 1);
  const other = await createRoutine('Pull A');
  const cycle = await (await import('../../db/cycles')).getOrCreateActiveCycle();
  await (await import('../../db/cycles')).saveCycle({
    ...cycle, routineIds: [routine.id, other.id], currentIndex: 0,
  });
  const session = await startSession(routine);

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /finish workout/i }));

  expect(await screen.findByText('Today screen')).toBeInTheDocument();
  const { getSession } = await import('../../db/sessions');
  expect((await getSession(session.id))?.status).toBe('completed');
  const { getActiveCycle } = await import('../../db/cycles');
  expect((await getActiveCycle())?.currentIndex).toBe(1);
});

it('asks before discarding', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 1);
  const session = await startSession(routine);

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /discard workout/i }));
  // Nothing is gone until the confirmation is taken.
  const { getSession } = await import('../../db/sessions');
  expect(await getSession(session.id)).toBeDefined();

  await user.click(await screen.findByRole('button', { name: /yes, discard it/i }));

  expect(await screen.findByText('Today screen')).toBeInTheDocument();
  expect(await getSession(session.id)).toBeUndefined();
});

it('takes the logged sets with a discarded session', async () => {
  const user = userEvent.setup();
  const { exercise, routine } = await benchRoutine('Push A', 1);
  const session = await startSession(routine);
  await logSet({
    sessionId: session.id, exerciseId: exercise.id, setType: 'working',
    unit: 'lb', weight: 135, reps: 8,
  });

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /discard workout/i }));
  await user.click(await screen.findByRole('button', { name: /yes, discard it/i }));

  await waitFor(async () => {
    expect(await listSetsForSession(session.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx`
Expected: FAIL — no Add exercise, Finish or Discard controls exist.

- [ ] **Step 3: Add the three controls**

In `src/ui/session/ActiveSessionScreen.tsx`, extend the imports:

```tsx
import { useNavigate } from 'react-router-dom';
import { discardSession, finishSession, getInProgressSession } from '../../db/sessions';
import { ExerciseBrowser } from '../library/ExerciseBrowser';
```

Add state and handlers beside the existing ones:

```tsx
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // Exercises added this session that have no logged set yet. Held here
  // rather than stored: the session's exercise list is derived from the
  // routine plus whatever has sets, so adding one writes nothing. The
  // consequence is that an added exercise with no sets is gone after a
  // reload — nothing was lost, because nothing was done.
  const [added, setAdded] = useState<string[]>([]);
```

Fold `added` into the derived list, replacing the `extraIds` line:

```tsx
  const extraIds = [
    ...new Set([...sets.map((s) => s.exerciseId), ...added]),
  ].filter((id) => !routineIds.includes(id));
```

Add the handlers:

```tsx
  async function finish() {
    let done = false;
    await run(async () => {
      await finishSession(session.id);
      done = true;
    });
    if (done) navigate('/');
  }

  async function discard() {
    let done = false;
    await run(async () => {
      await discardSession(session.id);
      done = true;
    });
    if (done) navigate('/');
  }
```

Render them below the Add set button:

```tsx
      <button type="button" onClick={() => setPicking((p) => !p)}>
        {picking ? 'Done adding' : 'Add exercise'}
      </button>

      {picking && (
        <ExerciseBrowser
          onSelect={(chosen) => {
            setAdded((a) => (a.includes(chosen.id) ? a : [...a, chosen.id]));
            setFocusedId(chosen.id);
            setPicking(false);
          }}
        />
      )}

      <button type="button" onClick={() => void finish()}>
        Finish workout
      </button>

      {confirmingDiscard ? (
        <p>
          Discard this workout and everything logged in it?
          <button type="button" onClick={() => void discard()}>Yes, discard it</button>
          <button type="button" onClick={() => setConfirmingDiscard(false)}>Keep it</button>
        </p>
      ) : (
        <button type="button" onClick={() => setConfirmingDiscard(true)}>
          Discard workout
        </button>
      )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx`
Expected: PASS — all 19 tests in the file.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run --fileParallelism=false`
Expected: PASS — every test, old and new.

- [ ] **Step 6: Verify the production build type-checks**

Run: `npm run build`
Expected: `tsc --noEmit` reports no errors and Vite emits `dist/`, including `dist/404.html` from the `closeBundle` plugin.

- [ ] **Step 7: Commit**

```bash
git add src/ui/session/
git commit -m "feat: add exercises mid-session, finish, and discard"
```

- [ ] **Step 8: Manual post-deploy check**

After this merges and Pages deploys, confirm on the phone:

1. Cold-load `https://zabdi20.github.io/workout-tracker/session` directly. It must reach the app and redirect to Today, not GitHub's 404 page. No unit test can cover this — Vitest forces `base` to `/`, so a regression in `basename={import.meta.env.BASE_URL}` passes CI and only breaks the deploy.
2. Start a session, log a set, background Safari for a few minutes, reopen. The logged set is still there and the remaining rows resume where they were.

---

## Verification

The plan is complete when all of the following hold:

- `npx vitest run --fileParallelism=false` passes.
- `npm run build` type-checks and emits `dist/404.html`.
- A workout can be logged end to end: Today → Start → log sets across at least two exercises → Finish, with the rotation advancing by one.
- Resuming after a remount preserves every logged set and re-derives the remaining rows.
- A bundled exercise can be renamed and retyped, and reset back to its shipped data.
- `src/db/db.test.ts` still passes, pinning `isCustom`, `isArchived`, `isActive` and `Session.routineId` as unindexed.
