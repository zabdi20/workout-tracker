import { Link, Navigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSession } from '../../db/sessions';
import { listSetsForExercise, listSetsForSession } from '../../db/sets';
import { listExercises } from '../../db/exercises';
import { detectAllPrs } from '../../domain/records';
import { useWriteError } from '../useWriteError';
import { AddSetForm } from './AddSetForm';
import { DeleteWorkoutControl } from './DeleteWorkoutControl';
import { MoveWorkoutControl } from './MoveWorkoutControl';
import { PastSetRow } from './PastSetRow';
import { formatWorkoutDuration } from './format';
import type { LoggedSet } from '../../db/types';

/** The sets of each exercise in this workout, exercises in the order trained. */
function groupByExercise(sets: LoggedSet[]) {
  // `sets` arrives sorted by (order, completedAt), and a Map keeps insertion
  // order, so each group's sets are already in display order.
  const groups = new Map<string, LoggedSet[]>();
  for (const s of sets) {
    const group = groups.get(s.exerciseId);
    if (group) group.push(s);
    else groups.set(s.exerciseId, [s]);
  }

  // Exercises go in the order they were first trained, by the earliest set's
  // time, and not in the order listSetsForSession met them. That sort is by
  // `order`, which is per exercise: a bench whose first set was deleted has a
  // lone set with order 1 and would trail every exercise that still has an
  // order-0 set, however early in the workout it was done.
  return [...groups.entries()]
    .map(([exerciseId, groupSets]) => ({
      exerciseId,
      sets: groupSets,
      firstAt: Math.min(...groupSets.map((s) => s.completedAt)),
    }))
    .sort((a, b) => a.firstAt - b.firstAt);
}

export function PastWorkoutScreen() {
  const { sessionId } = useParams<{ sessionId: string }>();
  // One runner for every write on this screen, so a failed one has a single
  // place to show itself. Called before the early returns below: hooks cannot
  // follow a conditional return.
  const { error, run } = useWriteError();

  // One querier, read-only throughout. Resolves to `undefined` while loading
  // and `null` when the id matches no workout, so "still loading" and "not
  // found" are distinguishable; without the `?? null` a missing workout would
  // sit on "Loading…" forever. Same shape as RoutineEditor.
  const data = useLiveQuery(async () => {
    const session = sessionId ? (await getSession(sessionId)) ?? null : null;
    if (!session) return null;

    // The live workout belongs to the active-session screen. Nothing more is
    // read for it: the screen only redirects.
    if (session.status === 'in_progress') return { kind: 'in_progress' as const };

    const [sets, exercises] = await Promise.all([
      listSetsForSession(session.id),
      listExercises({ includeArchived: true }),
    ]);

    // Each exercise's FULL history, not just this workout's sets. A PR means
    // beating everything that came before it; judged inside this workout
    // alone, the first set of every exercise would set the bar and a later
    // lighter one could never be told apart from a real record.
    const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))];
    const history = (
      await Promise.all(exerciseIds.map((id) => listSetsForExercise(id)))
    ).flat();
    const prs = detectAllPrs(history, exercises);

    return { kind: 'completed' as const, session, sets, exercises, prs };
  }, [sessionId]);

  if (data === undefined) return <p>Loading…</p>;
  if (data === null) {
    return (
      <section>
        <p role="alert">Workout not found.</p>
        <Link to="/history">Back to history</Link>
      </section>
    );
  }
  if (data.kind === 'in_progress') return <Navigate to="/session" replace />;

  const { session, sets, exercises, prs } = data;
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  return (
    <section>
      <h2>{session.name}</h2>
      {error && <p role="alert">{error}</p>}
      <p>
        {`${new Date(session.startedAt).toLocaleString()} · ${formatWorkoutDuration(session.startedAt, session.endedAt)}`}
      </p>
      <MoveWorkoutControl sessionId={session.id} startedAt={session.startedAt} run={run} />

      {sets.length === 0 && <p className="empty">No sets were logged.</p>}

      {groupByExercise(sets).map((group) => {
        const exercise = exerciseById.get(group.exerciseId);
        const name = exercise?.name ?? 'Unknown exercise';
        const measurementType = exercise?.measurementType ?? 'weight_reps';
        return (
          <div key={group.exerciseId}>
            <h3>{`${name}${exercise?.isArchived ? ' (archived)' : ''}`}</h3>
            <ol>
              {group.sets.map((set, index) => (
                <PastSetRow
                  key={set.id}
                  set={set}
                  number={index + 1}
                  exerciseName={name}
                  measurementType={measurementType}
                  kinds={prs.get(set.id)}
                  run={run}
                />
              ))}
            </ol>
            <AddSetForm
              sessionId={session.id}
              exerciseId={group.exerciseId}
              exerciseName={name}
              measurementType={measurementType}
              lastSet={group.sets[group.sets.length - 1]}
              run={run}
            />
          </div>
        );
      })}

      <DeleteWorkoutControl sessionId={session.id} run={run} />
    </section>
  );
}
