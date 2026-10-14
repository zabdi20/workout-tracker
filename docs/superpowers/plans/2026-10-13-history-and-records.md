# History and Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse and edit finished workouts, and detect personal records — badged live while logging, on past workouts, and on a records page per exercise.

**Architecture:** Every PR rule is a pure function in a new `src/domain/records.ts`, computed on demand from logged sets and never stored. Seven new data functions extend `src/db/sessions.ts` and `src/db/sets.ts`, with no schema change. Three new screens: History (`/history`), one past workout (`/history/:sessionId`) and an exercise's records (`/exercises/:exerciseId/records`). The active-workout screen gains badges through its existing querier.

**Tech Stack:** React 19, TypeScript 7, Dexie 4.4, react-router-dom 7.18, Vitest 4 + jsdom 30, @testing-library/react 16 + user-event 14.

**Spec:** `docs/superpowers/specs/2026-10-13-history-and-records-design.md` — read it before your task. Every rule marked **(my call)** there is binding here.

## Global Constraints

- **Shell:** Git Bash, not PowerShell. If tools are missing: `export PATH="/usr/bin:/bin:/mingw64/bin:/c/Program Files/nodejs:$PATH"`.
- **Focused test command:** `npx vitest run <path>`. **Full suite:** `npx vitest run --fileParallelism=false` (parallel runs are flaky here). Baseline before this plan: **31 files / 420 tests**. Roughly double means a worktree under `.claude/` is being collected — stop.
- **`npx tsc --noEmit` must exit 0 before every commit.** Vitest transpiles without typechecking, so a green test run proves nothing about the build.
- **Vitest globals are on.** Never import `describe`, `it`, `expect`, `beforeEach`, `afterEach` or `vi`.
- **Every test must be seen failing before its implementation exists.** If a test passes at the "verify it fails" step, the test is wrong — fix it, don't proceed. Test output must be pristine.
- **`src/domain/` is pure and I/O-free.** Type-only imports from `src/db/types` are fine; nothing else.
- **Never `.where()` on a boolean or nullable field.** `Session.status` is an indexed string, so `.where('status')` is correct.
- **A `useLiveQuery` querier may not open a readwrite transaction**, and **each screen has exactly one querier.**
- **`run(...)` from `src/ui/useWriteError.ts` never rejects.** A failed write must never discard what the user typed.
- **Never pass `id` inside a Dexie `update()` payload.**
- **Weight is never converted on write.** Conversion to kg exists for PR comparison only: `1 lb = 0.45359237 kg`, and "greater" means greater by more than `1e-9` kg.
- **List items are keyed by id, never by index.**
- **Display dates with `new Date(ms).toLocaleString()`** (or `toLocaleDateString()` for date-only), matching Today. Tests compute the expected string the same way.
- **No CSS.**
- **End every commit message with:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

Failure modes the spec implies that a person will hit, most likely first. Each has a test in the task that owns it.

1. **Fixing a typo in an earlier set changes which later sets are PRs.** The badge must re-evaluate rather than go stale. → Task 5, `re-evaluates later badges when an earlier set is edited`.
2. **A past workout whose sets have all been deleted.** It must still render, and still be deletable. → Task 3, `shows a workout whose sets were all deleted`.
3. **An exercise archived, or retyped away from weight × reps, after the workout.** History must still render it, marked archived, and its badges follow the *current* type. → Task 3, two tests.
4. **One exercise logged in both kg and lb.** There must be no fake PR from conversion, and its rep bests are separate rows. → Task 1 (rules), Task 7, `lists different units as separate rep bests`.
5. **A finished workout with no `endedAt`.** The row must show a dash, never `NaN min`. → Task 4, `shows a dash rather than NaN when a workout has no end time`.

---

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `src/domain/records.ts` (+ test) | 1 | PR rules: conversion, estimate, detection, current records |
| `src/db/sessions.ts` (+ test) | 2 | `finishSession` guard; list, move and delete finished workouts |
| `src/db/sets.ts` (+ test) | 2 | Sets by exercise, all sets, add a forgotten set |
| `src/testFixtures.ts` | 3 | Test-only seeding of exercises and finished workouts |
| `src/ui/PrBadge.tsx` (+ test) | 3 | One badge naming every PR type a set earned |
| `src/ui/history/format.ts` (+ test) | 3, 6 | Workout duration; `datetime-local` conversion |
| `src/ui/history/PastWorkoutScreen.tsx` (+ test) | 3, 5, 6, 7 | One past workout: view, edit, move, delete |
| `src/ui/history/PastSetRow.tsx` | 5 | One past set: show, edit, delete |
| `src/ui/history/AddSetForm.tsx` | 5 | Add a forgotten set to one exercise |
| `src/ui/history/HistoryScreen.tsx` (+ test) | 4 | The list of finished workouts |
| `src/ui/records/RecordsScreen.tsx` (+ test) | 7 | One exercise's records |
| `src/domain/measurement.ts` | 5 | `parseSetFields`, extracted from `confirmSet` |
| `src/ui/useWriteError.ts` (+ new test) | 5 | `run` resolves `true`/`false` |
| `src/ui/session/ActiveSessionScreen.tsx` | 5, 8 | Uses `parseSetFields`; computes live PRs |
| `src/ui/session/LoggedSetList.tsx` | 8 | Optional `prs` prop |
| `src/ui/library/LibraryScreen.tsx` (+ test) | 7 | Records link beside the edit form |
| `src/App.tsx`, `src/ui/AppLayout.tsx` (+ tests) | 3, 4, 7 | Routes and the History tab |

**Order:** 1 and 2 are independent. 3 needs both. 4–8 need 3. Each screen's route lands in the same task as the screen, and no task links to a route that doesn't exist yet. The History tab comes in Task 4, after the detail screen it opens; record links come in Task 7, with the page they open.

---

### Task 1: PR rules

**Files:**
- Create: `src/domain/records.ts`
- Test: `src/domain/records.test.ts`

**Interfaces:**
- Consumes: types only — `LoggedSet`, `Exercise`, `WeightUnit` from `src/db/types`.
- Produces:
  - `type PrKind = 'heaviest' | 'e1rm' | 'reps'`
  - `const KG_PER_LB = 0.45359237`
  - `toKg(weight: number, unit: WeightUnit): number`
  - `estimatedOneRepMax(weight: number, reps: number): number | undefined`
  - `detectPrs(sets: LoggedSet[]): Map<string, PrKind[]>` — the sets of **one** exercise, any order, any set type
  - `detectAllPrs(sets: LoggedSet[], exercises: Exercise[]): Map<string, PrKind[]>` — any mix of exercises
  - `interface ExerciseRecords { heaviest: LoggedSet | null; bestE1rm: { set: LoggedSet; value: number } | null; repBests: LoggedSet[] }`
  - `exerciseRecords(sets: LoggedSet[]): ExerciseRecords` — the sets of one exercise

The maps hold only sets that earned at least one kind. Kinds always appear in the order `heaviest`, `e1rm`, `reps`.

- [ ] **Step 1: Write the failing tests** in `src/domain/records.test.ts`

```ts
import type { Exercise, LoggedSet, MeasurementType } from '../db/types';
import {
  detectAllPrs, detectPrs, estimatedOneRepMax, exerciseRecords, KG_PER_LB, toKg,
} from './records';

let seq = 0;
function set(over: Partial<LoggedSet> & { completedAt: number }): LoggedSet {
  seq += 1;
  return {
    id: `s${seq}`, sessionId: 'w1', exerciseId: 'bench', order: 0,
    setType: 'working', unit: 'lb', weight: 225, reps: 5, ...over,
  };
}

function exercise(id: string, measurementType: MeasurementType): Exercise {
  return {
    id, name: id, primaryMuscles: [], secondaryMuscles: [], equipment: 'barbell',
    measurementType, isCustom: true, isArchived: false,
  };
}

describe('toKg', () => {
  it('leaves kilograms alone', () => expect(toKg(100, 'kg')).toBe(100));
  it('uses the exact definition of the pound', () => {
    expect(KG_PER_LB).toBe(0.45359237);
    expect(toKg(225, 'lb')).toBeCloseTo(102.05828325, 8);
  });
});

describe('estimatedOneRepMax', () => {
  it('is the weight itself for a single', () => expect(estimatedOneRepMax(225, 1)).toBe(225));
  it('applies Epley above one rep', () => expect(estimatedOneRepMax(200, 5)).toBeCloseTo(233.333, 3));
  it('still estimates at exactly 12 reps', () => expect(estimatedOneRepMax(100, 12)).toBeCloseTo(140, 9));
  it('gives no estimate above 12 reps', () => expect(estimatedOneRepMax(100, 13)).toBeUndefined());
  it('gives no estimate for zero reps', () => expect(estimatedOneRepMax(100, 0)).toBeUndefined());
});

describe('detectPrs', () => {
  it('never badges the first set ever logged', () => {
    expect(detectPrs([set({ completedAt: 1 })]).size).toBe(0);
  });

  it('badges a heavier set as heaviest, but not est. 1RM when its estimate is lower', () => {
    const a = set({ weight: 225, reps: 5, completedAt: 1 }); // estimate 262.5
    const b = set({ weight: 235, reps: 3, completedAt: 2 }); // estimate 258.5
    expect(detectPrs([a, b]).get(b.id)).toEqual(['heaviest']);
  });

  it('does not badge a tie', () => {
    expect(detectPrs([set({ completedAt: 1 }), set({ completedAt: 2 })]).size).toBe(0);
  });

  it('badges more reps at the same weight as a rep best', () => {
    const b = set({ weight: 225, reps: 6, completedAt: 2 });
    expect(detectPrs([set({ weight: 225, reps: 5, completedAt: 1 }), b]).get(b.id)).toEqual(['e1rm', 'reps']);
  });

  it('does not badge a first time at a lower new weight', () => {
    const sets = [set({ weight: 225, reps: 5, completedAt: 1 }), set({ weight: 185, reps: 8, completedAt: 2 })];
    expect(detectPrs(sets).size).toBe(0);
  });

  it('ignores warm-ups, both as PRs and as the bar to beat', () => {
    const warmup = set({ setType: 'warmup', weight: 315, reps: 1, completedAt: 1 });
    const first = set({ weight: 225, reps: 5, completedAt: 2 });
    const second = set({ weight: 235, reps: 5, completedAt: 3 });
    const prs = detectPrs([warmup, first, second]);
    expect(prs.get(warmup.id)).toBeUndefined();
    expect(prs.get(first.id)).toBeUndefined();
    expect(prs.get(second.id)).toEqual(['heaviest', 'e1rm']);
  });

  it('gives sets above 12 reps no estimate, so they neither earn nor block est. 1RM', () => {
    const a = set({ weight: 100, reps: 5, completedAt: 1 }); // estimate 116.67
    const b = set({ weight: 100, reps: 15, completedAt: 2 }); // no estimate
    const c = set({ weight: 105, reps: 4, completedAt: 3 }); // estimate 119
    const prs = detectPrs([a, b, c]);
    expect(prs.get(b.id)).toEqual(['reps']);
    expect(prs.get(c.id)).toEqual(['heaviest', 'e1rm']);
  });

  it('compares weights across units in kilograms', () => {
    const b = set({ unit: 'lb', weight: 225, reps: 5, completedAt: 2 });
    expect(detectPrs([set({ unit: 'kg', weight: 100, reps: 5, completedAt: 1 }), b]).get(b.id))
      .toEqual(['heaviest', 'e1rm']);
  });

  it('never treats a kg and an lb number as the same weight for rep bests', () => {
    const sets = [set({ unit: 'kg', weight: 100, reps: 5, completedAt: 1 }), set({ unit: 'lb', weight: 100, reps: 8, completedAt: 2 })];
    expect(detectPrs(sets).size).toBe(0);
  });

  it('treats a float-noise difference across units as a tie, not a PR', () => {
    // 1e-12 kg lighter than 225 lb: greater without the 1e-9 tolerance, a tie with it.
    const sets = [
      set({ unit: 'kg', weight: 225 * KG_PER_LB - 1e-12, reps: 5, completedAt: 1 }),
      set({ unit: 'lb', weight: 225, reps: 5, completedAt: 2 }),
    ];
    expect(detectPrs(sets).size).toBe(0);
  });

  it('orders by completedAt, not by the order the sets arrive in', () => {
    const a = set({ weight: 225, reps: 5, completedAt: 1 });
    const b = set({ weight: 235, reps: 3, completedAt: 2 });
    expect(detectPrs([b, a]).get(b.id)).toEqual(['heaviest']);
  });

  it('orders sets stamped in the same millisecond by their order field', () => {
    const first = set({ weight: 225, reps: 5, completedAt: 1, order: 0 });
    const second = set({ weight: 235, reps: 5, completedAt: 1, order: 1 });
    expect(detectPrs([second, first]).get(second.id)).toEqual(['heaviest', 'e1rm']);
  });

  it('skips sets with no weight or no reps', () => {
    const sets = [
      set({ weight: undefined, reps: 10, completedAt: 1 }),
      set({ weight: 500, reps: 0, completedAt: 2 }),
      set({ weight: 225, reps: 5, completedAt: 3 }),
    ];
    expect(detectPrs(sets).size).toBe(0);
  });
});

describe('detectAllPrs', () => {
  it('detects only for exercises currently typed weight × reps', () => {
    const b = set({ exerciseId: 'bench', weight: 235, completedAt: 2 });
    const plankB = set({ exerciseId: 'plank', weight: 20, reps: 1, completedAt: 2 });
    const prs = detectAllPrs(
      [set({ exerciseId: 'bench', completedAt: 1 }), b, set({ exerciseId: 'plank', weight: 10, reps: 1, completedAt: 1 }), plankB],
      [exercise('bench', 'weight_reps'), exercise('plank', 'duration')],
    );
    expect([...prs.keys()]).toEqual([b.id]);
  });

  it('keeps exercises apart, and skips sets of an unknown exercise', () => {
    const sets = [
      set({ exerciseId: 'squat', weight: 315, completedAt: 1 }),
      set({ exerciseId: 'bench', weight: 225, completedAt: 2 }),
      set({ exerciseId: 'ghost', weight: 100, completedAt: 3 }),
      set({ exerciseId: 'ghost', weight: 200, completedAt: 4 }),
    ];
    expect(detectAllPrs(sets, [exercise('squat', 'weight_reps'), exercise('bench', 'weight_reps')]).size).toBe(0);
  });
});

describe('exerciseRecords', () => {
  it('is empty with no qualifying sets', () => {
    expect(exerciseRecords([set({ setType: 'warmup', completedAt: 1 })]))
      .toEqual({ heaviest: null, bestE1rm: null, repBests: [] });
  });

  it('reports the heaviest, the best estimate, and rep bests heaviest first', () => {
    const a = set({ weight: 225, reps: 5, completedAt: 1 });
    const b = set({ weight: 235, reps: 3, completedAt: 2 });
    const c = set({ weight: 225, reps: 6, completedAt: 3 }); // estimate 270
    const d = set({ weight: 185, reps: 10, completedAt: 4 });
    const records = exerciseRecords([a, b, c, d]);
    expect(records.heaviest?.id).toBe(b.id);
    expect(records.bestE1rm?.set.id).toBe(c.id);
    expect(records.bestE1rm?.value).toBeCloseTo(270, 9);
    expect(records.repBests.map((s) => s.id)).toEqual([b.id, c.id, d.id]);
  });

  it('keeps the earliest set when two tie', () => {
    const a = set({ completedAt: 1 });
    const records = exerciseRecords([a, set({ completedAt: 2 })]);
    expect(records.heaviest?.id).toBe(a.id);
    expect(records.bestE1rm?.set.id).toBe(a.id);
    expect(records.repBests.map((s) => s.id)).toEqual([a.id]);
  });

  it('uses the weight itself as a single\'s estimate', () => {
    expect(exerciseRecords([set({ weight: 300, reps: 1, completedAt: 1 })]).bestE1rm?.value).toBe(300);
  });

  it('keeps different units as separate rep-best rows', () => {
    const kg = set({ unit: 'kg', weight: 100, reps: 5, completedAt: 1 });
    const lb = set({ unit: 'lb', weight: 100, reps: 8, completedAt: 2 });
    expect(exerciseRecords([lb, kg]).repBests.map((s) => s.id)).toEqual([kg.id, lb.id]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/domain/records.test.ts`
Expected: FAIL — `./records` cannot be resolved.

- [ ] **Step 3: Implement `src/domain/records.ts`**

The spec's "Personal records" section is the algorithm. The points the tests don't make obvious:

- **Qualifying set:** `setType === 'working'`, `weight !== undefined`, `reps !== undefined && reps >= 1`.
- **Chronological order:** sort by `completedAt`, then `order`, then `id`. Do not mutate the caller's array.
- **`detectPrs`** walks that order once, keeping the running maximum weight in kg, the running maximum estimate, and the best reps per exact `` `${weight}|${unit}` `` key. A kind is earned only when a previous value exists and the new value exceeds it — by more than `1e-9` for the two kg-based kinds, strictly for reps.
- **`exerciseRecords`** takes the same walk. Because it keeps only strict improvements, ties keep the earliest set. Rep bests are sorted by weight in kg, descending, then by unit for a stable order.
- **`detectAllPrs`** groups by `exerciseId`, runs `detectPrs` only for exercises whose `measurementType` is `'weight_reps'`, and merges the maps.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/records.test.ts` — expect PASS, 27 tests. Then run `npx tsc --noEmit` — expect exit 0.

- [ ] **Step 5: Commit** — `feat: add personal-record rules`

---

### Task 2: History data access

**Files:**
- Modify: `src/db/sessions.ts`, `src/db/sets.ts`
- Test: `src/db/sessions.test.ts`, `src/db/sets.test.ts`

**Interfaces:**
- Consumes: existing `db`, `Session`, `LoggedSet`, `NewLoggedSet`.
- Produces:
  - `finishSession(id)` — unchanged signature; becomes a no-op for a session already `completed`
  - `listCompletedSessions(): Promise<Session[]>` — newest `startedAt` first
  - `moveSession(id: string, newStartedAt: number): Promise<void>`
  - `deleteCompletedSession(id: string): Promise<void>`
  - `listSetsForExercise(exerciseId: string): Promise<LoggedSet[]>` — oldest first, through `[exerciseId+completedAt]`
  - `listAllSets(): Promise<LoggedSet[]>`
  - `addForgottenSet(input: NewLoggedSet): Promise<LoggedSet>`

Every write function is a single `db.transaction('rw', …)` that reads afresh inside it.

- [ ] **Step 1: Write the failing tests**

Add to `src/db/sessions.test.ts`. Fixtures go straight into the tables, because these sessions must be `completed` with known timestamps.

```ts
const MIN = 60_000;
const DAY = 86_400_000;
const T = Date.UTC(2025, 0, 6, 17, 0); // a past Monday, on the minute

async function finished(id: string, startedAt: number, setTimes: number[] = []) {
  await db.sessions.add({ id, routineId: null, name: id, startedAt, endedAt: startedAt + 60 * MIN, status: 'completed' });
  for (const [i, at] of setTimes.entries()) {
    await db.sets.add({ id: `${id}-${i}`, sessionId: id, exerciseId: 'bench', order: i, setType: 'working', unit: 'lb', weight: 200, reps: 5, completedAt: at });
  }
}

describe('finishSession on a finished session', () => {
  it('does not re-stamp a session that is already finished', async () => {
    const session = await startSession(await createRoutine('Push A'));
    await finishSession(session.id);
    await db.sessions.update(session.id, { endedAt: 1000 });
    await finishSession(session.id);
    expect((await getSession(session.id))?.endedAt).toBe(1000);
  });
});

describe('listCompletedSessions', () => {
  it('lists finished workouts newest first and leaves out the one in progress', async () => {
    await finished('old', T);
    await finished('new', T + DAY);
    await db.sessions.add({ id: 'live', routineId: null, name: 'live', startedAt: T + 2 * DAY, status: 'in_progress' });
    expect((await listCompletedSessions()).map((s) => s.id)).toEqual(['new', 'old']);
  });
});

describe('moveSession', () => {
  it('moves the workout and every one of its sets by the same amount', async () => {
    await finished('w', T, [T + MIN, T + 2 * MIN]);
    await moveSession('w', T - DAY);
    const moved = await getSession('w');
    expect(moved?.startedAt).toBe(T - DAY);
    expect(moved?.endedAt).toBe(T - DAY + 60 * MIN);
    expect((await db.sets.where('sessionId').equals('w').sortBy('order')).map((s) => s.completedAt))
      .toEqual([T - DAY + MIN, T - DAY + 2 * MIN]);
  });

  it('keeps "last time" pointing at the right workout after a move', async () => {
    await finished('earlier', T, [T + MIN]);
    await db.sets.update('earlier-0', { weight: 185 });
    await finished('later', T + DAY, [T + DAY + MIN]);
    await moveSession('later', T - DAY);
    expect((await lastPerformance('bench', 'none')).map((s) => s.weight)).toEqual([185]);
  });

  it('applies a repeated save of the same time only once', async () => {
    await finished('w', T, [T + MIN]);
    await moveSession('w', T - DAY);
    await moveSession('w', T - DAY);
    expect((await getSession('w'))?.startedAt).toBe(T - DAY);
  });

  it('treats a time in the same minute as no change', async () => {
    await finished('w', T + 37_000, [T + MIN]);
    await moveSession('w', T);
    expect((await getSession('w'))?.startedAt).toBe(T + 37_000);
    expect((await db.sets.get('w-0'))?.completedAt).toBe(T + MIN);
  });

  it('refuses to move a workout so it ends in the future', async () => {
    await finished('w', T);
    await expect(moveSession('w', Date.now() + DAY)).rejects.toThrow(/future/i);
    expect((await getSession('w'))?.startedAt).toBe(T);
  });

  it('refuses the workout in progress', async () => {
    await db.sessions.add({ id: 'live', routineId: null, name: 'live', startedAt: T, status: 'in_progress' });
    await expect(moveSession('live', T - DAY)).rejects.toThrow();
    expect((await getSession('live'))?.startedAt).toBe(T);
  });

  it('rejects an unknown workout', async () => {
    await expect(moveSession('nope', T)).rejects.toThrow(/not found/i);
  });
});

describe('deleteCompletedSession', () => {
  it('deletes a finished workout and its sets, and nothing else', async () => {
    await finished('gone', T, [T + MIN]);
    await finished('kept', T + DAY, [T + DAY + MIN]);
    await deleteCompletedSession('gone');
    expect(await getSession('gone')).toBeUndefined();
    expect(await db.sets.where('sessionId').equals('gone').count()).toBe(0);
    expect(await db.sets.where('sessionId').equals('kept').count()).toBe(1);
  });

  it('refuses the workout in progress, which has Discard', async () => {
    await db.sessions.add({ id: 'live', routineId: null, name: 'live', startedAt: T, status: 'in_progress' });
    await expect(deleteCompletedSession('live')).rejects.toThrow();
    expect(await getSession('live')).toBeDefined();
  });

  it('leaves the rotation where it is', async () => {
    const a = await createRoutine('A');
    const b = await createRoutine('B');
    const cycle = await getOrCreateActiveCycle();
    await saveCycle({ ...cycle, routineIds: [a.id, b.id], currentIndex: 1 });
    await finished('w', T);
    await deleteCompletedSession('w');
    expect((await getActiveCycle())?.currentIndex).toBe(1);
  });
});
```

Extend that file's imports with `listCompletedSessions`, `moveSession`, `deleteCompletedSession` from `./sessions` and `lastPerformance` from `./sets`. `getOrCreateActiveCycle`, `saveCycle` and `getActiveCycle` are already imported.

Add to `src/db/sets.test.ts`, extending its import from `./sets` with `listSetsForExercise`, `listAllSets` and `addForgottenSet`:

```ts
function stored(id: string, sessionId: string, exerciseId: string, order: number, completedAt: number) {
  return db.sets.add({ id, sessionId, exerciseId, order, setType: 'working', unit: 'lb', weight: 200, reps: 5, completedAt });
}

describe('listSetsForExercise', () => {
  it('returns every set for the exercise across workouts, oldest first', async () => {
    await stored('late', 's1', 'bench', 0, 300);
    await stored('early', 's2', 'bench', 0, 100);
    await stored('other', 's1', 'squat', 0, 200);
    expect((await listSetsForExercise('bench')).map((s) => s.id)).toEqual(['early', 'late']);
  });
});

describe('listAllSets', () => {
  it('returns every set', async () => {
    await stored('a', 's1', 'bench', 0, 100);
    await stored('b', 's2', 'squat', 0, 200);
    expect((await listAllSets()).map((s) => s.id).sort()).toEqual(['a', 'b']);
  });
});

describe('addForgottenSet', () => {
  it('places the set just after that exercise\'s last set in the workout', async () => {
    await stored('b0', 's1', 'bench', 0, 1000);
    await stored('b1', 's1', 'bench', 1, 2000);
    await stored('q0', 's1', 'squat', 0, 5000);
    const added = await addForgottenSet({ sessionId: 's1', exerciseId: 'bench', setType: 'working', unit: 'lb', weight: 205, reps: 4 });
    expect(added.order).toBe(2);
    expect(added.completedAt).toBe(2001);
    expect((await db.sets.get(added.id))?.weight).toBe(205);
  });

  it('refuses an exercise that is not in the workout', async () => {
    await stored('b0', 's1', 'bench', 0, 1000);
    await expect(addForgottenSet({ sessionId: 's1', exerciseId: 'squat', setType: 'working', unit: 'lb', weight: 300, reps: 5 }))
      .rejects.toThrow(/not in that workout/i);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/db/sessions.test.ts src/db/sets.test.ts`
Expected: FAIL. The new functions don't exist yet, and `does not re-stamp…` fails against the current `finishSession` because the timestamp is overwritten.

- [ ] **Step 3: Implement**, in the existing files' JSDoc style

- `finishSession`: return before writing anything when `session.status === 'completed'`.
- `listCompletedSessions`: `.where('status').equals('completed')`, sorted by `startedAt` descending.
- `moveSession(id, newStartedAt)`: a transaction over `sessions` and `sets`. Read the session afresh, and in this order:
  1. Throw `Workout not found` if it's missing.
  2. Throw if it's `in_progress`.
  3. Return without writing if `Math.floor(newStartedAt / 60_000) === Math.floor(session.startedAt / 60_000)`.
  4. Compute `delta = newStartedAt - session.startedAt`. Throw a message containing "future" if `(session.endedAt ?? session.startedAt) + delta > Date.now()`.
  5. Shift `startedAt`, `endedAt` (when present) and every set's `completedAt` by `delta`.
- `deleteCompletedSession(id)`: one transaction. Refuse an `in_progress` session, then delete the session's sets and the session. It does not touch `cycles`.
- `listSetsForExercise`: `where('[exerciseId+completedAt]').between([id, Dexie.minKey], [id, Dexie.maxKey]).toArray()`, as `lastPerformance` does.
- `addForgottenSet`: in a transaction over `sets`, read the session's sets for that exercise. Throw `This exercise is not in that workout` if there are none. Otherwise set `order = max(order) + 1` and `completedAt = max(completedAt) + 1`.

- [ ] **Step 4: Verify** — `npx vitest run src/db/sessions.test.ts src/db/sets.test.ts` passes, and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Commit** — `feat: add history data access and guard finishSession`

---

### Task 3: One past workout, read-only, with PR badges

**Files:**
- Create: `src/testFixtures.ts`, `src/ui/PrBadge.tsx`, `src/ui/PrBadge.test.tsx`, `src/ui/history/format.ts`, `src/ui/history/format.test.ts`, `src/ui/history/PastWorkoutScreen.tsx`, `src/ui/history/PastWorkoutScreen.test.tsx`
- Modify: `src/App.tsx` (route `/history/:sessionId`)

**Interfaces:**
- Consumes: Task 1 `detectAllPrs`, `PrKind`; Task 2 `listSetsForExercise`; existing `getSession`, `listSetsForSession`, `listExercises({ includeArchived: true })`, `formatSet`.
- Produces:
  - `src/testFixtures.ts` — **test-only**, imported by every later UI test:
    - `seedExercise(name?: string, measurementType?: MeasurementType): Promise<Exercise>` — via `createCustomExercise`; defaults `'Barbell Bench Press'`, `'weight_reps'`
    - `interface SeedSet { exerciseId: string; completedAt: number; weight?: number; reps?: number; unit?: WeightUnit; setType?: SetType; durationSeconds?: number; order?: number }` — `order`, when given, overrides the positional default
    - `seedWorkout(w: { name?: string; startedAt: number; endedAt?: number | null; status?: SessionStatus; sets?: SeedSet[] }): Promise<Session>` — writes straight to the tables. Defaults: `name` `'Push A'`, `status` `'completed'`, `endedAt` = `startedAt + 3_600_000` (`null` omits it), set `unit` `'lb'`, `setType` `'working'`, and `order` = the set's position among the input's sets for the same exercise.
    - `const T = Date.UTC(2025, 0, 6, 17, 0)`, `MIN = 60_000`, `DAY = 86_400_000`
  - `PrBadge({ kinds }: { kinds: PrKind[] })` — renders `<span className="pr-badge">` with the text `PR: ` followed by labels joined with `, `. The labels: `heaviest` → `heaviest`; `e1rm` → `est. 1RM`; `reps` → `rep best`.
  - `formatWorkoutDuration(startedAt: number, endedAt?: number): string` — `'—'` when `endedAt` is undefined; otherwise `` `${Math.round((endedAt - startedAt) / 60_000)} min` ``.
  - `PastWorkoutScreen` at `/history/:sessionId`.

**Screen contract.** One querier, which reads:
- the session;
- its sets;
- every exercise, archived included;
- `listSetsForExercise` for each distinct exercise in the session — **the full history, not just this workout's sets**.

It runs `detectAllPrs` over the union of those exercise histories. It renders:
- `<h2>` with the session name;
- a `<p>` with the start time (`toLocaleString()`) and the duration;
- per exercise, in order of its earliest set's `completedAt`, an `<h3>` with the exercise name, followed by ` (archived)` when archived;
- an `<ol>` of its sets as `` `${n}. ${formatSet(set, type)}` ``, followed by ` (warm-up)` for warm-ups, and then a `PrBadge` when the set earned kinds. **The number, the `formatSet` text and the warm-up marker go inside one `<span>`, with the `PrBadge` as its sibling.** Task 5 adds Edit and Delete buttons to the same `<li>`, and this test file matches the set text exactly — text sitting directly in the `<li>` would silently break it then.

It handles three special cases:
- An unknown id renders `<p role="alert">Workout not found.</p>` and a link back to `/history`.
- An in-progress id renders `<Navigate to="/session" replace />`.
- A workout with no sets renders `No sets were logged.`

- [ ] **Step 1: Write the failing tests**

`src/ui/PrBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { PrBadge } from './PrBadge';

it('names every kind a set earned, in order', () => {
  render(<PrBadge kinds={['heaviest', 'e1rm', 'reps']} />);
  expect(screen.getByText('PR: heaviest, est. 1RM, rep best')).toBeInTheDocument();
});
```

`src/ui/history/format.test.ts`:

```ts
import { formatWorkoutDuration } from './format';

it('shows whole minutes', () => expect(formatWorkoutDuration(0, 75 * 60_000 + 20_000)).toBe('75 min'));
it('shows a dash when the workout has no end', () => expect(formatWorkoutDuration(0, undefined)).toBe('—'));
```

`src/ui/history/PastWorkoutScreen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { archiveExercise, updateExercise } from '../../db/exercises';
import { DAY, MIN, T, seedExercise, seedWorkout } from '../../testFixtures';
import { PastWorkoutScreen } from './PastWorkoutScreen';

beforeEach(async () => {
  await resetDbForTests();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/history/:sessionId" element={<PastWorkoutScreen />} />
        <Route path="/history" element={<p>History list</p>} />
        <Route path="/session" element={<p>Active session</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

it('shows the workout, its exercises in the order trained, and their sets', async () => {
  // Every plausible wrong ordering disagrees with the right one here:
  // alphabetical, exercise creation order, seed-array order, and first
  // appearance in listSetsForSession's (order, completedAt) sort. The bench's
  // only set has order 1, as it would after its first set was deleted.
  const squat = await seedExercise('Back Squat');
  const bench = await seedExercise('Barbell Bench Press');
  const w = await seedWorkout({
    startedAt: T,
    sets: [
      { exerciseId: squat.id, weight: 315, reps: 5, completedAt: T + 10 * MIN },
      { exerciseId: squat.id, weight: 315, reps: 4, setType: 'warmup', completedAt: T + 11 * MIN },
      { exerciseId: bench.id, weight: 185, reps: 8, order: 1, completedAt: T + MIN },
    ],
  });
  renderAt(`/history/${w.id}`);
  expect(await screen.findByRole('heading', { level: 2, name: 'Push A' })).toBeInTheDocument();
  expect(screen.getByText(new Date(T).toLocaleString(), { exact: false })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent))
    .toEqual(['Barbell Bench Press', 'Back Squat']);
  expect(screen.getByText('1. 315 lb × 5')).toBeInTheDocument();
  expect(screen.getByText('2. 315 lb × 4 (warm-up)', { exact: false })).toBeInTheDocument();
});

it('badges a set that beat every earlier workout', async () => {
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T - DAY, sets: [{ exerciseId: bench.id, weight: 225, reps: 5, completedAt: T - DAY + MIN }] });
  const w = await seedWorkout({ startedAt: T, sets: [{ exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + MIN }] });
  renderAt(`/history/${w.id}`);
  expect(await screen.findByText('PR: heaviest, est. 1RM')).toBeInTheDocument();
});

it('judges PRs against the full history, not just this workout', async () => {
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T - DAY, sets: [{ exerciseId: bench.id, weight: 245, reps: 5, completedAt: T - DAY + MIN }] });
  const w = await seedWorkout({
    startedAt: T,
    sets: [
      { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
      { exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + 2 * MIN },
    ],
  });
  renderAt(`/history/${w.id}`);
  await screen.findByText('2. 235 lb × 5', { exact: false });
  expect(screen.queryByText(/PR:/)).not.toBeInTheDocument();
});

it('says so when the workout is not found', async () => {
  renderAt('/history/nope');
  expect(await screen.findByRole('alert')).toHaveTextContent(/workout not found/i);
  expect(screen.getByRole('link', { name: /history/i })).toHaveAttribute('href', '/history');
});

it('sends the workout in progress to the active session', async () => {
  const w = await seedWorkout({ startedAt: T, status: 'in_progress', endedAt: null });
  renderAt(`/history/${w.id}`);
  expect(await screen.findByText('Active session')).toBeInTheDocument();
});

it('still shows a workout whose exercise was archived later, marked archived', async () => {
  const bench = await seedExercise();
  const w = await seedWorkout({ startedAt: T, sets: [{ exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN }] });
  await archiveExercise(bench.id);
  renderAt(`/history/${w.id}`);
  expect(await screen.findByRole('heading', { level: 3, name: 'Barbell Bench Press (archived)' })).toBeInTheDocument();
});

it('drops badges for an exercise retyped away from weight × reps', async () => {
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T - DAY, sets: [{ exerciseId: bench.id, weight: 225, reps: 5, completedAt: T - DAY + MIN }] });
  const w = await seedWorkout({ startedAt: T, sets: [{ exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + MIN }] });
  await updateExercise(bench.id, { measurementType: 'bodyweight_reps' });
  renderAt(`/history/${w.id}`);
  await screen.findByRole('heading', { level: 3 });
  expect(screen.queryByText(/PR:/)).not.toBeInTheDocument();
});

it('shows a workout whose sets were all deleted', async () => {
  const w = await seedWorkout({ startedAt: T, sets: [] });
  renderAt(`/history/${w.id}`);
  expect(await screen.findByText('No sets were logged.')).toBeInTheDocument();
});
```

Later tasks extend this file's imports as their tests need them. Import nothing a test in the current commit doesn't use: `noUnusedLocals` makes an unused import fail `tsc`.

- [ ] **Step 2: Verify they fail** — `npx vitest run src/ui/PrBadge.test.tsx src/ui/history` fails on unresolved modules.

- [ ] **Step 3: Implement** `src/testFixtures.ts`, `PrBadge`, `format.ts` and `PastWorkoutScreen`, and register `<Route path="/history/:sessionId" element={<PastWorkoutScreen />} />` inside the `AppLayout` route in `src/App.tsx`. Distinguish loading from not-found as `RoutineEditor` does: the querier returns `null` for not found, and `undefined` means loading.

- [ ] **Step 4: Verify** — the focused tests pass and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Commit** — `feat: show a past workout with its PRs`

---

### Task 4: The History list and tab

**Files:**
- Create: `src/ui/history/HistoryScreen.tsx`, `src/ui/history/HistoryScreen.test.tsx`
- Modify: `src/App.tsx` (route `/history`), `src/ui/AppLayout.tsx` (tab), `src/ui/AppLayout.test.tsx`, `src/App.test.tsx`

**Interfaces:**
- Consumes: Task 2 `listCompletedSessions`, `listAllSets`; Task 1 `detectAllPrs`; Task 3 `formatWorkoutDuration`, fixtures; `listExercises`.
- Produces: `HistoryScreen` at `/history`, and a `History` tab between Today and Routines.

**Screen contract.** One querier: `listCompletedSessions`, `listAllSets` and every exercise, archived included. It runs `detectAllPrs` once over all sets. It renders:
- `<h2>History</h2>`;
- an `<ol>` with one `<li>` per workout, keyed by id. Each holds a `<Link to={`/history/${id}`}>` whose text is the workout name, then the text `` `${toLocaleString(startedAt)} · ${duration} · ${n} sets` ``, where `n` counts working sets only — **singular `1 set` when `n` is 1**, pluralized the same way as the PR count;
- the suffix `` ` · ${p} PR` `` or `` ` · ${p} PRs` ``, only when `p > 0`. `p` counts the workout's sets that earned any kind.

With no workouts it shows `No finished workouts yet.`

- [ ] **Step 1: Write the failing tests**

`src/ui/history/HistoryScreen.test.tsx` (same `MemoryRouter` pattern as Task 3, with routes `/history` → `HistoryScreen` and `/history/:sessionId` → `<p>Workout detail</p>`):

```tsx
it('lists finished workouts newest first, without the one in progress', async () => {
  // Names chosen so newest-first is neither alphabetical nor seed order.
  await seedWorkout({ name: 'Aardvark', startedAt: T - 2 * DAY });
  await seedWorkout({ name: 'Zebra', startedAt: T });
  await seedWorkout({ name: 'Live', startedAt: T + DAY, status: 'in_progress', endedAt: null });
  renderAt('/history');
  await screen.findByRole('link', { name: 'Zebra' });
  expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Zebra', 'Aardvark']);
});

it('shows the date, duration, working-set count and PR count', async () => {
  const bench = await seedExercise();
  await seedWorkout({ name: 'First', startedAt: T - DAY, sets: [{ exerciseId: bench.id, weight: 225, reps: 5, completedAt: T - DAY + MIN }] });
  await seedWorkout({
    name: 'Second', startedAt: T, endedAt: T + 75 * MIN,
    sets: [
      { exerciseId: bench.id, weight: 135, reps: 10, setType: 'warmup', completedAt: T + MIN },
      { exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + 2 * MIN },
      { exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + 3 * MIN },
    ],
  });
  renderAt('/history');
  const row = (await screen.findByRole('link', { name: 'Second' })).closest('li')!;
  expect(row).toHaveTextContent(`${new Date(T).toLocaleString()} · 75 min · 2 sets · 1 PR`);
  const firstRow = screen.getByRole('link', { name: 'First' }).closest('li')!;
  expect(firstRow).not.toHaveTextContent('PR');
  // "1 sets" would pass a plain substring match on "1 set".
  expect(firstRow.textContent).toMatch(/· 1 set(?!s)/);
});

it('shows a dash rather than NaN when a workout has no end time', async () => {
  await seedWorkout({ name: 'Unended', startedAt: T, endedAt: null });
  renderAt('/history');
  const row = (await screen.findByRole('link', { name: 'Unended' })).closest('li')!;
  expect(row).toHaveTextContent('—');
  expect(row).not.toHaveTextContent('NaN');
});

it('says so when nothing has been finished yet', async () => {
  renderAt('/history');
  expect(await screen.findByText('No finished workouts yet.')).toBeInTheDocument();
});

it('opens a workout', async () => {
  const user = userEvent.setup();
  await seedWorkout({ name: 'Push A', startedAt: T });
  renderAt('/history');
  await user.click(await screen.findByRole('link', { name: 'Push A' }));
  expect(await screen.findByText('Workout detail')).toBeInTheDocument();
});
```

In `src/ui/AppLayout.test.tsx`'s `offers navigation to each section`, add `expect(screen.getByRole('link', { name: 'History' })).toBeInTheDocument();`.

In `src/App.test.tsx`, add this test. It builds the path from `import.meta.env.BASE_URL`, which is the router's basename, rather than assuming what Vitest sets it to:

```tsx
it('routes /history to the History screen', async () => {
  const base = import.meta.env.BASE_URL;
  window.history.pushState({}, '', `${base}history`);
  try {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'History' }, { timeout: 5000 })).toBeInTheDocument();
    await expect.poll(() => db.exercises.count()).toBeGreaterThan(100);
  } finally {
    window.history.pushState({}, '', base);
  }
});
```

- [ ] **Step 2: Verify they fail** — the focused runs fail: no module, no tab, no route.

- [ ] **Step 3: Implement** the screen, add `<Route path="/history" element={<HistoryScreen />} />`, and add `{ to: '/history', label: 'History', end: false }` to `TABS` after Today.

- [ ] **Step 4: Verify** — `npx vitest run src/ui/history src/ui/AppLayout.test.tsx src/App.test.tsx` passes, and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Commit** — `feat: add the History list and tab`

---

### Task 5: Fix, delete and add sets in a past workout

**Files:**
- Create: `src/ui/history/PastSetRow.tsx`, `src/ui/history/AddSetForm.tsx`, `src/ui/useWriteError.test.tsx`
- Modify: `src/ui/useWriteError.ts`, `src/domain/measurement.ts` (+ its test), `src/ui/session/ActiveSessionScreen.tsx`, `src/ui/history/PastWorkoutScreen.tsx` (+ its test)

**Interfaces:**
- Consumes: Task 2 `addForgottenSet`; existing `updateSet`, `deleteSet`, `measurementFields`.
- Produces:
  - `run(write): Promise<boolean>` — resolves `true` when `write` resolved and `false` when it rejected, still surfacing the message. All existing callers keep working unchanged; new code uses `if (await run(...))` instead of the `let wrote = false` idiom.
  - `parseSetFields(fields: SetFieldSpec[], raw: (property: SetFieldSpec['property']) => string): Partial<Pick<LoggedSet, 'weight' | 'reps' | 'durationSeconds' | 'distanceMeters'>>` in `src/domain/measurement.ts`. It is the exact loop now inside `confirmSet` (`ActiveSessionScreen.tsx` around line 273): blank or `NaN` fields are omitted. **`confirmSet` is rewritten to call it**, so the two edit surfaces cannot drift.
  - `PastSetRow`, `AddSetForm` — rendered by `PastWorkoutScreen`.

**Accessible names**, which must be unique across a workout with several exercises:
- `Edit ${exerciseName} set ${n}` and `Delete ${exerciseName} set ${n}`;
- inside the edit and add forms, inputs named `` `${field.label}` `` and a checkbox `Warm-up`, scoped by a `<form aria-label=…>`. The edit form is `` `Edit ${exerciseName} set ${n}` ``; the add form is `` `Add a set to ${exerciseName}` ``;
- buttons `Save` and `Cancel` inside each form, and `Add set to ${exerciseName}` under each exercise.

**Behaviour:**
- **Edit** writes `updateSet(id, { ...parseSetFields(...), setType })`.
- **Add** prefills its fields and unit from that exercise's last set in this workout, and writes `addForgottenSet({ sessionId, exerciseId, unit, setType, ...parsed })`.
- If **nothing parses**, the form writes nothing and stays open.
- On **failure**, the form stays open with the typed values and shows the error from `run`.

- [ ] **Step 1: Write the failing tests**

`src/ui/useWriteError.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { useWriteError } from './useWriteError';

it('resolves true when the write lands and false when it fails, surfacing the message', async () => {
  const { result } = renderHook(() => useWriteError());
  let ok: boolean | undefined;
  await act(async () => { ok = await result.current.run(async () => {}); });
  expect(ok).toBe(true);
  await act(async () => { ok = await result.current.run(async () => { throw new Error('quota exceeded'); }); });
  expect(ok).toBe(false);
  expect(result.current.error).toBe('quota exceeded');
});
```

Add to `src/domain/measurement.test.ts`, importing `parseSetFields`:

```ts
describe('parseSetFields', () => {
  const fields = measurementFields('weight_reps');
  it('keeps numeric fields, zero included', () => {
    expect(parseSetFields(fields, (p) => (p === 'weight' ? '135' : '0'))).toEqual({ weight: 135, reps: 0 });
  });
  it('drops blank and non-numeric fields', () => {
    expect(parseSetFields(fields, (p) => (p === 'weight' ? ' ' : 'abc'))).toEqual({});
  });
});
```

Add to `src/ui/history/PastWorkoutScreen.test.tsx`. At the top, mock `../../db/sets` the way `ActiveSessionScreen.test.tsx` does, wrapping `updateSet` and `addForgottenSet` in `vi.fn(actual.…)` so that only the tests that need it can make one call reject. Extend the imports with:
- `within` and `waitFor` from `@testing-library/react`;
- `userEvent`;
- `updateSet`, `addForgottenSet` and `listSetsForSession` from `../../db/sets`.

```tsx
async function benchWorkout() {
  const bench = await seedExercise();
  const w = await seedWorkout({
    startedAt: T,
    sets: [
      { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
      { exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + 2 * MIN },
    ],
  });
  return { bench, w };
}

it('fixes a set\'s numbers and warm-up flag', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  const form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.type(within(form).getByLabelText(/reps/i), '6');
  await user.click(within(form).getByLabelText('Warm-up'));
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('1. 225 lb × 6 (warm-up)', { exact: false })).toBeInTheDocument();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
});

it('leaves a field unchanged when it is cleared', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  const form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  // The old text is on screen before the save too, so asserting it would pass
  // vacuously. The form closes only once run() resolved true — the write has
  // landed — so read the stored set after that.
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument());
  const [first] = await listSetsForSession(w.id);
  expect(first.reps).toBe(5);
  expect(first.weight).toBe(225);
});

it('keeps what was typed when saving a set fails', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  vi.mocked(updateSet).mockRejectedValueOnce(new Error('quota exceeded'));
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  const form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.type(within(form).getByLabelText(/reps/i), '9');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/quota exceeded/i);
  expect(within(form).getByLabelText(/reps/i)).toHaveValue(9);
});

it('deletes a set', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Delete Barbell Bench Press set 1' }));
  expect(await screen.findByText('1. 235 lb × 5', { exact: false })).toBeInTheDocument();
  expect(screen.queryByText(/225 lb/)).not.toBeInTheDocument();
});

it('removes an exercise from the workout when its last set is deleted', async () => {
  const user = userEvent.setup();
  const bench = await seedExercise();
  const squat = await seedExercise('Back Squat');
  const w = await seedWorkout({
    startedAt: T,
    sets: [
      { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
      { exerciseId: squat.id, weight: 315, reps: 5, completedAt: T + 2 * MIN },
    ],
  });
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Delete Back Squat set 1' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Back Squat' })).not.toBeInTheDocument());
});

it('adds a forgotten set after that exercise\'s last set, prefilled from it', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Add set to Barbell Bench Press' }));
  const form = screen.getByRole('form', { name: 'Add a set to Barbell Bench Press' });
  expect(within(form).getByLabelText(/weight/i)).toHaveValue(235);
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.type(within(form).getByLabelText(/reps/i), '3');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('3. 235 lb × 3', { exact: false })).toBeInTheDocument();
});

it('keeps a forgotten set\'s values when saving it fails', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  vi.mocked(addForgottenSet).mockRejectedValueOnce(new Error('quota exceeded'));
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Add set to Barbell Bench Press' }));
  const form = screen.getByRole('form', { name: 'Add a set to Barbell Bench Press' });
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.type(within(form).getByLabelText(/reps/i), '2');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/quota exceeded/i);
  expect(within(form).getByLabelText(/reps/i)).toHaveValue(2);
});

it('re-evaluates later badges when an earlier set is edited', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout(); // set 2 (235 × 5) is the heaviest PR
  renderAt(`/history/${w.id}`);
  expect(await screen.findByText('PR: heaviest, est. 1RM')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  const form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  await user.clear(within(form).getByLabelText(/weight/i));
  await user.type(within(form).getByLabelText(/weight/i), '245');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByText(/PR:/)).not.toBeInTheDocument());
});
```

- [ ] **Step 2: Verify they fail** — `npx vitest run src/ui/useWriteError.test.tsx src/domain/measurement.test.ts src/ui/history` fails on the new tests only.

- [ ] **Step 3: Implement**, in this order:
  1. `run` returns its boolean.
  2. Extract `parseSetFields` and rewrite `confirmSet` to use it. Then **run `npx vitest run src/ui/session` and confirm all of the session screen's existing tests still pass before going further** — that is the proof the extraction changed nothing.
  3. Write `PastSetRow` and `AddSetForm`, and wire them into `PastWorkoutScreen`.

  Each form keeps its own draft strings in local state seeded at mount, so a re-render from the querier cannot overwrite what is being typed.

- [ ] **Step 4: Verify** — the focused runs pass, `npx vitest run src/ui/session` passes, and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Commit** — `feat: fix, delete and add sets in a past workout`

---

### Task 6: Move or delete a past workout

**Files:**
- Modify: `src/ui/history/format.ts` (+ test), `src/ui/history/PastWorkoutScreen.tsx` (+ test)

**Interfaces:**
- Consumes: Task 2 `moveSession`, `deleteCompletedSession`; Task 5 `run(): Promise<boolean>`.
- Produces:
  - `toDateTimeLocalValue(ms: number): string` — local `YYYY-MM-DDTHH:mm`, zero-padded
  - `fromDateTimeLocalValue(value: string): number` — epoch ms, or `NaN` when unparseable

**Controls on `PastWorkoutScreen`:**
- **`Change date and time`** opens an `<input type="datetime-local">` labelled `Workout start`, prefilled with `toDateTimeLocalValue(startedAt)`, plus `Save` and `Cancel`.
  - Save sends `moveSession(id, fromDateTimeLocalValue(value))`. An unparseable value writes nothing. A failure keeps the input and its value.
- **`Delete workout`** shows `Delete this workout and everything logged in it?` with `Yes, delete it` and `Keep it`.
  - `Yes, delete it` calls `deleteCompletedSession`, then navigates to `/history` — but only if `run` resolved `true`.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/history/format.test.ts`:

```ts
it('formats a timestamp for a datetime-local input, in local time', () => {
  expect(toDateTimeLocalValue(new Date(2025, 0, 6, 7, 5).getTime())).toBe('2025-01-06T07:05');
});
it('parses a datetime-local value back, in local time', () => {
  expect(fromDateTimeLocalValue('2025-01-06T07:05')).toBe(new Date(2025, 0, 6, 7, 5).getTime());
});
it('gives NaN for an empty value', () => expect(fromDateTimeLocalValue('')).toBeNaN());
```

Add to `src/ui/history/PastWorkoutScreen.test.tsx`, extending its imports with `fireEvent`, `getSession` from `../../db/sessions`, and `toDateTimeLocalValue` from `./format`. Use `fireEvent.change` for the datetime input, because user-event cannot type into one in jsdom.

```tsx
it('moves the workout to a new date and time', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Change date and time' }));
  const target = new Date(2024, 11, 30, 18, 30).getTime();
  fireEvent.change(screen.getByLabelText('Workout start'), { target: { value: toDateTimeLocalValue(target) } });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(new Date(target).toLocaleString(), { exact: false })).toBeInTheDocument();
  expect((await getSession(w.id))?.startedAt).toBe(target);
});

it('refuses a time that would end in the future, keeping the input', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Change date and time' }));
  const value = toDateTimeLocalValue(Date.now() + DAY);
  fireEvent.change(screen.getByLabelText('Workout start'), { target: { value } });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/future/i);
  expect(screen.getByLabelText('Workout start')).toHaveValue(value);
});

it('asks before deleting the workout, and Keep it changes nothing', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Delete workout' }));
  await user.click(screen.getByRole('button', { name: 'Keep it' }));
  expect(await getSession(w.id)).toBeDefined();
});

it('deletes the workout and returns to the list', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Delete workout' }));
  await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));
  expect(await screen.findByText('History list')).toBeInTheDocument();
  expect(await getSession(w.id)).toBeUndefined();
});
```

- [ ] **Step 2: Verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** — `npx vitest run src/ui/history` passes, and `npx tsc --noEmit` exits 0.
- [ ] **Step 5: Commit** — `feat: move or delete a past workout`

---

### Task 7: An exercise's records, and the links to it

**Files:**
- Create: `src/ui/records/RecordsScreen.tsx`, `src/ui/records/RecordsScreen.test.tsx`
- Modify: `src/App.tsx` (route `/exercises/:exerciseId/records`), `src/ui/history/PastWorkoutScreen.tsx` (+ test), `src/ui/library/LibraryScreen.tsx`, `src/ui/library/LibraryScreen.test.tsx`, `src/domain/records.test.ts` (one test Task 1 lacked)

**Interfaces:**
- Consumes: Task 1 `exerciseRecords`; Task 2 `listSetsForExercise`; `getExercise`; `formatSet`.
- Produces: `RecordsScreen` at `/exercises/:exerciseId/records`.

**Screen contract.** One querier, reading the exercise and `listSetsForExercise`. It renders:
- `<h2>` `` `${name} — records` ``.
- For a `weight_reps` exercise with records:
  - `Heaviest: ${formatSet(set)}`;
  - `Best est. 1RM: ${value.toFixed(1)} ${unit}, from ${formatSet(set)}`;
  - an `<ol aria-label="Rep bests">` of `` `${formatSet(set)}` `` rows.
  - Each of the three ends with ` · ${toLocaleDateString(completedAt)}`.
- `Records are kept for weight-and-reps exercises only.` for any other type.
- `No working sets logged yet.` when there are no records.
- `<p role="alert">Exercise not found.</p>` for an unknown id.

**Links:**
- In `PastWorkoutScreen`, each `weight_reps` exercise's `<h3>` text becomes a `<Link>` to its records. Other types stay plain text.
- In `LibraryScreen`, when an **existing** exercise is open in the edit form, a `<Link>` named `Records` to its page renders **beside the form**, not inside it. `CustomExerciseForm` and its tests stay router-free.

**`LibraryScreen.test.tsx` renders without a router today, so the new `Link` would crash all ten of its tests.** Add a `renderLibrary()` helper that wraps `<LibraryScreen />` in a `MemoryRouter`, and replace each `render(<LibraryScreen />)` with it **first**. Then confirm the file still passes, unchanged in behaviour, before adding anything.

- [ ] **Step 1: Write the failing tests**

`src/ui/records/RecordsScreen.test.tsx`, with routes `/exercises/:exerciseId/records` → `RecordsScreen`:

```tsx
it('shows the heaviest set, the best estimate and the rep bests', async () => {
  // The heavier rep best is logged LAST, so heaviest-first is neither
  // chronological nor alphabetical.
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T, sets: [
    { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
    { exerciseId: bench.id, weight: 225, reps: 6, completedAt: T + 2 * MIN },
    { exerciseId: bench.id, weight: 235, reps: 3, completedAt: T + 3 * MIN },
  ] });
  renderAt(`/exercises/${bench.id}/records`);
  expect(await screen.findByText('Heaviest: 235 lb × 3', { exact: false })).toBeInTheDocument();
  expect(screen.getByText('Best est. 1RM: 270.0 lb, from 225 lb × 6', { exact: false })).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'Rep bests' })).getAllByRole('listitem').map((li) => li.textContent?.split(' · ')[0]))
    .toEqual(['235 lb × 3', '225 lb × 6']);
});

it('lists different units as separate rep bests, ordered by real weight', async () => {
  // 100 kg and 100 lb stay separate rows. Kilogram order (100 kg, 60 kg,
  // 100 lb) differs from raw-number order, alphabetical order and
  // chronological order, so only a real conversion produces it.
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T, sets: [
    { exerciseId: bench.id, unit: 'lb', weight: 100, reps: 8, completedAt: T + MIN },
    { exerciseId: bench.id, unit: 'kg', weight: 60, reps: 5, completedAt: T + 2 * MIN },
    { exerciseId: bench.id, unit: 'kg', weight: 100, reps: 3, completedAt: T + 3 * MIN },
  ] });
  renderAt(`/exercises/${bench.id}/records`);
  const rows = within(await screen.findByRole('list', { name: 'Rep bests' })).getAllByRole('listitem');
  expect(rows.map((li) => li.textContent?.split(' · ')[0])).toEqual(['100 kg × 3', '60 kg × 5', '100 lb × 8']);
});

it('says records are kept for weight-and-reps exercises only', async () => {
  const plank = await seedExercise('Plank', 'duration');
  renderAt(`/exercises/${plank.id}/records`);
  expect(await screen.findByText('Records are kept for weight-and-reps exercises only.')).toBeInTheDocument();
});

it('says so when nothing has been logged', async () => {
  const bench = await seedExercise();
  renderAt(`/exercises/${bench.id}/records`);
  expect(await screen.findByText('No working sets logged yet.')).toBeInTheDocument();
});

it('says so when the exercise is not found', async () => {
  renderAt('/exercises/nope/records');
  expect(await screen.findByRole('alert')).toHaveTextContent('Exercise not found.');
});
```

Add to `src/domain/records.test.ts`, inside `describe('exerciseRecords')`. Task 1's rep-best tests logged their sets in heaviest-first order, so a chronological sort passed them:

```ts
it('lists rep bests heaviest first, not in the order they were set', () => {
  const light = set({ weight: 185, reps: 10, completedAt: 1 });
  const mid = set({ weight: 225, reps: 6, completedAt: 2 });
  const heavy = set({ weight: 235, reps: 3, completedAt: 3 });
  expect(exerciseRecords([light, mid, heavy]).repBests.map((s) => s.id)).toEqual([heavy.id, mid.id, light.id]);
});
```

This test passes against Task 1's code, because the sort is already right. Prove it has teeth: replace the rep-best sort with a chronological one, confirm the test fails, then restore.

Add to `PastWorkoutScreen.test.tsx`:

```tsx
it('links weight-and-reps exercises to their records, and nothing else', async () => {
  const bench = await seedExercise();
  const plank = await seedExercise('Plank', 'duration');
  const w = await seedWorkout({ startedAt: T, sets: [
    { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
    { exerciseId: plank.id, durationSeconds: 60, completedAt: T + 2 * MIN },
  ] });
  renderAt(`/history/${w.id}`);
  expect(await screen.findByRole('link', { name: 'Barbell Bench Press' }))
    .toHaveAttribute('href', `/exercises/${bench.id}/records`);
  expect(screen.queryByRole('link', { name: 'Plank' })).not.toBeInTheDocument();
});
```

Add to `LibraryScreen.test.tsx`, after the helper change. Its `beforeEach` already creates `Barbell Bench Press`:

```tsx
it('links an open exercise to its records', async () => {
  const user = userEvent.setup();
  renderLibrary();
  await user.click(await screen.findByRole('button', { name: /barbell bench press/i }));
  const bench = (await db.exercises.toArray()).find((e) => e.name === 'Barbell Bench Press')!;
  expect(await screen.findByRole('link', { name: 'Records' }))
    .toHaveAttribute('href', `/exercises/${bench.id}/records`);
});
```

- [ ] **Step 2: Verify they fail.**
- [ ] **Step 3: Implement**, and register the route.
- [ ] **Step 4: Verify** — `npx vitest run src/ui/records src/ui/history src/ui/library` passes, and `npx tsc --noEmit` exits 0.
- [ ] **Step 5: Commit** — `feat: add per-exercise records`

---

### Task 8: Live PR badges while logging

**Files:**
- Modify: `src/ui/session/ActiveSessionScreen.tsx`, `src/ui/session/LoggedSetList.tsx`, `src/ui/session/ActiveSessionScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1 `detectAllPrs`, `PrKind`; Task 2 `listSetsForExercise`; Task 3 `PrBadge`, fixtures.
- Produces:
  - `LoggedSetList` gains an optional `prs?: Map<string, PrKind[]>`, and renders `<PrBadge kinds={…} />` after a set's text when the set has kinds.
  - The session screen's querier returns `prs`: `detectAllPrs` over `listSetsForExercise` for each distinct exercise among this session's logged sets, with the exercises it already loads.

**This is the only change to `ActiveSessionScreen`.** It stays inside the existing querier — no second `useLiveQuery`.

- [ ] **Step 1: Write the failing tests** — add to `src/ui/session/ActiveSessionScreen.test.tsx`, using its existing `benchRoutine`, `renderScreen` and `startSession`, plus `seedWorkout`/`T`/`MIN` from `../../testFixtures`:

```tsx
it('badges a set the moment it beats every earlier workout', async () => {
  const user = userEvent.setup();
  const { exercise, routine } = await benchRoutine('Push A', 1);
  await seedWorkout({ startedAt: T, sets: [{ exerciseId: exercise.id, weight: 225, reps: 5, completedAt: T + MIN }] });
  await startSession(routine);
  renderScreen();
  const weight = await screen.findByLabelText(/weight for set 1/i);
  await user.clear(weight);
  await user.type(weight, '235');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));
  expect(await screen.findByText('PR: heaviest, est. 1RM')).toBeInTheDocument();
});

it('does not badge the first set ever logged for an exercise', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 1);
  await startSession(routine);
  renderScreen();
  await user.type(await screen.findByLabelText(/weight for set 1/i), '235');
  await user.type(screen.getByLabelText(/reps for set 1/i), '5');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));
  await screen.findByText(/235 lb × 5/);
  expect(screen.queryByText(/PR:/)).not.toBeInTheDocument();
});

it('does not badge a warm-up', async () => {
  const user = userEvent.setup();
  const { exercise, routine } = await benchRoutine('Push A', 1);
  await seedWorkout({ startedAt: T, sets: [{ exerciseId: exercise.id, weight: 225, reps: 5, completedAt: T + MIN }] });
  await startSession(routine);
  renderScreen();
  const weight = await screen.findByLabelText(/weight for set 1/i);
  await user.clear(weight);
  await user.type(weight, '300');
  await user.click(screen.getByLabelText(/mark set 1 as a warm-up/i));
  await user.click(screen.getByRole('button', { name: /log set 1/i }));
  await screen.findByText(/300 lb × 5/);
  expect(screen.queryByText(/PR:/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Verify they fail.** The first test fails; the other two pass, because they assert absences. Once Step 3 is implemented, prove both absence tests have teeth with two temporary breaks, restoring each:
  - Treat warm-ups as qualifying inside `records.ts`, and confirm `does not badge a warm-up` fails.
  - Drop the "a previous value exists" guard, and confirm `does not badge the first set ever logged` fails.

  Record both in the report.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.**
  - `npx vitest run src/ui/session` passes, all existing tests included.
  - `npx tsc --noEmit` exits 0.
  - The full suite `npx vitest run --fileParallelism=false` passes. Report the file and test counts; expect **38 files and about 508 tests** (420 + 88 new across the plan). A different number is fine if every new test is accounted for. Roughly double is the worktree red flag.
- [ ] **Step 5: Commit** — `feat: badge PRs live while logging`

---

## After the plan

**Manual checks on the phone**, because no unit test covers the deployed app:

1. Finish a workout. It appears at the top of History with the right duration, and opening it shows every set.
2. Fix a typo in a past set and change a past workout's date. The next workout's "last time" line follows the change.
3. Log a set heavier than ever before. It's badged the moment it's logged.

**Not in this plan:** the silent rest tone and the post-deploy reload that discards typed set values. Both are recorded in `docs/superpowers/specs/2026-09-05-rest-timer-design.md`, and the user deprioritized both.
