import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { archiveRoutine, createRoutine, listRoutines, unarchiveRoutine } from '../../db/routines';
import { useWriteError } from '../useWriteError';

export function RoutinesScreen() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const routines = useLiveQuery(() => listRoutines(), []);
  // Separate live query, not a filter over `routines` above: that query
  // deliberately excludes archived rows, so restoring a routine needs its
  // own read of the full set.
  const archivedRoutines = useLiveQuery(
    () => listRoutines({ includeArchived: true }).then((all) => all.filter((r) => r.isArchived)),
    [],
  );
  const { error: restoreError, run } = useWriteError();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createRoutine(name);
      setName('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleArchive(id: string) {
    setError(null);
    try {
      await archiveRoutine(id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2>Routines</h2>

      <form onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}
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
          {restoreError && <p role="alert">{restoreError}</p>}
          <ul className="archived-routine-list">
            {archivedRoutines.map((routine) => (
              <li key={routine.id}>
                <span className="routine-name">{routine.name}</span>
                <button
                  type="button"
                  aria-label={`Restore ${routine.name}`}
                  onClick={() => run(() => unarchiveRoutine(routine.id))}
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
