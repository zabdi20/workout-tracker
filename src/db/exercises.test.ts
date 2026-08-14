import { db, resetDbForTests } from './db';
import {
  listExercises, getExercise, createCustomExercise,
  updateExercise, archiveExercise, unarchiveExercise,
} from './exercises';

beforeEach(async () => {
  await resetDbForTests();
});

describe('createCustomExercise', () => {
  it('creates a custom, unarchived exercise with a generated id', async () => {
    const ex = await createCustomExercise({
      name: 'Hammer Strength Row',
      primaryMuscles: ['lats'],
      secondaryMuscles: ['biceps'],
      equipment: 'machine',
      measurementType: 'weight_reps',
    });

    expect(ex.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(ex.isCustom).toBe(true);
    expect(ex.isArchived).toBe(false);
    await expect(getExercise(ex.id)).resolves.toEqual(ex);
  });

  it('trims whitespace from the name', async () => {
    const ex = await createCustomExercise({
      name: '  Cable Fly  ',
      primaryMuscles: ['chest'],
      secondaryMuscles: [],
      equipment: 'cable',
      measurementType: 'weight_reps',
    });
    expect(ex.name).toBe('Cable Fly');
  });

  it('rejects a blank name', async () => {
    await expect(
      createCustomExercise({
        name: '   ',
        primaryMuscles: ['chest'],
        secondaryMuscles: [],
        equipment: 'cable',
        measurementType: 'weight_reps',
      }),
    ).rejects.toThrow(/name/i);
  });

  it('rejects an exercise with no primary muscle', async () => {
    await expect(
      createCustomExercise({
        name: 'Mystery Move',
        primaryMuscles: [],
        secondaryMuscles: [],
        equipment: 'cable',
        measurementType: 'weight_reps',
      }),
    ).rejects.toThrow(/primary muscle/i);
  });
});

describe('listExercises', () => {
  it('sorts by name', async () => {
    await createCustomExercise({
      name: 'Zottman Curl', primaryMuscles: ['biceps'], secondaryMuscles: [],
      equipment: 'dumbbell', measurementType: 'weight_reps',
    });
    await createCustomExercise({
      name: 'Ab Wheel', primaryMuscles: ['abs'], secondaryMuscles: [],
      equipment: 'other', measurementType: 'bodyweight_reps',
    });
    await createCustomExercise({
      name: 'Machine Row', primaryMuscles: ['lats'], secondaryMuscles: [],
      equipment: 'machine', measurementType: 'weight_reps',
    });

    const names = (await listExercises()).map((e) => e.name);
    expect(names).toEqual(['Ab Wheel', 'Machine Row', 'Zottman Curl']);
  });

  it('excludes archived exercises by default', async () => {
    const a = await createCustomExercise({
      name: 'Zottman Curl', primaryMuscles: ['biceps'], secondaryMuscles: [],
      equipment: 'dumbbell', measurementType: 'weight_reps',
    });
    await createCustomExercise({
      name: 'Ab Wheel', primaryMuscles: ['abs'], secondaryMuscles: [],
      equipment: 'other', measurementType: 'bodyweight_reps',
    });
    await archiveExercise(a.id);

    const names = (await listExercises()).map((e) => e.name);
    expect(names).toEqual(['Ab Wheel']);
  });

  it('includes archived exercises when asked', async () => {
    const a = await createCustomExercise({
      name: 'Zottman Curl', primaryMuscles: ['biceps'], secondaryMuscles: [],
      equipment: 'dumbbell', measurementType: 'weight_reps',
    });
    await archiveExercise(a.id);

    const names = (await listExercises({ includeArchived: true })).map((e) => e.name);
    expect(names).toEqual(['Zottman Curl']);
  });
});

describe('archiving', () => {
  it('never removes the row, so logged history keeps a valid reference', async () => {
    const ex = await createCustomExercise({
      name: 'Pec Deck', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'machine', measurementType: 'weight_reps',
    });

    await archiveExercise(ex.id);

    expect(await db.exercises.count()).toBe(1);
    expect((await getExercise(ex.id))?.isArchived).toBe(true);
  });

  it('can be undone', async () => {
    const ex = await createCustomExercise({
      name: 'Pec Deck', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'machine', measurementType: 'weight_reps',
    });
    await archiveExercise(ex.id);
    await unarchiveExercise(ex.id);
    expect((await getExercise(ex.id))?.isArchived).toBe(false);
  });
});

describe('updateExercise', () => {
  it('applies changes without touching other fields', async () => {
    const ex = await createCustomExercise({
      name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'cable', measurementType: 'weight_reps',
    });

    await updateExercise(ex.id, { name: 'Low-to-High Cable Fly' });

    const updated = await getExercise(ex.id);
    expect(updated?.name).toBe('Low-to-High Cable Fly');
    expect(updated?.equipment).toBe('cable');
    expect(updated?.isCustom).toBe(true);
  });

  it('strips id from changes so it cannot hijack the row into a delete-and-add', async () => {
    const ex = await createCustomExercise({
      name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'cable', measurementType: 'weight_reps',
    });

    await updateExercise(ex.id, { name: 'Renamed', id: 'hijacked-id' });

    const stillThere = await getExercise(ex.id);
    expect(stillThere).toBeDefined();
    expect(stillThere?.name).toBe('Renamed');
    expect(stillThere?.id).toBe(ex.id);
    expect(await getExercise('hijacked-id')).toBeUndefined();
    expect(await db.exercises.count()).toBe(1);
  });

  it('strips isCustom from changes so it cannot corrupt the seed gate', async () => {
    const ex = await createCustomExercise({
      name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'cable', measurementType: 'weight_reps',
    });

    await updateExercise(ex.id, { isCustom: false });

    const updated = await getExercise(ex.id);
    expect(updated?.isCustom).toBe(true);
  });

  it('rejects a blank name, mirroring createCustomExercise', async () => {
    const ex = await createCustomExercise({
      name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'cable', measurementType: 'weight_reps',
    });

    await expect(updateExercise(ex.id, { name: '   ' })).rejects.toThrow(/name/i);

    const unchanged = await getExercise(ex.id);
    expect(unchanged?.name).toBe('Cable Fly');
  });

  it('rejects clearing primaryMuscles to empty, mirroring createCustomExercise', async () => {
    const ex = await createCustomExercise({
      name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'cable', measurementType: 'weight_reps',
    });

    await expect(updateExercise(ex.id, { primaryMuscles: [] })).rejects.toThrow(/primary muscle/i);

    const unchanged = await getExercise(ex.id);
    expect(unchanged?.primaryMuscles).toEqual(['chest']);
  });

  it('allows a partial update that omits name and primaryMuscles entirely', async () => {
    const ex = await createCustomExercise({
      name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
      equipment: 'cable', measurementType: 'weight_reps',
    });

    await updateExercise(ex.id, { equipment: 'machine' });

    const updated = await getExercise(ex.id);
    expect(updated?.equipment).toBe('machine');
    expect(updated?.name).toBe('Cable Fly');
    expect(updated?.primaryMuscles).toEqual(['chest']);
  });
});
