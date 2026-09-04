import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getRoutine, renameRoutine, updateRoutineItems } from '../../db/routines';
import { useWriteError } from '../useWriteError';
import { listExercises } from '../../db/exercises';
import {
  addItem, moveItem, removeItem, setItemPrescription, validatePrescription,
  type Prescription,
} from '../../domain/routineItems';
import { ExerciseBrowser } from '../library/ExerciseBrowser';

const PRESCRIPTION_FIELDS = [
  { field: 'targetSets', fieldLabel: 'Sets' },
  { field: 'targetRepMin', fieldLabel: 'Lowest reps' },
  { field: 'targetRepMax', fieldLabel: 'Highest reps' },
  { field: 'restSeconds', fieldLabel: 'Rest seconds' },
] as const;

export function RoutineEditor() {
  const { routineId } = useParams<{ routineId: string }>();
  const [draftName, setDraftName] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const { error, run } = useWriteError();

  // Draft values keyed by `${itemId}:${field}`, so typing stays smooth and the
  // stored value shows through until the user edits. Same shape as draftName:
  // deriving the displayed value removes the seeding effect entirely, which
  // could otherwise fire after the user started typing and discard their input.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [prescriptionError, setPrescriptionError] = useState<string | null>(null);

  // Resolves to `undefined` while loading and `null` when the id matches no
  // routine, so "still loading" and "not found" are distinguishable. Without
  // the `?? null`, a missing routine is indistinguishable from a pending
  // query and the screen would sit on "Loading…" forever.
  const routine = useLiveQuery(
    async () => (routineId ? (await getRoutine(routineId)) ?? null : null),
    [routineId],
  );
  const exercises = useLiveQuery(() => listExercises({ includeArchived: true }), []);

  if (routine === undefined || exercises === undefined) return <p>Loading…</p>;
  if (routine === null) return <p role="alert">Routine not found.</p>;

  const nameById = new Map(exercises.map((e) => [e.id, e.name]));
  const archivedIds = new Set(exercises.filter((e) => e.isArchived).map((e) => e.id));

  // Bound after the guards above, so no non-null assertion is needed.
  const { id: currentId, items } = routine;

  // The field shows the stored name until the user edits, then their draft.
  // Deriving it removes the seeding effect entirely, which could otherwise
  // fire after the user started typing and discard their input.
  const nameValue = draftName ?? routine.name;

  function saveName() {
    return run(() => renameRoutine(currentId, nameValue));
  }

  function prescriptionValue(itemId: string, field: keyof Prescription): string {
    const key = `${itemId}:${field}`;
    if (key in drafts) return drafts[key];
    const stored = items.find((i) => i.id === itemId)?.[field];
    return stored === undefined ? '' : String(stored);
  }

  // Commits on blur rather than behind a button. Four fields per item would
  // otherwise need a Save button per item, and updateRoutineItems makes
  // overlapping commits safe.
  async function commitPrescription(itemId: string, field: keyof Prescription) {
    const key = `${itemId}:${field}`;
    if (!(key in drafts)) return;

    const raw = drafts[key].trim();
    const value = raw === '' ? undefined : Number(raw);

    const item = items.find((i) => i.id === itemId);
    const merged: Prescription = {
      targetSets: item?.targetSets,
      targetRepMin: item?.targetRepMin,
      targetRepMax: item?.targetRepMax,
      restSeconds: item?.restSeconds,
      [field]: value,
    };

    const problem = value !== undefined && Number.isNaN(value)
      ? 'Targets must be a whole number of 1 or more.'
      : validatePrescription(merged);

    if (problem) {
      setPrescriptionError(problem);
      return;
    }

    setPrescriptionError(null);

    // `wrote`, not a bare await: run() catches internally and never rejects,
    // so the code after it runs on both outcomes. Clearing the draft before
    // the write — or after it unconditionally — throws away what the user
    // typed the moment a write fails and snaps the field back to the stored
    // number, exactly when they need to retry rather than retype. Same shape
    // as ActiveSessionScreen.confirmSet, for the same reason.
    let wrote = false;
    await run(async () => {
      await updateRoutineItems(currentId, (current) =>
        setItemPrescription(current, itemId, { [field]: value }),
      );
      wrote = true;
    });

    if (wrote) {
      setDrafts((d) => {
        const { [key]: _committed, ...rest } = d;
        return rest;
      });
    }
  }

  return (
    <section>
      <h2>Edit routine</h2>

      {error && <p role="alert">{error}</p>}
      {prescriptionError && <p role="alert">{prescriptionError}</p>}

      <label>
        Routine name
        <input value={nameValue} onChange={(e) => setDraftName(e.target.value)} />
      </label>
      <button type="button" onClick={saveName}>Save name</button>

      <h3>Exercises</h3>
      {items.length === 0 ? (
        <p className="empty">No exercises yet. Add one below.</p>
      ) : (
        <ol className="routine-items">
          {items.map((item) => {
            const label = nameById.get(item.exerciseId) ?? 'Unknown exercise';
            return (
              <li key={item.id}>
                <span data-testid="routine-item-name">{label}</span>
                {archivedIds.has(item.exerciseId) && <span> (archived)</span>}
                <button
                  type="button"
                  aria-label={`Move ${label} up`}
                  onClick={() => run(() => updateRoutineItems(currentId, (current) => moveItem(current, item.id, 'up')))}
                >
                  Up
                </button>
                <button
                  type="button"
                  aria-label={`Move ${label} down`}
                  onClick={() => run(() => updateRoutineItems(currentId, (current) => moveItem(current, item.id, 'down')))}
                >
                  Down
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => run(() => updateRoutineItems(currentId, (current) => removeItem(current, item.id)))}
                >
                  Remove
                </button>
                <div className="prescription">
                  {PRESCRIPTION_FIELDS.map(({ field, fieldLabel }) => (
                    <label key={field}>
                      <span>{fieldLabel}</span>
                      <input
                        type="number"
                        min={1}
                        aria-label={`${fieldLabel} for ${label}`}
                        value={prescriptionValue(item.id, field)}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [`${item.id}:${field}`]: e.target.value }))
                        }
                        onBlur={() => void commitPrescription(item.id, field)}
                      />
                    </label>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <button type="button" onClick={() => setPicking((p) => !p)}>
        {picking ? 'Done adding' : 'Add exercise'}
      </button>

      {picking && (
        <ExerciseBrowser
          onSelect={(exercise) =>
            run(() =>
              updateRoutineItems(currentId, (current) =>
                addItem(current, exercise.id, crypto.randomUUID()),
              ),
            )
          }
        />
      )}
    </section>
  );
}
