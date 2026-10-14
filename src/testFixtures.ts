/**
 * TEST-ONLY. Nothing in app code may import this file.
 *
 * Seeds finished workouts with known timestamps. It writes straight to
 * db.sessions and db.sets rather than going through startSession, logSet and
 * finishSession, because those stamp the real clock and a History test needs
 * to say exactly when each set happened.
 */
import { db } from './db/db';
import { createCustomExercise } from './db/exercises';
import type {
  Exercise, LoggedSet, MeasurementType, Session, SessionStatus, SetType, WeightUnit,
} from './db/types';

/** A Monday afternoon in January 2025, comfortably in the past. */
export const T = Date.UTC(2025, 0, 6, 17, 0);
export const MIN = 60_000;
export const DAY = 86_400_000;

export function seedExercise(
  name = 'Barbell Bench Press',
  measurementType: MeasurementType = 'weight_reps',
): Promise<Exercise> {
  return createCustomExercise({
    name,
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType,
  });
}

export interface SeedSet {
  exerciseId: string;
  completedAt: number;
  weight?: number;
  reps?: number;
  unit?: WeightUnit;
  setType?: SetType;
  durationSeconds?: number;
  /** Overrides the default, which is the set's position among the same
   *  exercise's sets in the input. */
  order?: number;
}

/**
 * Writes one workout and its sets. Defaults: name 'Push A', status
 * 'completed', endedAt one hour after startedAt (`null` leaves it unset),
 * unit 'lb', setType 'working'.
 */
export async function seedWorkout(w: {
  name?: string;
  startedAt: number;
  endedAt?: number | null;
  status?: SessionStatus;
  sets?: SeedSet[];
}): Promise<Session> {
  const endedAt = w.endedAt === undefined ? w.startedAt + 3_600_000 : w.endedAt;
  const session: Session = {
    id: crypto.randomUUID(),
    routineId: null,
    name: w.name ?? 'Push A',
    startedAt: w.startedAt,
    ...(endedAt === null ? {} : { endedAt }),
    status: w.status ?? 'completed',
  };

  const seen = new Map<string, number>();
  const sets: LoggedSet[] = (w.sets ?? []).map((s) => {
    const position = seen.get(s.exerciseId) ?? 0;
    seen.set(s.exerciseId, position + 1);
    return {
      id: crypto.randomUUID(),
      sessionId: session.id,
      exerciseId: s.exerciseId,
      order: s.order ?? position,
      setType: s.setType ?? 'working',
      unit: s.unit ?? 'lb',
      completedAt: s.completedAt,
      // Absent rather than undefined, so a seeded set has the same shape as
      // one logSet would have written.
      ...(s.weight !== undefined ? { weight: s.weight } : {}),
      ...(s.reps !== undefined ? { reps: s.reps } : {}),
      ...(s.durationSeconds !== undefined ? { durationSeconds: s.durationSeconds } : {}),
    };
  });

  await db.transaction('rw', db.sessions, db.sets, async () => {
    await db.sessions.add(session);
    await db.sets.bulkAdd(sets);
  });
  return session;
}
