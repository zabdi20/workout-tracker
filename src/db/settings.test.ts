import { db, SETTINGS_ID, resetDbForTests } from './db';
import { DEFAULT_SETTINGS, getSettings } from './settings';

beforeEach(async () => {
  await resetDbForTests();
});

it('returns defaults when the singleton has not been written yet', async () => {
  const settings = await getSettings();
  expect(settings.unitPreference).toBe('lb');
  expect(settings.defaultRestSeconds).toBe(90);
  expect(settings.restAlertSound).toBe(true);
});

it('returns the stored row once it exists', async () => {
  await db.settings.put({ ...DEFAULT_SETTINGS, unitPreference: 'kg' });
  expect((await getSettings()).unitPreference).toBe('kg');
});

it('fills in fields missing from a row written by an older build', async () => {
  await db.settings.put({ id: SETTINGS_ID, unitPreference: 'kg' } as never);
  const settings = await getSettings();
  expect(settings.unitPreference).toBe('kg');
  expect(settings.defaultRestSeconds).toBe(90);
});
