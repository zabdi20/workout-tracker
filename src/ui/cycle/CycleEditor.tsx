import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getActiveCycle, getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { listRoutines } from '../../db/routines';
import { withoutSlot, moveSlot } from '../../domain/cycle';
import { useWriteError } from '../useWriteError';

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
                      onClick={() => {
                        const next = moveSlot(cycle, index, 'up');
                        if (next !== cycle) void run(() => saveCycle(next));
                      }}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${label} down`}
                      onClick={() => {
                        const next = moveSlot(cycle, index, 'down');
                        if (next !== cycle) void run(() => saveCycle(next));
                      }}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${label} from rotation`}
                      onClick={() => run(() => saveCycle(withoutSlot(cycle, index)))}
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
