import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getExercise } from '../../db/exercises';
import { listSetsForExercise } from '../../db/sets';
import { formatSet } from '../../domain/measurement';
import { exerciseRecords } from '../../domain/records';
import type { LoggedSet } from '../../db/types';

/** A record's set as shown on this page: its weight and reps, then its date. */
function withDate(set: LoggedSet): string {
  return `${formatSet(set, 'weight_reps')} · ${new Date(set.completedAt).toLocaleDateString()}`;
}

export function RecordsScreen() {
  const { exerciseId } = useParams<{ exerciseId: string }>();

  // One querier, read-only throughout. Resolves to `undefined` while loading
  // and `null` when the id matches no exercise, so "still loading" and "not
  // found" are distinguishable; without the `?? null` an unknown id would sit
  // on "Loading…" forever. Same shape as RoutineEditor and PastWorkoutScreen.
  const data = useLiveQuery(async () => {
    const exercise = exerciseId ? (await getExercise(exerciseId)) ?? null : null;
    if (!exercise) return null;

    // Records are kept for weight-and-reps exercises only, so no sets are read
    // for any other type.
    if (exercise.measurementType !== 'weight_reps') return { exercise, records: null };

    return { exercise, records: exerciseRecords(await listSetsForExercise(exercise.id)) };
  }, [exerciseId]);

  if (data === undefined) return <p>Loading…</p>;
  if (data === null) return <p role="alert">Exercise not found.</p>;

  const { exercise, records } = data;

  return (
    <section>
      <h2>{`${exercise.name} — records`}</h2>

      {records === null && <p>Records are kept for weight-and-reps exercises only.</p>}

      {records !== null && records.heaviest === null && <p>No working sets logged yet.</p>}

      {records !== null && records.heaviest !== null && (
        <>
          <p>{`Heaviest: ${withDate(records.heaviest)}`}</p>
          {/* Absent when every set is above the estimate's rep limit. */}
          {records.bestE1rm !== null && (
            <p>
              {`Best est. 1RM: ${records.bestE1rm.value.toFixed(1)} ${records.bestE1rm.set.unit}, from ${withDate(records.bestE1rm.set)}`}
            </p>
          )}
          <ol aria-label="Rep bests">
            {records.repBests.map((set) => (
              <li key={set.id}>{withDate(set)}</li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
