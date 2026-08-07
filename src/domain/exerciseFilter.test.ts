import {
  filterExercises, isFilterActive, EMPTY_FILTER, availableMuscles, availableEquipment,
} from './exerciseFilter';
import type { Exercise } from '../db/types';

function ex(over: Partial<Exercise> = {}): Exercise {
  return {
    id: crypto.randomUUID(),
    name: 'Barbell Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps'],
    equipment: 'barbell',
    measurementType: 'weight_reps',
    isCustom: false,
    isArchived: false,
    ...over,
  };
}

describe('filterExercises with no filter', () => {
  it('returns everything, sorted by name', () => {
    const result = filterExercises(
      [ex({ name: 'Squat' }), ex({ name: 'Bench' })],
      EMPTY_FILTER,
    );
    expect(result.map((e) => e.name)).toEqual(['Bench', 'Squat']);
  });
});

describe('filterExercises by query', () => {
  const all = [
    ex({ name: 'Barbell Bench Press' }),
    ex({ name: 'Dumbbell Bench Press' }),
    ex({ name: 'Barbell Squat' }),
  ];

  it('matches case-insensitively', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, query: 'BENCH' });
    expect(result).toHaveLength(2);
  });

  it('requires every token to match, in any order', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, query: 'press barbell' });
    expect(result.map((e) => e.name)).toEqual(['Barbell Bench Press']);
  });

  it('ignores extra whitespace', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, query: '  squat  ' });
    expect(result.map((e) => e.name)).toEqual(['Barbell Squat']);
  });

  it('returns nothing when no name matches', () => {
    expect(filterExercises(all, { ...EMPTY_FILTER, query: 'zercher' })).toEqual([]);
  });
});

describe('filterExercises by muscle', () => {
  const all = [
    ex({ name: 'Bench', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }),
    ex({ name: 'Curl', primaryMuscles: ['biceps'], secondaryMuscles: [] }),
    ex({ name: 'Row', primaryMuscles: ['lats'], secondaryMuscles: ['biceps'] }),
  ];

  it('matches primary muscles', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, muscles: ['chest'] });
    expect(result.map((e) => e.name)).toEqual(['Bench']);
  });

  it('matches secondary muscles too', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, muscles: ['biceps'] });
    expect(result.map((e) => e.name)).toEqual(['Curl', 'Row']);
  });

  it('treats multiple muscles as OR', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, muscles: ['chest', 'lats'] });
    expect(result.map((e) => e.name)).toEqual(['Bench', 'Row']);
  });
});

describe('filterExercises by equipment', () => {
  const all = [
    ex({ name: 'Bench', equipment: 'barbell' }),
    ex({ name: 'Fly', equipment: 'cable' }),
    ex({ name: 'Curl', equipment: 'dumbbell' }),
  ];

  it('treats multiple equipment types as OR', () => {
    const result = filterExercises(all, { ...EMPTY_FILTER, equipment: ['cable', 'dumbbell'] });
    expect(result.map((e) => e.name)).toEqual(['Curl', 'Fly']);
  });
});

describe('filterExercises combining criteria', () => {
  it('requires all active criteria to match', () => {
    const all = [
      ex({ name: 'Barbell Bench Press', equipment: 'barbell', primaryMuscles: ['chest'] }),
      ex({ name: 'Cable Fly', equipment: 'cable', primaryMuscles: ['chest'] }),
      ex({ name: 'Cable Row', equipment: 'cable', primaryMuscles: ['lats'] }),
    ];

    const result = filterExercises(all, {
      query: 'cable', muscles: ['chest'], equipment: ['cable'],
    });

    expect(result.map((e) => e.name)).toEqual(['Cable Fly']);
  });
});

describe('availableMuscles', () => {
  it('returns only muscles actually present, in canonical MUSCLE_GROUPS order', () => {
    const all = [
      ex({ primaryMuscles: ['quads'], secondaryMuscles: ['glutes'] }),
      ex({ primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }),
    ];
    // Canonical order (see labels.ts) is chest, delts, ..., quads, ...,
    // glutes, ..., triceps -- not discovery order.
    expect(availableMuscles(all)).toEqual(['chest', 'triceps', 'quads', 'glutes']);
  });

  it('excludes muscles from the vocabulary that no loaded exercise uses', () => {
    const all = [ex({ primaryMuscles: ['chest'], secondaryMuscles: [] })];
    const present = availableMuscles(all);
    expect(present).toContain('chest');
    expect(present).not.toContain('front_delts');
    expect(present).not.toContain('obliques');
  });

  it('returns an empty list for no exercises', () => {
    expect(availableMuscles([])).toEqual([]);
  });
});

describe('availableEquipment', () => {
  it('returns only equipment actually present, in canonical EQUIPMENT_TYPES order', () => {
    const all = [
      ex({ equipment: 'dumbbell' }),
      ex({ equipment: 'barbell' }),
    ];
    expect(availableEquipment(all)).toEqual(['barbell', 'dumbbell']);
  });

  it('excludes equipment from the vocabulary that no loaded exercise uses', () => {
    const all = [ex({ equipment: 'machine' })];
    const present = availableEquipment(all);
    expect(present).toContain('machine');
    expect(present).not.toContain('smith');
    expect(present).not.toContain('other');
  });
});

describe('isFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it('is false for a whitespace-only query', () => {
    expect(isFilterActive({ ...EMPTY_FILTER, query: '   ' })).toBe(false);
  });

  it('is true when any criterion is set', () => {
    expect(isFilterActive({ ...EMPTY_FILTER, query: 'bench' })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, muscles: ['chest'] })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, equipment: ['cable'] })).toBe(true);
  });
});
