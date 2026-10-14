import { db, resetDbForTests } from './db';
import {
  addForgottenSet,
  deleteSet,
  lastPerformance,
  listAllSets,
  listSetsForExercise,
  listSetsForSession,
  logSet,
  updateSet,
} from './sets';

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

describe('lastPerformance', () => {
  it('returns an empty array when the exercise has no history', async () => {
    expect(await lastPerformance('bench', 'current')).toEqual([]);
  });

  it('returns the previous session’s sets for that exercise, ordered', async () => {
    const older = await logSet(bench('older', 125, 8));
    const first = await logSet(bench('previous', 135, 8));
    const second = await logSet(bench('previous', 145, 6));
    const current = await logSet(bench('current', 155, 5));

    // Stamped explicitly, the same way the non-contiguous test below does.
    // logSet uses Date.now(), so four writes can land in the same
    // millisecond; [exerciseId+completedAt] then ties on primary key and the
    // reverse walk picks whichever session happens to own the highest UUID —
    // a one-in-three chance of answering with the `older` session. Real sets
    // are minutes apart, so the fixture is what should be pinned down, not
    // logSet or the index: there is no natural tiebreak at the schema level.
    const base = Date.now();
    await db.sets.update(older.id, { completedAt: base });
    await db.sets.update(first.id, { completedAt: base + 1 });
    await db.sets.update(second.id, { completedAt: base + 2 });
    await db.sets.update(current.id, { completedAt: base + 3 });

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
