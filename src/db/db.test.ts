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

describe('archived-state filtering', () => {
  it('filters archived exercises in memory rather than via an indexed query', async () => {
    const active = makeExercise({ name: 'Active Exercise', isArchived: false });
    const archived = makeExercise({ name: 'Archived Exercise', isArchived: true });
    await db.exercises.bulkAdd([active, archived]);

    // isArchived is a boolean, which is not a valid IndexedDB key, so it is
    // deliberately not indexed. Confirm the intended access pattern instead:
    // load everything and filter in memory.
    const nonArchived = (await db.exercises.toArray()).filter((e) => !e.isArchived);

    expect(nonArchived.map((e) => e.id)).toEqual([active.id]);
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
