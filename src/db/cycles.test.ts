import { db, resetDbForTests } from './db';
import { getActiveCycle, getOrCreateActiveCycle, saveCycle, removeRoutineFromAllCycles } from './cycles';

beforeEach(async () => {
  await resetDbForTests();
});

describe('getActiveCycle', () => {
  it('returns undefined when no cycle exists', async () => {
    expect(await getActiveCycle()).toBeUndefined();
  });

  it('returns the active cycle once one exists', async () => {
    const created = await getOrCreateActiveCycle();
    const found = await getActiveCycle();
    expect(found).toEqual(created);
  });
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
