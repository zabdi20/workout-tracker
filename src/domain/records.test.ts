import type { Exercise, LoggedSet, MeasurementType } from '../db/types';
import {
  detectAllPrs, detectPrs, estimatedOneRepMax, exerciseRecords, KG_PER_LB, toKg,
} from './records';

let seq = 0;
function set(over: Partial<LoggedSet> & { completedAt: number }): LoggedSet {
  seq += 1;
  return {
    id: `s${seq}`, sessionId: 'w1', exerciseId: 'bench', order: 0,
    setType: 'working', unit: 'lb', weight: 225, reps: 5, ...over,
  };
}

function exercise(id: string, measurementType: MeasurementType): Exercise {
  return {
    id, name: id, primaryMuscles: [], secondaryMuscles: [], equipment: 'barbell',
    measurementType, isCustom: true, isArchived: false,
  };
}

describe('toKg', () => {
  it('leaves kilograms alone', () => expect(toKg(100, 'kg')).toBe(100));
  it('uses the exact definition of the pound', () => {
    expect(KG_PER_LB).toBe(0.45359237);
    expect(toKg(225, 'lb')).toBeCloseTo(102.05828325, 8);
  });
});

describe('estimatedOneRepMax', () => {
  it('is the weight itself for a single', () => expect(estimatedOneRepMax(225, 1)).toBe(225));
  it('applies Epley above one rep', () => expect(estimatedOneRepMax(200, 5)).toBeCloseTo(233.333, 3));
  it('still estimates at exactly 12 reps', () => expect(estimatedOneRepMax(100, 12)).toBeCloseTo(140, 9));
  it('gives no estimate above 12 reps', () => expect(estimatedOneRepMax(100, 13)).toBeUndefined());
  it('gives no estimate for zero reps', () => expect(estimatedOneRepMax(100, 0)).toBeUndefined());
});

describe('detectPrs', () => {
  it('never badges the first set ever logged', () => {
    expect(detectPrs([set({ completedAt: 1 })]).size).toBe(0);
  });

  it('badges a heavier set as heaviest, but not est. 1RM when its estimate is lower', () => {
    const a = set({ weight: 225, reps: 5, completedAt: 1 }); // estimate 262.5
    const b = set({ weight: 235, reps: 3, completedAt: 2 }); // estimate 258.5
    expect(detectPrs([a, b]).get(b.id)).toEqual(['heaviest']);
  });

  it('does not badge a tie', () => {
    expect(detectPrs([set({ completedAt: 1 }), set({ completedAt: 2 })]).size).toBe(0);
  });

  it('badges more reps at the same weight as a rep best', () => {
    const b = set({ weight: 225, reps: 6, completedAt: 2 });
    expect(detectPrs([set({ weight: 225, reps: 5, completedAt: 1 }), b]).get(b.id)).toEqual(['e1rm', 'reps']);
  });

  it('does not badge a first time at a lower new weight', () => {
    const sets = [set({ weight: 225, reps: 5, completedAt: 1 }), set({ weight: 185, reps: 8, completedAt: 2 })];
    expect(detectPrs(sets).size).toBe(0);
  });

  it('ignores warm-ups, both as PRs and as the bar to beat', () => {
    const warmup = set({ setType: 'warmup', weight: 315, reps: 1, completedAt: 1 });
    const first = set({ weight: 225, reps: 5, completedAt: 2 });
    const second = set({ weight: 235, reps: 5, completedAt: 3 });
    const prs = detectPrs([warmup, first, second]);
    expect(prs.get(warmup.id)).toBeUndefined();
    expect(prs.get(first.id)).toBeUndefined();
    expect(prs.get(second.id)).toEqual(['heaviest', 'e1rm']);
  });

  it('gives sets above 12 reps no estimate, so they neither earn nor block est. 1RM', () => {
    const a = set({ weight: 100, reps: 5, completedAt: 1 }); // estimate 116.67
    const b = set({ weight: 100, reps: 15, completedAt: 2 }); // no estimate
    const c = set({ weight: 105, reps: 4, completedAt: 3 }); // estimate 119
    const prs = detectPrs([a, b, c]);
    expect(prs.get(b.id)).toEqual(['reps']);
    expect(prs.get(c.id)).toEqual(['heaviest', 'e1rm']);
  });

  it('compares weights across units in kilograms', () => {
    const b = set({ unit: 'lb', weight: 225, reps: 5, completedAt: 2 });
    expect(detectPrs([set({ unit: 'kg', weight: 100, reps: 5, completedAt: 1 }), b]).get(b.id))
      .toEqual(['heaviest', 'e1rm']);
  });

  it('never treats a kg and an lb number as the same weight for rep bests', () => {
    const sets = [set({ unit: 'kg', weight: 100, reps: 5, completedAt: 1 }), set({ unit: 'lb', weight: 100, reps: 8, completedAt: 2 })];
    expect(detectPrs(sets).size).toBe(0);
  });

  it('treats a float-noise difference across units as a tie, not a PR', () => {
    // 1e-12 kg lighter than 225 lb: greater without the 1e-9 tolerance, a tie with it.
    const sets = [
      set({ unit: 'kg', weight: 225 * KG_PER_LB - 1e-12, reps: 5, completedAt: 1 }),
      set({ unit: 'lb', weight: 225, reps: 5, completedAt: 2 }),
    ];
    expect(detectPrs(sets).size).toBe(0);
  });

  it('orders by completedAt, not by the order the sets arrive in', () => {
    const a = set({ weight: 225, reps: 5, completedAt: 1 });
    const b = set({ weight: 235, reps: 3, completedAt: 2 });
    expect(detectPrs([b, a]).get(b.id)).toEqual(['heaviest']);
  });

  it('orders sets stamped in the same millisecond by their order field', () => {
    const first = set({ weight: 225, reps: 5, completedAt: 1, order: 0 });
    const second = set({ weight: 235, reps: 5, completedAt: 1, order: 1 });
    expect(detectPrs([second, first]).get(second.id)).toEqual(['heaviest', 'e1rm']);
  });

  it('skips sets with no weight or no reps', () => {
    const sets = [
      set({ weight: undefined, reps: 10, completedAt: 1 }),
      set({ weight: 500, reps: 0, completedAt: 2 }),
      set({ weight: 225, reps: 5, completedAt: 3 }),
    ];
    expect(detectPrs(sets).size).toBe(0);
  });
});

describe('detectAllPrs', () => {
  it('detects only for exercises currently typed weight × reps', () => {
    const b = set({ exerciseId: 'bench', weight: 235, completedAt: 2 });
    const plankB = set({ exerciseId: 'plank', weight: 20, reps: 1, completedAt: 2 });
    const prs = detectAllPrs(
      [set({ exerciseId: 'bench', completedAt: 1 }), b, set({ exerciseId: 'plank', weight: 10, reps: 1, completedAt: 1 }), plankB],
      [exercise('bench', 'weight_reps'), exercise('plank', 'duration')],
    );
    expect([...prs.keys()]).toEqual([b.id]);
  });

  it('keeps exercises apart, and skips sets of an unknown exercise', () => {
    const sets = [
      set({ exerciseId: 'squat', weight: 315, completedAt: 1 }),
      set({ exerciseId: 'bench', weight: 225, completedAt: 2 }),
      set({ exerciseId: 'ghost', weight: 100, completedAt: 3 }),
      set({ exerciseId: 'ghost', weight: 200, completedAt: 4 }),
    ];
    expect(detectAllPrs(sets, [exercise('squat', 'weight_reps'), exercise('bench', 'weight_reps')]).size).toBe(0);
  });
});

describe('exerciseRecords', () => {
  it('is empty with no qualifying sets', () => {
    expect(exerciseRecords([set({ setType: 'warmup', completedAt: 1 })]))
      .toEqual({ heaviest: null, bestE1rm: null, repBests: [] });
  });

  it('reports the heaviest, the best estimate, and rep bests heaviest first', () => {
    const a = set({ weight: 225, reps: 5, completedAt: 1 });
    const b = set({ weight: 235, reps: 3, completedAt: 2 });
    const c = set({ weight: 225, reps: 6, completedAt: 3 }); // estimate 270
    const d = set({ weight: 185, reps: 10, completedAt: 4 });
    const records = exerciseRecords([a, b, c, d]);
    expect(records.heaviest?.id).toBe(b.id);
    expect(records.bestE1rm?.set.id).toBe(c.id);
    expect(records.bestE1rm?.value).toBeCloseTo(270, 9);
    expect(records.repBests.map((s) => s.id)).toEqual([b.id, c.id, d.id]);
  });

  it('keeps the earliest set when two tie', () => {
    const a = set({ completedAt: 1 });
    const records = exerciseRecords([a, set({ completedAt: 2 })]);
    expect(records.heaviest?.id).toBe(a.id);
    expect(records.bestE1rm?.set.id).toBe(a.id);
    expect(records.repBests.map((s) => s.id)).toEqual([a.id]);
  });

  it('uses the weight itself as a single\'s estimate', () => {
    expect(exerciseRecords([set({ weight: 300, reps: 1, completedAt: 1 })]).bestE1rm?.value).toBe(300);
  });

  it('keeps different units as separate rep-best rows', () => {
    const kg = set({ unit: 'kg', weight: 100, reps: 5, completedAt: 1 });
    const lb = set({ unit: 'lb', weight: 100, reps: 8, completedAt: 2 });
    expect(exerciseRecords([lb, kg]).repBests.map((s) => s.id)).toEqual([kg.id, lb.id]);
  });
});
