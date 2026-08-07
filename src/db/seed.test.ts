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

  it('seeds alongside custom exercises without disturbing them', async () => {
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
