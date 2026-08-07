import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Exercise } from '../../db/types';
import { listExercises } from '../../db/exercises';
import {
  EMPTY_FILTER, availableEquipment, availableMuscles, filterExercises,
  isFilterActive, type ExerciseFilter,
} from '../../domain/exerciseFilter';
import { CustomExerciseForm } from './CustomExerciseForm';
import { ExerciseList } from './ExerciseList';
import { FilterSheet } from './FilterSheet';

export function LibraryScreen() {
  const [filter, setFilter] = useState<ExerciseFilter>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<Exercise | 'new' | null>(null);
  const exercises = useLiveQuery(() => listExercises(), []);

  const visible = useMemo(
    () => filterExercises(exercises ?? [], filter),
    [exercises, filter],
  );

  const muscleFacets = useMemo(() => availableMuscles(exercises ?? []), [exercises]);
  const equipmentFacets = useMemo(() => availableEquipment(exercises ?? []), [exercises]);

  const activeCount = filter.muscles.length + filter.equipment.length;

  return (
    <section>
      <h2>Exercises</h2>

      {editing && (
        <CustomExerciseForm
          key={editing === 'new' ? 'new' : editing.id}
          existing={editing === 'new' ? undefined : editing}
          onDone={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      )}

      <input
        type="search"
        aria-label="Search exercises"
        placeholder="Search exercises"
        value={filter.query}
        onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
      />

      <div className="filter-controls">
        <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
        {isFilterActive(filter) && (
          <button type="button" onClick={() => setFilter(EMPTY_FILTER)}>
            Clear filters
          </button>
        )}
        <button type="button" onClick={() => setEditing('new')}>New exercise</button>
      </div>

      {showFilters && (
        <FilterSheet
          filter={filter}
          onChange={setFilter}
          availableMuscles={muscleFacets}
          availableEquipment={equipmentFacets}
        />
      )}

      {exercises === undefined ? (
        <p>Loading…</p>
      ) : (
        <>
          <p className="count">{visible.length} exercise{visible.length === 1 ? '' : 's'}</p>
          <ExerciseList exercises={visible} onSelect={(e) => e.isCustom && setEditing(e)} />
        </>
      )}
    </section>
  );
}
