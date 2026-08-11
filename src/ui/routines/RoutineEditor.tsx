import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getRoutine, renameRoutine, setRoutineItems } from '../../db/routines';
import { useWriteError } from '../useWriteError';
import { listExercises } from '../../db/exercises';
import { addItem, moveItem, removeItem } from '../../domain/routineItems';
import { ExerciseBrowser } from '../library/ExerciseBrowser';

export function RoutineEditor() {
  const { routineId } = useParams<{ routineId: string }>();
  const [draftName, setDraftName] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const { error, run } = useWriteError();

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

  // Bound after the guards above, so no non-null assertion is needed.
  const { id: currentId, items } = routine;

  // The field shows the stored name until the user edits, then their draft.
  // Deriving it removes the seeding effect entirely, which could otherwise
  // fire after the user started typing and discard their input.
  const nameValue = draftName ?? routine.name;

  function saveName() {
    return run(() => renameRoutine(currentId, nameValue));
  }

  return (
    <section>
      <h2>Edit routine</h2>

      {error && <p role="alert">{error}</p>}

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
                <button
                  type="button"
                  aria-label={`Move ${label} up`}
                  onClick={() => run(() => setRoutineItems(currentId, moveItem(items, item.id, 'up')))}
                >
                  Up
                </button>
                <button
                  type="button"
                  aria-label={`Move ${label} down`}
                  onClick={() => run(() => setRoutineItems(currentId, moveItem(items, item.id, 'down')))}
                >
                  Down
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => run(() => setRoutineItems(currentId, removeItem(items, item.id)))}
                >
                  Remove
                </button>
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
            run(() => setRoutineItems(currentId, addItem(items, exercise.id, crypto.randomUUID())))
          }
        />
      )}
    </section>
  );
}
