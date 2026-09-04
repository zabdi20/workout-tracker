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
