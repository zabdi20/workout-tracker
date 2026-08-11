import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { archiveRoutine, createRoutine, listRoutines } from '../../db/routines';

export function RoutinesScreen() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const routines = useLiveQuery(() => listRoutines(), []);

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
                onClick={() => archiveRoutine(routine.id)}
              >
                Archive
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
