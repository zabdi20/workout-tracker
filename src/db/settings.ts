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
