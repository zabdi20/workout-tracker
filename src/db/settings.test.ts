import { db, SETTINGS_ID, resetDbForTests } from './db';
import { SETTINGS_ROW_ID } from '../domain/backupValidate';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from './settings';

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

it('updateSettings changes only the fields given', async () => {
  // Rejects: a put of `changes` alone, which would drop every other field.
  await updateSettings({ unitPreference: 'kg' });
  await updateSettings({ defaultRestSeconds: 120 });
  const settings = await getSettings();
  expect(settings.unitPreference).toBe('kg');
  expect(settings.defaultRestSeconds).toBe(120);
  expect(settings.restAlertSound).toBe(true);
});

it('updateSettings never moves the singleton', async () => {
  // Rejects: spreading `changes` last, so an id smuggled in at runtime wins.
  await updateSettings({ id: 'other', unitPreference: 'kg' } as never);
  expect(await db.settings.count()).toBe(1);
  expect((await db.settings.toArray())[0].id).toBe(SETTINGS_ID);
  expect((await getSettings()).unitPreference).toBe('kg');
});

it("the domain's settings id matches the database's", () => {
  expect(SETTINGS_ROW_ID).toBe(SETTINGS_ID);
});
