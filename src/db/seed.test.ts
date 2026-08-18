import { db, SETTINGS_ID, resetDbForTests } from './db';
import { prepareLibrary, LIBRARY_VERSION } from './seed';
import { createCustomExercise, archiveExercise, getExercise } from './exercises';
import bundled from '../data/exercises.json';
import type { Exercise } from './types';

const BUNDLE = bundled as Exercise[];

beforeEach(async () => {
  await resetDbForTests();
});

/**
 * Puts the database in the state of a device seeded at an earlier revision:
 * the library present except for its newest entries, stamped with the
 * previous version. Returns the ids the device is missing.
 */
async function seedAtOlderRevision(
  opts: { missing: number; stampVersion?: boolean },
): Promise<string[]> {
  const cutoff = BUNDLE.length - opts.missing;
  await db.exercises.bulkAdd(BUNDLE.slice(0, cutoff));
  await db.settings.put({
    id: SETTINGS_ID,
    unitPreference: 'lb',
    defaultRestSeconds: 90,
    restAlertSound: true,
    ...(opts.stampVersion === false ? {} : { libraryVersion: LIBRARY_VERSION - 1 }),
  });
  return BUNDLE.slice(cutoff).map((e) => e.id);
}

describe('prepareLibrary', () => {
  it('populates an empty database with the bundled library', async () => {
    const inserted = await prepareLibrary();
    expect(inserted).toBe(BUNDLE.length);
    expect(await db.exercises.count()).toBe(BUNDLE.length);
  });

  it('marks every seeded exercise as bundled and unarchived', async () => {
    await prepareLibrary();
    const all = await db.exercises.toArray();
    expect(all.every((e) => e.isCustom === false)).toBe(true);
    expect(all.every((e) => e.isArchived === false)).toBe(true);
  });

  it('is idempotent', async () => {
    const first = await prepareLibrary();
    expect(await prepareLibrary()).toBe(0);
    expect(await db.exercises.count()).toBe(first);
  });

  it('seeds exactly once when called concurrently', async () => {
    // React StrictMode invokes effects twice in development, so two calls can
    // be in flight before either has written. Without a transaction the second
    // bulkAdd fails on duplicate keys.
    const [a, b] = await Promise.all([prepareLibrary(), prepareLibrary()]);

    expect(Math.min(a, b)).toBe(0);
    expect(Math.max(a, b)).toBe(BUNDLE.length);
    expect(await db.exercises.count()).toBe(BUNDLE.length);
  });

  it('seeds alongside custom exercises without disturbing them', async () => {
    await createCustomExercise({
      name: 'My Move', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'cable', measurementType: 'weight_reps',
    });

    await prepareLibrary();

    const mine = (await db.exercises.toArray()).filter((e) => e.isCustom);
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe('My Move');
  });

  it('stamps the settings singleton with the current library version', async () => {
    await prepareLibrary();

    const settings = await db.settings.get(SETTINGS_ID);
    expect(settings?.libraryVersion).toBe(LIBRARY_VERSION);
  });

  it('leaves settings unchanged when there is nothing to do', async () => {
    await prepareLibrary();
    const before = await db.settings.get(SETTINGS_ID);

    expect(await prepareLibrary()).toBe(0);

    expect(await db.settings.get(SETTINGS_ID)).toEqual(before);
  });

  it('exports the current bundled-library revision', () => {
    expect(LIBRARY_VERSION).toBe(2);
  });
});

describe('prepareLibrary on a device seeded at an older revision', () => {
  it('inserts only the exercises the device is missing', async () => {
    const missingIds = await seedAtOlderRevision({ missing: 3 });

    expect(await prepareLibrary()).toBe(3);

    expect(await db.exercises.count()).toBe(BUNDLE.length);
    for (const id of missingIds) {
      expect(await getExercise(id)).toBeDefined();
    }
  });

  it('leaves an archived bundled exercise archived', async () => {
    // The old seed gate skipped entirely once anything was present, which is
    // what stopped archived entries coming back. Inserting by missing id has
    // to preserve that on its own: an archived row is present by id, so it
    // is never a candidate for insertion.
    await seedAtOlderRevision({ missing: 3 });
    const victim = BUNDLE[0];
    await archiveExercise(victim.id);

    await prepareLibrary();

    expect((await getExercise(victim.id))?.isArchived).toBe(true);
  });

  it('leaves a user edit to a bundled exercise intact', async () => {
    await seedAtOlderRevision({ missing: 3 });
    const victim = BUNDLE[0];
    await db.exercises.update(victim.id, { name: 'Renamed By Hand' });

    await prepareLibrary();

    expect((await getExercise(victim.id))?.name).toBe('Renamed By Hand');
  });

  it('leaves custom exercises untouched', async () => {
    await seedAtOlderRevision({ missing: 3 });
    const custom = await createCustomExercise({
      name: 'My Move', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'cable', measurementType: 'weight_reps',
    });

    await prepareLibrary();

    expect(await getExercise(custom.id)).toMatchObject({
      name: 'My Move', isCustom: true,
    });
  });

  it('stamps the new library version', async () => {
    await seedAtOlderRevision({ missing: 3 });

    await prepareLibrary();

    expect((await db.settings.get(SETTINGS_ID))?.libraryVersion).toBe(LIBRARY_VERSION);
  });

  it('preserves the rest of the settings singleton', async () => {
    await seedAtOlderRevision({ missing: 3 });
    await db.settings.update(SETTINGS_ID, { unitPreference: 'kg', defaultRestSeconds: 120 });

    await prepareLibrary();

    expect(await db.settings.get(SETTINGS_ID)).toMatchObject({
      unitPreference: 'kg', defaultRestSeconds: 120,
    });
  });

  it('treats a device seeded before libraryVersion existed as out of date', async () => {
    const missingIds = await seedAtOlderRevision({ missing: 3, stampVersion: false });

    expect(await prepareLibrary()).toBe(3);

    for (const id of missingIds) {
      expect(await getExercise(id)).toBeDefined();
    }
  });

  it('does nothing on a second run', async () => {
    await seedAtOlderRevision({ missing: 3 });
    await prepareLibrary();

    expect(await prepareLibrary()).toBe(0);
    expect(await db.exercises.count()).toBe(BUNDLE.length);
  });
});
