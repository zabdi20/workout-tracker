import {
  mapEquipment, mapMuscle, inferMeasurementType,
  shouldInclude, toExercise, buildLibrary,
  type SourceExercise,
} from './mapping';

function source(over: Partial<SourceExercise> = {}): SourceExercise {
  return {
    id: 'Barbell_Bench_Press',
    name: 'Barbell Bench Press',
    equipment: 'barbell',
    category: 'strength',
    mechanic: 'compound',
    force: 'push',
    level: 'beginner',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    instructions: ['Lie on the bench.', 'Press the bar.'],
    ...over,
  };
}

describe('mapEquipment', () => {
  it('maps known equipment to our vocabulary', () => {
    expect(mapEquipment('barbell')).toBe('barbell');
    expect(mapEquipment('body only')).toBe('bodyweight');
    expect(mapEquipment('kettlebells')).toBe('kettlebell');
    expect(mapEquipment('e-z curl bar')).toBe('ez_bar');
    expect(mapEquipment('bands')).toBe('band');
  });

  it('maps unknown or missing equipment to other', () => {
    expect(mapEquipment('foam roll')).toBe('other');
    expect(mapEquipment(null)).toBe('other');
    expect(mapEquipment('something new')).toBe('other');
  });

  it('maps medicine ball to its own equipment member', () => {
    expect(mapEquipment('medicine ball')).toBe('medicine_ball');
  });
});

describe('mapMuscle', () => {
  it('renames muscles to our vocabulary', () => {
    expect(mapMuscle('quadriceps')).toBe('quads');
    expect(mapMuscle('abdominals')).toBe('abs');
    expect(mapMuscle('middle back')).toBe('upper_back');
    expect(mapMuscle('lower back')).toBe('lower_back');
  });

  it('maps the coarse shoulders bucket to delts rather than guessing a head', () => {
    expect(mapMuscle('shoulders')).toBe('delts');
  });

  it('returns null for unrecognised muscles', () => {
    expect(mapMuscle('gizzard')).toBeNull();
  });
});

describe('inferMeasurementType', () => {
  it('treats bodyweight movements as bodyweight_reps', () => {
    expect(inferMeasurementType(source({ equipment: 'body only' }))).toBe('bodyweight_reps');
  });

  it('treats cardio as distance_duration', () => {
    expect(inferMeasurementType(source({ category: 'cardio' }))).toBe('distance_duration');
  });

  it('treats stretching as duration', () => {
    expect(inferMeasurementType(source({ category: 'stretching' }))).toBe('duration');
  });

  it('defaults to weight_reps', () => {
    expect(inferMeasurementType(source())).toBe('weight_reps');
  });

  it('applies name-based overrides ahead of the general rules', () => {
    expect(inferMeasurementType(source({ name: 'Plank', equipment: 'body only' }))).toBe('duration');
    expect(inferMeasurementType(source({ name: 'Assisted Pull-Up', equipment: 'machine' })))
      .toBe('assisted_reps');
  });

  it('treats hang clean/snatch variants as weight_reps, not duration', () => {
    expect(inferMeasurementType(source({ name: 'Hang Clean', equipment: 'barbell' })))
      .toBe('weight_reps');
  });

  it('treats dead hang as duration', () => {
    expect(inferMeasurementType(source({ name: 'Dead Hang', equipment: 'body only' })))
      .toBe('duration');
  });

  it('treats plank as duration but not a push-up variant that merely ends in "plank"', () => {
    expect(inferMeasurementType(source({ name: 'Plank', equipment: 'body only' })))
      .toBe('duration');
    expect(inferMeasurementType(source({ name: 'Push Up to Side Plank', equipment: 'body only' })))
      .toBe('bodyweight_reps');
  });

  it('treats iron cross variants as rep-counted, not duration', () => {
    expect(inferMeasurementType(source({ name: 'Cable Iron Cross', equipment: 'cable' })))
      .toBe('weight_reps');
    expect(inferMeasurementType(source({ name: 'Iron Cross', equipment: 'dumbbell' })))
      .toBe('weight_reps');
  });

  it('counts reps for plyometrics whose equipment is unmappable', () => {
    // Box jumps, cone hops and shuffles carry no load. Without a category
    // rule these fall through to weight_reps and ask for a weight that
    // does not exist.
    expect(inferMeasurementType(source({ category: 'plyometrics', equipment: 'other' })))
      .toBe('bodyweight_reps');
    expect(inferMeasurementType(source({ category: 'plyometrics', equipment: null })))
      .toBe('bodyweight_reps');
  });

  it('counts reps for bodyweight plyometrics', () => {
    expect(inferMeasurementType(source({ category: 'plyometrics', equipment: 'body only' })))
      .toBe('bodyweight_reps');
  });

  it('records a load for plyometrics that carry one', () => {
    expect(inferMeasurementType(source({ category: 'plyometrics', equipment: 'dumbbell' })))
      .toBe('weight_reps');
    expect(inferMeasurementType(source({ category: 'plyometrics', equipment: 'medicine ball' })))
      .toBe('weight_reps');
  });

  it('lets a name override beat the plyometrics rule', () => {
    expect(inferMeasurementType(source({ name: 'Plank', category: 'plyometrics', equipment: 'other' })))
      .toBe('duration');
  });
});

describe('shouldInclude', () => {
  it('keeps strength movements with mapped equipment', () => {
    expect(shouldInclude(source())).toBe(true);
  });

  it('drops non-strength categories', () => {
    expect(shouldInclude(source({ category: 'stretching' }))).toBe(false);
    expect(shouldInclude(source({ category: 'cardio' }))).toBe(false);
  });

  it('drops exercises whose equipment we cannot map', () => {
    expect(shouldInclude(source({ equipment: 'foam roll' }))).toBe(false);
  });

  it('drops exercises with no usable primary muscle', () => {
    expect(shouldInclude(source({ primaryMuscles: [] }))).toBe(false);
    expect(shouldInclude(source({ primaryMuscles: ['gizzard'] }))).toBe(false);
  });

  it('keeps plyometrics', () => {
    expect(shouldInclude(source({ category: 'plyometrics', equipment: 'body only' }))).toBe(true);
  });

  it('keeps plyometrics whose equipment does not map, unlike every other category', () => {
    // In plyometrics "other" means a box, a cone, or nothing at all, so the
    // entry is still usable. Elsewhere it means gear this app does not model.
    expect(shouldInclude(source({ category: 'plyometrics', equipment: 'other' }))).toBe(true);
    expect(shouldInclude(source({ category: 'plyometrics', equipment: null }))).toBe(true);
    expect(shouldInclude(source({ category: 'strength', equipment: 'other' }))).toBe(false);
    expect(shouldInclude(source({ category: 'strength', equipment: null }))).toBe(false);
  });

  it('keeps medicine ball movements now that the equipment maps', () => {
    expect(shouldInclude(source({ category: 'strength', equipment: 'medicine ball' }))).toBe(true);
  });

  it('still drops plyometrics with no usable primary muscle', () => {
    expect(shouldInclude(source({ category: 'plyometrics', equipment: 'other', primaryMuscles: [] })))
      .toBe(false);
  });
});

describe('toExercise', () => {
  it('produces a valid library entry', () => {
    const ex = toExercise(source());
    expect(ex).toMatchObject({
      id: 'Barbell_Bench_Press',
      name: 'Barbell Bench Press',
      primaryMuscles: ['chest'],
      secondaryMuscles: ['delts', 'triceps'],
      equipment: 'barbell',
      measurementType: 'weight_reps',
      isCustom: false,
      isArchived: false,
    });
  });

  it('joins instructions into a single string', () => {
    expect(toExercise(source()).instructions).toBe('Lie on the bench. Press the bar.');
  });

  it('omits instructions when the source has none', () => {
    expect(toExercise(source({ instructions: [] })).instructions).toBeUndefined();
  });

  it('drops unrecognised muscles rather than emitting nulls', () => {
    const ex = toExercise(source({ secondaryMuscles: ['gizzard', 'triceps'] }));
    expect(ex.secondaryMuscles).toEqual(['triceps']);
  });
});

describe('buildLibrary', () => {
  it('filters, sorts by name, and de-duplicates', () => {
    const library = buildLibrary([
      source({ id: 'z', name: 'Zercher Squat', primaryMuscles: ['quadriceps'] }),
      source({ id: 'a', name: 'Arnold Press', primaryMuscles: ['shoulders'] }),
      source({ id: 'dupe', name: 'Arnold Press', primaryMuscles: ['shoulders'] }),
      source({ id: 'drop', name: 'Foam Roll', equipment: 'foam roll' }),
    ]);

    expect(library.map((e) => e.name)).toEqual(['Arnold Press', 'Zercher Squat']);
  });
});
