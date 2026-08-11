import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getActiveCycle, getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { listRoutines } from '../../db/routines';
import { useWriteError } from '../useWriteError';

/** Moves the entry at `index` one place in `direction`, returning a new array. */
function moveAt(ids: string[], index: number, direction: 'up' | 'down'): string[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function CycleEditor() {
  const { error, run } = useWriteError();
  // getActiveCycle, not getOrCreateActiveCycle: Dexie forbids opening a
  // readwrite transaction inside a liveQuery querier, and
  // getOrCreateActiveCycle always opens one (to stay race-safe under
  // StrictMode's double-invoked effects). The bootstrap effect below
  // creates the cycle instead, outside the liveQuery context; once it
  // lands, db.cycles's own change tracking re-runs this query.
  const cycle = useLiveQuery(() => getActiveCycle(), []);
  const routines = useLiveQuery(() => listRoutines(), []);

  useEffect(() => {
    void run(() => getOrCreateActiveCycle());
  }, []);

  if (cycle === undefined || routines === undefined) return <p>Loading…</p>;

  const nameById = new Map(routines.map((r) => [r.id, r.name]));

  return (
    <section>
      <h2>Rotation</h2>

      {error && <p role="alert">{error}</p>}

      {routines.length === 0 ? (
        <p className="empty">Create a routine first, then order them here.</p>
      ) : (
        <>
          <h3>Order</h3>
          {cycle.routineIds.length === 0 ? (
            <p className="empty">Nothing in the rotation yet.</p>
          ) : (
            <ol className="cycle-slots">
              {cycle.routineIds.map((routineId, index) => {
                const label = nameById.get(routineId) ?? 'Unknown routine';
                return (
                  <li key={`${routineId}-${index}`}>
                    <span data-testid="cycle-slot-name">{label}</span>
                    <button
                      type="button"
                      aria-label={`Move ${label} up`}
                      onClick={() =>
                        run(() => saveCycle({ ...cycle, routineIds: moveAt(cycle.routineIds, index, 'up') }))
                      }
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${label} down`}
                      onClick={() =>
                        run(() => saveCycle({ ...cycle, routineIds: moveAt(cycle.routineIds, index, 'down') }))
                      }
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${label} from rotation`}
                      onClick={() =>
                        run(() => saveCycle({
                          ...cycle,
                          routineIds: cycle.routineIds.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          <h3>Add to rotation</h3>
          <ul className="routine-picker">
            {routines.map((routine) => (
              <li key={routine.id}>
                <button
                  type="button"
                  aria-label={`Add ${routine.name} to rotation`}
                  onClick={() =>
                    run(() => saveCycle({ ...cycle, routineIds: [...cycle.routineIds, routine.id] }))
                  }
                >
                  {routine.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
