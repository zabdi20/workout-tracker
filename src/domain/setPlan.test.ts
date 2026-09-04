import type { LoggedSet, SetType, WeightUnit } from '../db/types';
import { planSets } from './setPlan';

let nextId = 0;

function set(
  weight: number,
  reps: number,
  setType: SetType = 'working',
  unit: WeightUnit = 'lb',
): LoggedSet {
  nextId += 1;
  return {
    id: `set-${nextId}`,
    sessionId: 's',
    exerciseId: 'bench',
    order: nextId,
    setType,
    unit,
    weight,
    reps,
    completedAt: nextId,
  };
}

const base = { lastPerformance: [], logged: [], defaultUnit: 'lb' as const };

it('offers one empty row when there is no target and no history', () => {
  expect(planSets(base)).toEqual([{ position: 1, unit: 'lb' }]);
});

it('offers a row per target set when there is no history', () => {
  const rows = planSets({ ...base, targetSets: 4 });
  expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
  expect(rows.every((r) => r.weight === undefined)).toBe(true);
});

it("matches last time's set count when there is no target", () => {
  const rows = planSets({ ...base, lastPerformance: [set(135, 8), set(135, 8), set(145, 6)] });
  expect(rows.map((r) => r.weight)).toEqual([135, 135, 145]);
});

it("prefills row N from last time's working set N", () => {
  const rows = planSets({
    ...base,
    targetSets: 3,
    lastPerformance: [set(135, 8), set(135, 8), set(145, 6)],
  });
  expect(rows.map((r) => [r.weight, r.reps])).toEqual([[135, 8], [135, 8], [145, 6]]);
});

it("falls back to last time's final set when it had fewer", () => {
  const rows = planSets({
    ...base,
    targetSets: 4,
    lastPerformance: [set(135, 8), set(135, 8), set(145, 6)],
  });
  expect(rows.map((r) => r.weight)).toEqual([135, 135, 145, 145]);
});

it('drops rows for working sets already logged', () => {
  const rows = planSets({
    ...base,
    targetSets: 4,
    lastPerformance: [set(135, 8), set(135, 8), set(145, 6), set(145, 6)],
    logged: [set(135, 8), set(135, 8)],
  });
  expect(rows.map((r) => r.position)).toEqual([3, 4]);
  expect(rows.map((r) => r.weight)).toEqual([145, 145]);
});

it("does not let a logged warm-up consume a planned row", () => {
  const rows = planSets({
    ...base,
    targetSets: 3,
    logged: [set(45, 10, 'warmup')],
  });
  expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
});

it("skips last time's warm-ups when matching positions", () => {
  const rows = planSets({
    ...base,
    targetSets: 2,
    lastPerformance: [set(45, 10, 'warmup'), set(135, 8), set(145, 6)],
  });
  expect(rows.map((r) => r.weight)).toEqual([135, 145]);
});

it('returns no rows once the target is met', () => {
  const rows = planSets({
    ...base,
    targetSets: 2,
    logged: [set(135, 8), set(135, 8)],
  });
  expect(rows).toEqual([]);
});

it('clamps rather than going negative when more sets are logged than prescribed', () => {
  const rows = planSets({
    ...base,
    targetSets: 2,
    logged: [set(135, 8), set(135, 8), set(135, 8)],
  });
  expect(rows).toEqual([]);
});

it('adds a row when the user adds a set', () => {
  const rows = planSets({ ...base, targetSets: 3, adjust: 1 });
  expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
});

it('removes a row when the user removes a planned set', () => {
  const rows = planSets({ ...base, targetSets: 3, adjust: -1 });
  expect(rows.map((r) => r.position)).toEqual([1, 2]);
});

it('never hides a logged set by removing rows', () => {
  const rows = planSets({
    ...base,
    targetSets: 3,
    adjust: -5,
    logged: [set(135, 8), set(135, 8)],
  });
  expect(rows).toEqual([]);
});

it("carries last time's unit rather than the default", () => {
  const rows = planSets({
    ...base,
    lastPerformance: [set(60, 8, 'working', 'kg')],
  });
  expect(rows[0].unit).toBe('kg');
});

it('uses the default unit when there is nothing to carry', () => {
  expect(planSets({ ...base, defaultUnit: 'kg' })[0].unit).toBe('kg');
});

it('carries duration and distance, not just weight', () => {
  const sprint: LoggedSet = {
    id: 'a', sessionId: 's', exerciseId: 'run', order: 0, setType: 'working',
    unit: 'lb', distanceMeters: 400, durationSeconds: 90, completedAt: 1,
  };
  const rows = planSets({ ...base, lastPerformance: [sprint] });
  expect(rows[0].distanceMeters).toBe(400);
  expect(rows[0].durationSeconds).toBe(90);
});
