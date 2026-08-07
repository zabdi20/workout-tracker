import Dexie, { type EntityTable } from 'dexie';
import type {
  BodyweightEntry, Cycle, Exercise, Goal,
  LoggedSet, Routine, Session, Settings,
} from './types';

export const SETTINGS_ID = 'singleton';

export class WorkoutDb extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>;
  routines!: EntityTable<Routine, 'id'>;
  cycles!: EntityTable<Cycle, 'id'>;
  sessions!: EntityTable<Session, 'id'>;
  sets!: EntityTable<LoggedSet, 'id'>;
  bodyweight!: EntityTable<BodyweightEntry, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor() {
    super('workout-tracker');
    this.version(1).stores({
      exercises: 'id, name, equipment, measurementType, isCustom, isArchived',
      routines: 'id, name, isArchived, updatedAt',
      cycles: 'id, isActive',
      sessions: 'id, startedAt, status, routineId',
      // The compound index serves the hottest query in the app:
      // "what did I do last time on this exercise?"
      sets: 'id, sessionId, exerciseId, completedAt, [exerciseId+completedAt]',
      bodyweight: 'id, date',
      goals: 'id, type, exerciseId, achievedAt',
      settings: 'id',
    });
  }
}

export const db = new WorkoutDb();

/** Test-only. Clears every table so each test starts from a known state. */
export async function resetDbForTests(): Promise<void> {
  await db.open();
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
}
