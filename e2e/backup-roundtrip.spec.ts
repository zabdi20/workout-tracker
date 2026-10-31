import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Cycle, Exercise, LoggedSet, Settings } from '../src/db/types';

/**
 * The backup round trip, in WebKit, against the production build.
 *
 * A workout history is built in one browser context through the UI, backed up
 * through the same share path the phone uses, and restored into a second,
 * empty context. Both IndexedDB databases are then read raw and compared row
 * for row. Neither side goes through the app's exporter: an exporter that
 * dropped a timestamp or rounded a weight would agree with itself.
 */

const APP = '/workout-tracker/';

// A fresh context seeds the 650-exercise library before Today shows. That
// took about ten seconds in WebKit on Windows, well past the five an
// assertion gets by default.
const FIRST_LOAD = { timeout: 60_000 };

/** Every object store, read through the raw IndexedDB API. */
async function dumpDatabase(page: Page): Promise<Record<string, unknown[]>> {
  return page.evaluate(() => new Promise<Record<string, unknown[]>>((resolve, reject) => {
    const open = indexedDB.open('workout-tracker');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const idb = open.result;
      const names = Array.from(idb.objectStoreNames);
      const tx = idb.transaction(names, 'readonly');
      const out: Record<string, unknown[]> = {};
      for (const n of names) {
        const req = tx.objectStore(n).getAll();
        req.onsuccess = () => { out[n] = req.result; };
      }
      tx.oncomplete = () => { idb.close(); resolve(out); };
      tx.onerror = () => reject(tx.error);
    };
  }));
}

const tab = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name });

const todayHeading = (page: Page) => page.getByRole('heading', { name: 'Today', level: 2 });

async function openSettings(page: Page) {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible();
}

/**
 * Chooses an exercise in whichever exercise browser is open. Scoped to the
 * browser's own list, because a routine's items and a session's tabs repeat
 * the same names, and matched on the whole name: "Barbell Squat" is also a
 * substring of five other exercises.
 */
async function pickExercise(page: Page, name: string) {
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page
    .locator('.exercise-list li')
    .filter({ has: page.getByText(name, { exact: true }) })
    .getByRole('button')
    .click();
}

async function createRoutine(page: Page, name: string, exercises: string[]) {
  await tab(page, 'Routines').click();
  await page.getByLabel('New routine name').fill(name);
  await page.getByRole('button', { name: 'Add routine' }).click();
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('heading', { name: 'Edit routine' })).toBeVisible();

  await page.getByRole('button', { name: 'Add exercise' }).click();
  const added: string[] = [];
  for (const exercise of exercises) {
    await pickExercise(page, exercise);
    added.push(exercise);
    // The next pick waits for this one to land, so the order is the one given.
    await expect(page.getByTestId('routine-item-name')).toHaveText(added);
  }
}

/** Starts the routine Today offers, and waits for its session screen. */
async function startWorkout(page: Page, routine: string) {
  await tab(page, 'Today').click();
  await page.getByRole('button', { name: `Start ${routine}` }).click();
  await expect(page.getByRole('heading', { name: routine, level: 2 })).toBeVisible();
}

/** Finishes the workout, and waits until Today shows the next routine. */
async function finishWorkout(page: Page, nextRoutine: string) {
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await expect(todayHeading(page)).toBeVisible();
  await expect(page.getByRole('button', { name: `Start ${nextRoutine}` })).toBeVisible();
}

// Contexts made by hand are not closed for us when a test fails part-way.
const opened: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(opened.splice(0).map((context) => context.close()));
});

test('a backup made in one browser restores identically into an empty one', async ({
  browser, baseURL,
}) => {
  test.setTimeout(180_000);

  // Both contexts get the same iPhone viewport the project runs with:
  // `browser.newContext` does not inherit the project's `use`.
  const contextOptions = { ...devices['iPhone 13'], baseURL };

  // ── Context A: build a history through the UI ─────────────────────────
  const contextA = await browser.newContext(contextOptions);
  opened.push(contextA);
  // Before the first navigation, so the page never sees the real
  // navigator.share. The test then runs the share path the phone uses, not
  // the download fallback, and keeps the File the app handed over.
  await contextA.addInitScript(() => {
    (window as unknown as { __shared: File[] }).__shared = [];
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: async ({ files }: { files: File[] }) => {
        (window as unknown as { __shared: File[] }).__shared.push(...files);
      },
      configurable: true,
    });
  });
  const a = await contextA.newPage();

  await a.goto(APP);
  await expect(todayHeading(a)).toBeVisible(FIRST_LOAD);

  // 1. Edit a bundled exercise: a new name, and a timed rather than counted one.
  await tab(a, 'Library').click();
  await a.getByRole('searchbox', { name: 'Search exercises' }).fill('Side to Side Box Shuffle');
  await a
    .locator('.exercise-list li')
    .filter({ has: a.getByText('Side to Side Box Shuffle', { exact: true }) })
    .getByRole('button')
    .click();
  await expect(a.getByRole('heading', { name: 'Edit exercise' })).toBeVisible();
  await a.getByLabel('Exercise name').fill('Lateral Shuffle');
  await a.getByLabel('Measurement').selectOption('duration');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(a.getByRole('heading', { name: 'Edit exercise' })).toBeHidden();

  // 2. Create a custom exercise.
  await a.getByRole('button', { name: 'New exercise' }).click();
  await a.getByLabel('Exercise name').fill('Explosive Box Step-Up');
  await a.getByLabel('Equipment').selectOption('bodyweight');
  await a.getByLabel('Primary muscle').selectOption('quads');
  await a.getByLabel('Measurement').selectOption('bodyweight_reps');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(a.getByRole('heading', { name: 'New exercise' })).toBeHidden();

  // 3. Two routines from them, and both in the rotation.
  await createRoutine(a, 'Upper A', ['Explosive Box Step-Up', 'Lateral Shuffle']);
  await createRoutine(a, 'Lower A', ['Barbell Squat']);
  await tab(a, 'Rotation').click();
  await a.getByRole('button', { name: 'Add Upper A to rotation' }).click();
  await a.getByRole('button', { name: 'Add Lower A to rotation' }).click();
  await expect(a.getByTestId('cycle-slot-name')).toHaveText(['Upper A', 'Lower A']);

  // 4. Upper A: a counted set and a timed one.
  await startWorkout(a, 'Upper A');
  await a.getByRole('spinbutton', { name: 'Reps for set 1' }).fill('6');
  await a.getByRole('button', { name: 'Log set 1' }).click();
  await expect(a.getByRole('button', { name: 'Remove logged set 1' })).toBeVisible();

  await a
    .getByRole('navigation', { name: 'Exercises in this session' })
    .getByRole('button', { name: 'Lateral Shuffle' })
    .click();
  await a.getByRole('spinbutton', { name: 'Seconds for set 1' }).fill('20');
  await a.getByRole('button', { name: 'Log set 1' }).click();
  await expect(a.getByRole('button', { name: 'Remove logged set 1' })).toBeVisible();
  await finishWorkout(a, 'Lower A');

  // 5. Lower A, with the unit still the default lb: a warm-up, then a
  //    fractional working set.
  await startWorkout(a, 'Lower A');
  const weight = a.getByRole('spinbutton', { name: 'Weight for set 1' });
  const reps = a.getByRole('spinbutton', { name: 'Reps for set 1' });
  const warmup = a.getByRole('checkbox', { name: 'Mark set 1 as a warm-up' });
  await warmup.check();
  await weight.fill('135');
  await reps.fill('5');
  await a.getByRole('button', { name: 'Log set 1' }).click();
  await expect(a.getByRole('button', { name: 'Remove logged set 1' })).toBeVisible();
  // The row clears itself once the set has landed. Typing before that would
  // be cleared along with it.
  await expect(weight).toHaveValue('');
  await expect(warmup).not.toBeChecked();
  await weight.fill('22.5');
  await reps.fill('8');
  await a.getByRole('button', { name: 'Log set 1' }).click();
  await expect(a.getByRole('button', { name: 'Remove logged set 2' })).toBeVisible();
  await finishWorkout(a, 'Upper A');

  // 6. Settings: kg, and two minutes' rest.
  await openSettings(a);
  await a.getByRole('radio', { name: 'kg' }).click();
  await expect(a.getByRole('radio', { name: 'kg' })).toBeChecked();
  const rest = a.getByLabel('Default rest between sets (seconds)');
  await rest.fill('120');
  await rest.blur();
  // Leave and come back: the field then shows what was stored, not a draft.
  await tab(a, 'Today').click();
  await openSettings(a);
  await expect(rest).toHaveValue('120');
  await expect(a.getByRole('radio', { name: 'kg' })).toBeChecked();

  // 7. Upper A again, with an exercise that has no history, so it takes the
  //    kg default.
  await startWorkout(a, 'Upper A');
  await a.getByRole('button', { name: 'Add exercise' }).click();
  await pickExercise(a, 'Barbell Bench Press - Medium Grip');
  await expect(
    a.getByRole('heading', { name: 'Barbell Bench Press - Medium Grip', level: 3 }),
  ).toBeVisible();
  await expect(a.getByText('Weight (kg)', { exact: true })).toBeVisible();
  await a.getByRole('spinbutton', { name: 'Weight for set 1' }).fill('60');
  await a.getByRole('spinbutton', { name: 'Reps for set 1' }).fill('5');
  await a.getByRole('button', { name: 'Log set 1' }).click();
  await expect(a.getByRole('button', { name: 'Remove logged set 1' })).toBeVisible();
  await finishWorkout(a, 'Lower A');

  // ── Back up, through the share stub ───────────────────────────────────
  await openSettings(a);
  await a.getByRole('button', { name: 'Back up now' }).click();
  await expect(a.getByText('Backup saved.', { exact: true })).toBeVisible();

  const shared = await a.evaluate(async () => {
    const files = (window as unknown as { __shared: File[] }).__shared;
    const file = files[0];
    return { count: files.length, name: file ? file.name : '', text: file ? await file.text() : '' };
  });
  expect(shared.count).toBe(1);
  expect(shared.name).toBeTruthy();
  const { name, text } = shared;

  const dumpA = await dumpDatabase(a);

  // ── Context B: new and empty ──────────────────────────────────────────
  const contextB = await browser.newContext(contextOptions);
  opened.push(contextB);
  const b = await contextB.newPage();
  await b.goto(APP);
  await expect(todayHeading(b)).toBeVisible(FIRST_LOAD);

  await openSettings(b);
  await b.getByLabel('Restore from backup…').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
  await expect(b.getByRole('heading', { name: 'Restore this backup?' })).toBeVisible();
  await b.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(b.getByText('Restored.', { exact: true })).toBeVisible();

  const dumpB = await dumpDatabase(b);

  // ── The comparison: every store, every field ──────────────────────────
  // Settings included: A recorded the backup at `exportedAt`, and a restore
  // records the same instant on B.
  expect(dumpB).toEqual(dumpA);
  const exportedAt = (JSON.parse(text) as { exportedAt: unknown }).exportedAt;
  expect(typeof exportedAt).toBe('number');
  expect((dumpB.settings[0] as Settings).lastBackupAt).toBe(exportedAt);

  // ── Non-vacuity: the dumps agree about something worth agreeing about ──
  const setsA = dumpA.sets as LoggedSet[];
  const setsB = dumpB.sets as LoggedSet[];

  // The fractional lb weight, in lb, at the instant it was logged.
  const lbSet = setsB.find((s) => s.weight === 22.5 && s.unit === 'lb');
  expect(lbSet).toBeDefined();
  expect(setsA.find((s) => s.id === lbSet?.id)?.completedAt).toBe(lbSet?.completedAt);
  // A kg set that stayed kg, a warm-up, and a timed set.
  expect(setsB).toContainEqual(expect.objectContaining({ unit: 'kg', weight: 60 }));
  expect(setsB).toContainEqual(expect.objectContaining({ setType: 'warmup', weight: 135 }));
  expect(setsB).toContainEqual(expect.objectContaining({ durationSeconds: 20 }));
  expect(setsB.length).toBeGreaterThanOrEqual(5);

  const exercisesB = dumpB.exercises as Exercise[];
  expect(exercisesB).toContainEqual(
    expect.objectContaining({ name: 'Explosive Box Step-Up', isCustom: true }),
  );
  expect(exercisesB.find((e) => e.id === 'Side_to_Side_Box_Shuffle')?.name).toBe('Lateral Shuffle');

  // The empty rotation B made for itself is gone, and exactly one is active.
  const cyclesB = dumpB.cycles as Cycle[];
  expect(cyclesB).toHaveLength(1);
  expect(cyclesB[0].isActive).toBe(true);
});
