import { db, SETTINGS_ID } from './db';
import type { Exercise } from './types';
import bundled from '../data/exercises.json';

/**
 * The revision of the bundled exercise library currently shipped with the
 * app. Stamped onto the settings singleton when seeding actually happens, so
 * a future upgrade path can tell which devices need corrected bundled data
 * reconciled without needing a schema migration to add the field then.
 */
export const LIBRARY_VERSION = 1;

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
 *
 * When seeding actually happens, the settings singleton is stamped with the
 * seeded library version in the same transaction. A no-op seed leaves
 * settings untouched.
 */
export async function seedExercisesIfEmpty(): Promise<number> {
  return db.transaction('rw', db.exercises, db.settings, async () => {
    const existingBundled = await db.exercises
      .filter((e) => !e.isCustom)
      .count();
    if (existingBundled > 0) return 0;

    const exercises = bundled as Exercise[];
    await db.exercises.bulkAdd(exercises);

    const existingSettings = await db.settings.get(SETTINGS_ID);
    await db.settings.put({
      id: SETTINGS_ID,
      unitPreference: 'lb',
      defaultRestSeconds: 90,
      restAlertSound: true,
      ...existingSettings,
      libraryVersion: LIBRARY_VERSION,
    });

    return exercises.length;
  });
}
