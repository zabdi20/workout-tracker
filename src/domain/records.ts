import type { Exercise, LoggedSet, WeightUnit } from '../db/types';

/**
 * Personal-record rules, as pure functions of an exercise's logged sets.
 *
 * Nothing here is stored: a stored PR table would need invalidating on every
 * edit of a past workout, and editing history is a routine operation. The one
 * thing these rules exist to prevent is a fake PR — one minted by unit
 * conversion drift, a tie, or the first set ever logged.
 */

export type PrKind = 'heaviest' | 'e1rm' | 'reps';

/** The exact definition of the pound. */
export const KG_PER_LB = 0.45359237;

/** Sets above this many reps have no estimated 1RM; Epley is unreliable there. */
const MAX_ESTIMATE_REPS = 12;

/**
 * A kilogram comparison counts as "greater" only past this margin, so
 * floating-point noise from converting between units cannot mint a record.
 */
const TOLERANCE_KG = 1e-9;

/**
 * Weight is stored in the unit it was entered in and never converted on write.
 * This conversion is for comparison only.
 */
export function toKg(weight: number, unit: WeightUnit): number {
  return unit === 'kg' ? weight : weight * KG_PER_LB;
}

/**
 * Epley, `weight × (1 + reps / 30)`, in the same unit as `weight`. Undefined
 * above 12 reps or below 1.
 *
 * A single is its own weight: raw Epley gives `weight × 1.033` at one rep,
 * which would rank a true single below a heavier estimate from a triple that
 * was never lifted.
 */
export function estimatedOneRepMax(weight: number, reps: number): number | undefined {
  if (!(reps >= 1) || reps > MAX_ESTIMATE_REPS) return undefined;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/** A working set with a weight and at least one rep. */
type QualifyingSet = LoggedSet & { weight: number; reps: number };

function isQualifying(s: LoggedSet): s is QualifyingSet {
  // isFinite as well as presence: one NaN or Infinity would become the bar
  // nothing can beat and silently switch records off for the whole exercise.
  return (
    s.setType === 'working' &&
    s.weight !== undefined && Number.isFinite(s.weight) &&
    s.reps !== undefined && Number.isFinite(s.reps) && s.reps >= 1
  );
}

/** Qualifying sets only, oldest first: `completedAt`, then `order`, then `id`. */
function chronological(sets: LoggedSet[]): QualifyingSet[] {
  return sets.filter(isQualifying).sort((a, b) => {
    if (a.completedAt !== b.completedAt) return a.completedAt - b.completedAt;
    if (a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** True only when `value` beats `best` by more than the tolerance. */
function exceeds(value: number, best: number): boolean {
  return value > best + TOLERANCE_KG;
}

/** Same exact weight in the same unit. 100 kg and 220.5 lb are not equal here. */
function repKey(s: QualifyingSet): string {
  return `${s.weight}|${s.unit}`;
}

/**
 * The running records over a chronological walk. `detectPrs` and
 * `exerciseRecords` both read this one state, so a set shown as the current
 * record is always the last set that was badged for it.
 */
class RunningBests {
  heaviest: { set: QualifyingSet; kg: number } | null = null;
  bestE1rm: { set: QualifyingSet; kg: number; value: number } | null = null;
  readonly repBests = new Map<string, QualifyingSet>();

  /** Takes the next set in order and returns the kinds it earned. */
  take(s: QualifyingSet): PrKind[] {
    const earned: PrKind[] = [];

    // A kind is earned only when a previous value exists and this one beats
    // it. The first value sets the bar rather than beating it.
    const kg = toKg(s.weight, s.unit);
    if (this.heaviest === null) {
      this.heaviest = { set: s, kg };
    } else if (exceeds(kg, this.heaviest.kg)) {
      this.heaviest = { set: s, kg };
      earned.push('heaviest');
    }

    // Compared in kilograms; the estimate itself stays in the set's own unit.
    const estimate = estimatedOneRepMax(s.weight, s.reps);
    if (estimate !== undefined) {
      const estimateKg = toKg(estimate, s.unit);
      if (this.bestE1rm === null) {
        this.bestE1rm = { set: s, kg: estimateKg, value: estimate };
      } else if (exceeds(estimateKg, this.bestE1rm.kg)) {
        this.bestE1rm = { set: s, kg: estimateKg, value: estimate };
        earned.push('e1rm');
      }
    }

    // Strict: a tie is matching a best, not beating it.
    const key = repKey(s);
    const best = this.repBests.get(key);
    if (best === undefined) {
      this.repBests.set(key, s);
    } else if (s.reps > best.reps) {
      this.repBests.set(key, s);
      earned.push('reps');
    }

    return earned;
  }
}

/**
 * The sets of one exercise, in any order and of any set type. Returns, by set
 * id, the kinds each set earned — only sets that earned at least one, with
 * kinds always in the order heaviest, e1rm, reps.
 *
 * A set is a PR of a kind when it strictly beats every earlier qualifying set
 * on that kind. Rep bests only compare against the exact same weight and unit.
 */
export function detectPrs(sets: LoggedSet[]): Map<string, PrKind[]> {
  const result = new Map<string, PrKind[]>();
  const running = new RunningBests();
  for (const s of chronological(sets)) {
    const earned = running.take(s);
    if (earned.length > 0) result.set(s.id, earned);
  }
  return result;
}

/**
 * `detectPrs` across a mix of exercises. Only exercises whose current
 * measurement type is weight × reps are considered; sets of an exercise not in
 * `exercises` are skipped.
 */
export function detectAllPrs(sets: LoggedSet[], exercises: Exercise[]): Map<string, PrKind[]> {
  const eligible = new Set(
    exercises.filter((e) => e.measurementType === 'weight_reps').map((e) => e.id),
  );
  const byExercise = new Map<string, LoggedSet[]>();
  for (const s of sets) {
    if (!eligible.has(s.exerciseId)) continue;
    const group = byExercise.get(s.exerciseId);
    if (group) group.push(s);
    else byExercise.set(s.exerciseId, [s]);
  }

  const result = new Map<string, PrKind[]>();
  for (const group of byExercise.values()) {
    for (const [id, kinds] of detectPrs(group)) result.set(id, kinds);
  }
  return result;
}

export interface ExerciseRecords {
  heaviest: LoggedSet | null;
  /** `value` is in the unit of `set`. */
  bestE1rm: { set: LoggedSet; value: number } | null;
  /** The best set at each exact weight and unit, heaviest first. */
  repBests: LoggedSet[];
}

/**
 * The current records for the sets of one exercise. Only strict improvements
 * replace a record, so when two sets tie the earliest one holds it.
 */
export function exerciseRecords(sets: LoggedSet[]): ExerciseRecords {
  const running = new RunningBests();
  for (const s of chronological(sets)) running.take(s);

  const repBests = [...running.repBests.values()].sort((a, b) => {
    const byWeight = toKg(b.weight, b.unit) - toKg(a.weight, a.unit);
    if (byWeight !== 0) return byWeight;
    return a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0;
  });

  return {
    heaviest: running.heaviest?.set ?? null,
    bestE1rm: running.bestE1rm
      ? { set: running.bestE1rm.set, value: running.bestE1rm.value }
      : null,
    repBests,
  };
}
