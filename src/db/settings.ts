import { db, SETTINGS_ID } from './db';
import type { Settings } from './types';

/** Mirrors the values prepareLibrary writes when it creates the row. */
export const DEFAULT_SETTINGS: Settings = {
  id: SETTINGS_ID,
  unitPreference: 'lb',
  defaultRestSeconds: 90,
  restAlertSound: true,
};

/**
 * The settings singleton, with defaults filled in.
 *
 * prepareLibrary writes the row before the app renders, so in practice one
 * exists. Merging over defaults anyway means a row written by an older
 * build, missing a field added since, cannot render `undefined` into an
 * input. Read-only, so it is safe inside a useLiveQuery querier.
 */
export async function getSettings(): Promise<Settings> {
  const stored = await db.settings.get(SETTINGS_ID);
  return { ...DEFAULT_SETTINGS, ...stored };
}

/**
 * Changes the given settings and leaves the rest as they are.
 *
 * The read and the write share one transaction, so two updates cannot both
 * read the same row and have the second discard the first's change. The
 * defaults are merged in as getSettings does, so a row written by an older
 * build is completed rather than saved with a field missing. `id` goes last:
 * the type leaves it out, but nothing stops a caller passing one at runtime,
 * and the singleton must never move.
 *
 * NEVER call this from inside a useLiveQuery querier: it opens a readwrite
 * transaction and Dexie throws ReadOnlyError.
 */
export async function updateSettings(
  changes: Partial<Omit<Settings, 'id'>>,
): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const stored = await db.settings.get(SETTINGS_ID);
    await db.settings.put({ ...DEFAULT_SETTINGS, ...stored, ...changes, id: SETTINGS_ID });
  });
}
