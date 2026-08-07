import { db } from './db';
import type { Exercise } from './types';
import bundled from '../data/exercises.json';

/**
 * Populates the bundled exercise library on first run.
 *
 * Seeds only when no bundled exercises are present, so it never disturbs the
 * user's custom exercises and never resurrects ones they archived.
 * Returns the number of exercises inserted.
 *
 * The check and the insert run in one transaction. React StrictMode invokes
 * effects twice in development, so without it two calls can both observe an
 * empty table and the second bulkAdd fails on duplicate keys.
 */
export async function seedExercisesIfEmpty(): Promise<number> {
  return db.transaction('rw', db.exercises, async () => {
    const existingBundled = await db.exercises
      .filter((e) => !e.isCustom)
      .count();
    if (existingBundled > 0) return 0;

    const exercises = bundled as Exercise[];
    await db.exercises.bulkAdd(exercises);
    return exercises.length;
  });
}
