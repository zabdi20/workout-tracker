import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listExercises } from '../../db/exercises';
import { EMPTY_FILTER, filterExercises, type ExerciseFilter } from '../../domain/exerciseFilter';
import { ExerciseList } from './ExerciseList';

export function LibraryScreen() {
  const [filter, setFilter] = useState<ExerciseFilter>(EMPTY_FILTER);
  const exercises = useLiveQuery(() => listExercises(), []);

  const visible = useMemo(
    () => filterExercises(exercises ?? [], filter),
    [exercises, filter],
  );

  return (
    <section>
      <h2>Exercises</h2>

      <input
        type="search"
        aria-label="Search exercises"
        placeholder="Search exercises"
        value={filter.query}
        onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
      />

      {exercises === undefined ? (
        <p>Loading…</p>
      ) : (
        <>
          <p className="count">{visible.length} exercises</p>
          <ExerciseList exercises={visible} />
        </>
      )}
    </section>
  );
}
