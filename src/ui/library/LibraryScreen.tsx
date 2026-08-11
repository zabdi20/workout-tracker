import { useState } from 'react';
import type { Exercise } from '../../db/types';
import { CustomExerciseForm } from './CustomExerciseForm';
import { ExerciseBrowser } from './ExerciseBrowser';

export function LibraryScreen() {
  const [editing, setEditing] = useState<Exercise | 'new' | null>(null);

  return (
    <section>
      <h2>Exercises</h2>

      {editing && (
        // The key is load-bearing. The form seeds its fields from `existing`
        // via useState initialisers, which run only on mount. Without a key
        // that changes with the exercise, opening A then clicking B reuses
        // the instance: fields keep A's values while existing.id points at B,
        // and saving overwrites B with A's data.
        <CustomExerciseForm
          key={editing === 'new' ? 'new' : editing.id}
          existing={editing === 'new' ? undefined : editing}
          onDone={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      )}

      <ExerciseBrowser
        onSelect={(e) => e.isCustom && setEditing(e)}
        headerSlot={
          <button type="button" onClick={() => setEditing('new')}>
            New exercise
          </button>
        }
      />
    </section>
  );
}
