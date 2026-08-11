import { db, resetDbForTests } from './db';
import {
  listRoutines, getRoutine, createRoutine, renameRoutine,
  setRoutineItems, archiveRoutine, unarchiveRoutine,
} from './routines';
import { getOrCreateActiveCycle, saveCycle } from './cycles';
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
