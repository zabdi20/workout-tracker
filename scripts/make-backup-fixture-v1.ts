/**
 * Generates the frozen version-1 fixture from the app's own write functions.
 * Never re-run it to make a failing fixture test pass; that test exists to
 * fail.
 *
 * Run once, with `npx tsx scripts/make-backup-fixture-v1.ts`. Everything goes
 * through the functions the app itself writes with (no hand-built rows), so
 * the fixture holds what version 1 of the app really produced, and a later
 * build that cannot restore it has broken a promise. Once the file exists the
 * script refuses to overwrite it.
 */
import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackup, recordBackup } from '../src/db/backup';
import { getOrCreateActiveCycle, saveCycle } from '../src/db/cycles';
import { db } from '../src/db/db';
import { createCustomExercise, updateExercise } from '../src/db/exercises';
import { createRoutine, getRoutine, setRoutineItems } from '../src/db/routines';
import { prepareLibrary } from '../src/db/seed';
import { finishSession, moveSession, startSession } from '../src/db/sessions';
import { logSet } from '../src/db/sets';
import { updateSettings } from '../src/db/settings';
import type { Exercise, RoutineItem } from '../src/db/types';
import bundled from '../src/data/exercises.json';
import { parseBackup } from '../src/domain/backupFormat';
import { sameRow } from '../src/domain/backupMerge';

const DAY = 86_400_000;
const OUT = fileURLToPath(new URL('../src/db/fixtures/backup-v1.json', import.meta.url));

if (existsSync(OUT)) {
  throw new Error(`${OUT} already exists. It is frozen: delete it by hand only if you mean to replace it.`);
}

// 1. The library, as a fresh install has it.
await prepareLibrary();

// 2. A library exercise the user edited, and one they made.
await updateExercise('Side_to_Side_Box_Shuffle', { name: 'Lateral Shuffle', measurementType: 'duration' });
const stepUp = await createCustomExercise({
  name: 'Explosive Box Step-Up',
  primaryMuscles: ['quads'],
  secondaryMuscles: ['glutes'],
  equipment: 'other',
  measurementType: 'bodyweight_reps',
});

// 3. A routine built from them, in the rotation.
const created = await createRoutine('Lower A');
const items: RoutineItem[] = [
  {
    id: crypto.randomUUID(), exerciseId: 'Barbell_Squat', order: 0,
    targetSets: 3, targetRepMin: 6, targetRepMax: 8, restSeconds: 150,
  },
  { id: crypto.randomUUID(), exerciseId: stepUp.id, order: 1 },
  { id: crypto.randomUUID(), exerciseId: 'Side_to_Side_Box_Shuffle', order: 2 },
];
await setRoutineItems(created.id, items);
const routine = await getRoutine(created.id);
if (!routine) throw new Error('The routine was not saved.');
const cycle = await getOrCreateActiveCycle();
await saveCycle({ ...cycle, routineIds: [routine.id] });

// 4. A finished workout, moved back three days.
const first = await startSession(routine);
await logSet({ sessionId: first.id, exerciseId: 'Barbell_Squat', setType: 'warmup', unit: 'lb', weight: 135, reps: 5 });
await logSet({ sessionId: first.id, exerciseId: 'Barbell_Squat', setType: 'working', unit: 'kg', weight: 22.5, reps: 8 });
await logSet({ sessionId: first.id, exerciseId: stepUp.id, setType: 'working', unit: 'lb', reps: 6 });
await logSet({ sessionId: first.id, exerciseId: 'Side_to_Side_Box_Shuffle', setType: 'working', unit: 'lb', durationSeconds: 20 });
await finishSession(first.id);
await moveSession(first.id, first.startedAt - 3 * DAY);

// 5. A second workout, left in progress.
const second = await startSession(routine);
await logSet({ sessionId: second.id, exerciseId: 'Barbell_Squat', setType: 'working', unit: 'lb', weight: 185, reps: 5 });

// 6. Settings that differ from a fresh install's.
await updateSettings({ unitPreference: 'kg', restAlertSound: false });

// 7. Back up, the way the app does: the file is built first, and the time is
//    recorded after it has been saved.
const prepared = await createBackup();
if (prepared.problem !== null) throw new Error(`The snapshot has a problem: ${prepared.problem}`);
await recordBackup(prepared.file.exportedAt);

// 8. Leave out the library exercises nobody touched. That keeps the file small,
//    and means the fixture's rows point at exercises that are only on the phone.
const library = new Map((bundled as Exercise[]).map((e) => [e.id, e]));
const { tables } = prepared.file;
const file = {
  ...prepared.file,
  tables: {
    ...tables,
    exercises: tables.exercises.filter((e) => {
      const original = library.get(e.id);
      return !(original && sameRow(e, original));
    }),
  },
};
const text = JSON.stringify(file, null, 2) + '\n';

const check = parseBackup(text, Date.now());
if (!check.ok) throw new Error(`The fixture does not validate: ${check.detail}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text);
db.close();

console.log(`Wrote ${OUT}`);
console.log(`formatVersion ${file.formatVersion}, exportedAt ${file.exportedAt}`);
for (const [name, rows] of Object.entries(file.tables)) console.log(`  ${name}: ${rows.length}`);
