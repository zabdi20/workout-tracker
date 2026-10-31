import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getActiveCycle, getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { getRoutine, listRoutines } from '../../db/routines';
import { listExercises } from '../../db/exercises';
import { getInProgressSession, listCompletedSessions, startSession } from '../../db/sessions';
import { getSettings } from '../../db/settings';
import { backupReminder } from '../../domain/backupReminder';
import { nextRoutineId, skipNext, cyclePosition } from '../../domain/cycle';
import { BackupButton } from '../backup/BackupButton';
import { useWriteError } from '../useWriteError';
import { WriteErrorAlert } from '../WriteErrorAlert';
import type { Routine } from '../../db/types';

/**
 * Nothing when no backup is due. There is no dismiss: the reminder goes when a
 * backup is recorded, which re-runs Today's query. That unmounts the button
 * before its own "Backup saved." shows, and the reminder going is the
 * confirmation.
 */
function BackupReminder({ due }: { due: ReturnType<typeof backupReminder> }) {
  if (due.kind === 'none') return null;
  return (
    <div role="status">
      {due.kind === 'never' ? (
        <p>You haven't backed up yet.</p>
      ) : (
        <p>Last backup was {due.days} days ago.</p>
      )}
      <BackupButton />
    </div>
  );
}

export function TodayScreen() {
  const { error, run } = useWriteError();
  // One query rather than two chained ones. Splitting the cycle read from
  // the routine read makes the second query lag a render behind the first,
  // which flashes "no longer available" every time the rotation changes.
  // getActiveCycle, not getOrCreateActiveCycle: Dexie forbids opening a
  // readwrite transaction inside a liveQuery querier, and
  // getOrCreateActiveCycle always opens one to stay race-safe under
  // StrictMode's double-invoked effects. The bootstrap effect below creates
  // the cycle outside that context; db.cycles change tracking then re-runs
  // this query. Returns null until the cycle exists.
  const data = useLiveQuery(async () => {
    const cycle = await getActiveCycle();
    if (!cycle) return null;
    const upNextId = nextRoutineId(cycle);
    const routine = upNextId ? (await getRoutine(upNextId)) ?? null : null;
    // Both read-only, so they join the same querier rather than a second
    // useLiveQuery — a split query lags a render behind this one, which
    // would flash stale UI every time the data changes.
    const inProgress = await getInProgressSession();
    const routines = await listRoutines();
    // Also read-only, for the backup reminder.
    const lastBackupAt = (await getSettings()).lastBackupAt;
    const completedStarts = (await listCompletedSessions()).map((s) => s.startedAt);
    return { cycle, routine, inProgress, routines, lastBackupAt, completedStarts };
  }, []);
  const exercises = useLiveQuery(() => listExercises({ includeArchived: true }), []);

  useEffect(() => {
    void run(() => getOrCreateActiveCycle());
  }, []);

  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);

  async function start(routine: Routine) {
    // startSession opens a readwrite transaction, which is why it is called
    // from a handler and never from the querier above — Dexie throws
    // ReadOnlyError for a readwrite transaction inside a liveQuery.
    let started = false;
    await run(async () => {
      await startSession(routine);
      started = true;
    });
    // Gated on the local flag: run() swallows a rejection so it can render
    // the message instead of throwing, so navigating unconditionally would
    // send the user to /session after a failed start — which redirects
    // straight back since no session exists there.
    if (started) navigate('/session');
  }

  if (data === undefined || data === null || exercises === undefined) {
    // Checked before falling through to "Loading…": if the bootstrap
    // effect's getOrCreateActiveCycle() rejects, no cycle is ever created,
    // so data stays null forever. Without this the user would be stuck on
    // "Loading…" with no diagnostic instead of seeing the failure. Once data
    // has loaded, a later write failure (e.g. Skip to next) is instead shown
    // inline below, alongside the still-visible routine.
    if (error) {
      return (
        <section>
          <h2>Today</h2>
          <WriteErrorAlert error={error} />
        </section>
      );
    }
    return <p>Loading…</p>;
  }
  const { cycle, routine, inProgress, routines, lastBackupAt, completedStarts } = data;
  // The real clock, read at render rather than in the querier, which only
  // re-runs when the data changes.
  const due = backupReminder(lastBackupAt, completedStarts, Date.now());

  if (cycle.routineIds.length === 0) {
    return (
      <section>
        <BackupReminder due={due} />
        <h2>Today</h2>
        <p className="empty">
          Nothing in your rotation yet. <Link to="/cycle">Build one</Link> to see
          what is next.
        </p>
      </section>
    );
  }

  const position = cyclePosition(cycle);
  const nameById = new Map((exercises ?? []).map((e) => [e.id, e.name]));

  return (
    <section>
      <BackupReminder due={due} />
      <h2>Today</h2>

      <p className="cycle-position">
        {position} of {cycle.routineIds.length}
      </p>

      {routine === null ? (
        <p role="alert">That routine is no longer available.</p>
      ) : (
        <>
          <h3>{routine.name}</h3>
          {routine.items.length === 0 ? (
            <p className="empty">
              No exercises in this routine.{' '}
              <Link to={`/routines/${routine.id}`}>Add some</Link>.
            </p>
          ) : (
            <ol className="routine-preview">
              {routine.items.map((item) => (
                <li key={item.id}>{nameById.get(item.exerciseId) ?? 'Unknown exercise'}</li>
              ))}
            </ol>
          )}
        </>
      )}

      <WriteErrorAlert error={error} />

      {inProgress ? (
        <p>
          <Link to="/session">Resume {inProgress.name}</Link>, started{' '}
          {new Date(inProgress.startedAt).toLocaleString()}
        </p>
      ) : (
        routine !== null &&
        routine.items.length > 0 && (
          <button type="button" onClick={() => void start(routine)}>
            Start {routine.name}
          </button>
        )
      )}

      <button type="button" onClick={() => setPicking((p) => !p)}>
        {picking ? 'Never mind' : 'Do a different one'}
      </button>

      {picking && (
        <ul className="routine-picker">
          {routines
            .filter((r) => r.items.length > 0)
            .map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => void start(r)}>
                  {r.name}
                </button>
              </li>
            ))}
        </ul>
      )}

      <button type="button" onClick={() => run(() => saveCycle(skipNext(cycle)))}>
        Skip to next
      </button>
    </section>
  );
}
