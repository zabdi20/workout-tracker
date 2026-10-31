import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { archiveRoutine, createRoutine, listRoutines, unarchiveRoutine } from '../../db/routines';
import { useWriteError } from '../useWriteError';
import { WriteErrorAlert } from '../WriteErrorAlert';

export function RoutinesScreen() {
  const [name, setName] = useState('');
  // Create and archive share one error surface; restoring has its own, shown
  // down in the Archived section where the Restore buttons are.
  const { error, run } = useWriteError();
  const { error: restoreError, run: runRestore } = useWriteError();
  const routines = useLiveQuery(() => listRoutines(), []);
  // Separate live query, not a filter over `routines` above: that query
  // deliberately excludes archived rows, so restoring a routine needs its
  // own read of the full set.
  const archivedRoutines = useLiveQuery(
    () => listRoutines({ includeArchived: true }).then((all) => all.filter((r) => r.isArchived)),
    [],
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // The name clears only once the routine is saved, so a failed create
    // (a full disk especially) leaves what the user typed in the field.
    if (await run(() => createRoutine(name))) setName('');
  }

  async function handleArchive(id: string) {
    await run(() => archiveRoutine(id));
  }

  return (
    <section>
      <h2>Routines</h2>

      <form onSubmit={handleSubmit}>
        <WriteErrorAlert error={error} />
        <label>
          New routine name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit">Add routine</button>
      </form>

      {routines === undefined ? (
        <p>Loading…</p>
      ) : routines.length === 0 ? (
        <p className="empty">No routines yet. Add one above to get started.</p>
      ) : (
        <ul className="routine-list">
          {routines.map((routine) => (
            <li key={routine.id}>
              <Link to={`/routines/${routine.id}`}>
                <span className="routine-name">{routine.name}</span>
                <span className="routine-meta">
                  {routine.items.length} exercise{routine.items.length === 1 ? '' : 's'}
                </span>
              </Link>
              <button
                type="button"
                aria-label={`Archive ${routine.name}`}
                onClick={() => handleArchive(routine.id)}
              >
                Archive
              </button>
            </li>
          ))}
        </ul>
      )}

      {archivedRoutines && archivedRoutines.length > 0 && (
        <section>
          <h3>Archived</h3>
          <p className="hint">
            Restoring a routine does not put it back in your rotation — add it
            again from Rotation if you want it there.
          </p>
          <WriteErrorAlert error={restoreError} />
          <ul className="archived-routine-list">
            {archivedRoutines.map((routine) => (
              <li key={routine.id}>
                <span className="routine-name">{routine.name}</span>
                <button
                  type="button"
                  aria-label={`Restore ${routine.name}`}
                  onClick={() => runRestore(() => unarchiveRoutine(routine.id))}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
