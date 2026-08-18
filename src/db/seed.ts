import { db, SETTINGS_ID } from './db';
import type { Exercise } from './types';
import bundled from '../data/exercises.json';

/**
 * The revision of the bundled exercise library currently shipped with the
 * app. Stamped onto the settings singleton so a device that seeded an
 * earlier revision can be brought up to date without a schema migration.
 *
 * Revision 2 widened the library to the plyometrics category and gave
 * medicine-ball movements their own equipment member: 587 entries to 650.
 */
export const LIBRARY_VERSION = 2;

/**
 * Brings the device's bundled library up to the revision shipped with this
 * build, and returns the number of exercises inserted.
 *
 * First run and upgrade are deliberately the same operation: "insert every
 * bundled exercise whose id is not already present" seeds the whole library
 * on an empty database and adds only the new entries on a device seeded
 * earlier. There is no separate upgrade path to keep correct.
 *
 * This is safe only because a library revision is additive. Bundled ids are
 * upstream slugs that never change, so a row that is present is a row this
 * function leaves entirely alone — which is what preserves exercises the
 * user archived or edited. Correcting the *contents* of an existing entry
 * is a different problem and deliberately not solved here.
 *
 * The version check and the insert share one transaction. React StrictMode
 * invokes effects twice in development, so without it two calls can both
 * observe an out-of-date library and the second bulkAdd fails on duplicate
 * keys.
 */
export async function prepareLibrary(): Promise<number> {
  return db.transaction('rw', db.exercises, db.settings, async () => {
    const settings = await db.settings.get(SETTINGS_ID);
    // Unset means a device seeded before the field existed, which is older
    // than every stamped revision — exactly what 0 sorts as.
    const seeded = settings?.libraryVersion ?? 0;
    if (seeded >= LIBRARY_VERSION) return 0;

    const present = new Set(await db.exercises.toCollection().primaryKeys());
    const missing = (bundled as Exercise[]).filter((e) => !present.has(e.id));
    if (missing.length > 0) await db.exercises.bulkAdd(missing);

    await db.settings.put({
      id: SETTINGS_ID,
      unitPreference: 'lb',
      defaultRestSeconds: 90,
      restAlertSound: true,
      ...settings,
      libraryVersion: LIBRARY_VERSION,
    });

    return missing.length;
  });
}
