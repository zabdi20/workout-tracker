import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { discardSession, finishSession, getInProgressSession } from '../../db/sessions';
import { getRoutine } from '../../db/routines';
import { listExercises } from '../../db/exercises';
import { getSettings } from '../../db/settings';
import { deleteSet, lastPerformance, listSetsForSession, logSet } from '../../db/sets';
import { useWriteError } from '../useWriteError';
import { formatDuration, formatSet, measurementFields } from '../../domain/measurement';
import { planSets } from '../../domain/setPlan';
import { ExerciseBrowser } from '../library/ExerciseBrowser';
import type { LoggedSet, RoutineItem } from '../../db/types';

export function ActiveSessionScreen() {
  const { error, run } = useWriteError();
  const navigate = useNavigate();

  // Identity-based, not positional: the exercise list grows when one is added
  // mid-session, and an index would silently point at a different movement.
  // The same lesson the rotation pointer taught.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Per-exercise signed count of rows the user added or removed.
  const [adjust, setAdjust] = useState<Record<string, number>>({});
  // Edits to unconfirmed rows, keyed `${exerciseId}:${position}:${property}`.
  // Overlaid on the derived prefill, the same way RoutineEditor overlays
  // draftName — which avoids a seeding effect that could land after the user
  // has started typing and discard their input.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [warmup, setWarmup] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // Exercises added this session that have no logged set yet. Held here
  // rather than stored: the session's exercise list is derived from the
  // routine plus whatever has sets, so adding one writes nothing. The
  // consequence is that an added exercise with no sets is gone after a
  // reload — nothing was lost, because nothing was done.
  const [added, setAdded] = useState<string[]>([]);

  // One querier rather than several chained ones: splitting the session read
  // from the routine read would make the second lag a render behind the
  // first, flashing an empty screen on every write.
  //
  // Every call in here is read-only. Dexie throws ReadOnlyError if a
  // liveQuery querier opens a readwrite transaction, so this screen creates
  // nothing — Today starts the session, and landing here without one
  // redirects rather than starting one.
  const data = useLiveQuery(async () => {
    const session = await getInProgressSession();
    if (!session) return null;

    const routine = session.routineId ? (await getRoutine(session.routineId)) ?? null : null;
    const [sets, exercises, settings] = await Promise.all([
      listSetsForSession(session.id),
      listExercises({ includeArchived: true }),
      getSettings(),
    ]);

    const exerciseIds = new Set([
      ...(routine?.items ?? []).map((i) => i.exerciseId),
      ...sets.map((s) => s.exerciseId),
      // An exercise added mid-session has no sets yet, so leaving it out
      // here leaves `history` with no entry for the one the user just
      // picked: the row renders unprefilled and the screen says "No history
      // for this exercise yet" even when they trained it last week. It
      // self-heals after the first set is logged — which is exactly the set
      // that needed the reference.
      ...added,
    ]);
    const history = Object.fromEntries(
      await Promise.all(
        [...exerciseIds].map(async (id) =>
          [id, await lastPerformance(id, session.id)] as const,
        ),
      ),
    );

    return { session, routine, sets, exercises, settings, history };
    // `added` is a dependency because the querier reads it. Resubscribing
    // cannot loop: setAdded returns the same array when the id is already
    // there, so the identity only changes when a new exercise is picked.
    // useLiveQuery keeps the previous result across a deps change, so this
    // re-query does not flash the loading state.
  }, [added]);

  if (data === undefined) return <p>Loading…</p>;
  if (data === null) return <Navigate to="/" replace />;

  const { session, routine, sets, exercises, settings, history } = data;
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const itemByExerciseId = new Map<string, RoutineItem>(
    (routine?.items ?? []).map((i) => [i.exerciseId, i]),
  );

  // Derived, never stored: the routine's items in order, then anything with
  // logged sets that is not in the routine. That is what makes Add exercise
  // free — it writes nothing.
  const routineIds = (routine?.items ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((i) => i.exerciseId);
  const extraIds = [
    ...new Set([...sets.map((s) => s.exerciseId), ...added]),
  ].filter((id) => !routineIds.includes(id));
  const exerciseIds = [...routineIds, ...extraIds];

  const focused = focusedId && exerciseIds.includes(focusedId) ? focusedId : exerciseIds[0];

  async function finish() {
    let done = false;
    await run(async () => {
      await finishSession(session.id);
      done = true;
    });
    // Gated on the local flag, not run unconditionally: a failed finish must
    // leave the user on this screen with their session still open, not send
    // them to Today believing it completed.
    if (done) navigate('/');
  }

  async function discard() {
    let done = false;
    await run(async () => {
      await discardSession(session.id);
      done = true;
    });
    if (done) navigate('/');
  }

  // Declared above the early returns and rendered by every path below, in
  // one copy rather than three. The empty-exercise-list path is why: a
  // routine emptied while its session is open used to return early with no
  // Finish and no Discard, and Today offers Resume rather than Start while a
  // session is in progress, so the only way out was clearing site data —
  // which takes every logged workout with it, since there is no export yet.
  // One copy cannot rot out of sync with the branch that needs it.
  //
  // Add exercise rides along because it is the constructive escape: adding
  // one puts a row back on an emptied session and the screen recovers.
  const sessionControls = (
    <>
      <button type="button" onClick={() => setPicking((p) => !p)}>
        {picking ? 'Done adding' : 'Add exercise'}
      </button>

      {picking && (
        <ExerciseBrowser
          onSelect={(chosen) => {
            setAdded((a) => (a.includes(chosen.id) ? a : [...a, chosen.id]));
            setFocusedId(chosen.id);
            setPicking(false);
          }}
        />
      )}

      <button type="button" onClick={() => void finish()}>
        Finish workout
      </button>

      {confirmingDiscard ? (
        <p>
          Discard this workout and everything logged in it?
          <button type="button" onClick={() => void discard()}>Yes, discard it</button>
          <button type="button" onClick={() => setConfirmingDiscard(false)}>Keep it</button>
        </p>
      ) : (
        <button type="button" onClick={() => setConfirmingDiscard(true)}>
          Discard workout
        </button>
      )}
    </>
  );

  if (exerciseIds.length === 0) {
    return (
      <section>
        <h2>{session.name}</h2>
        {error && <p role="alert">{error}</p>}
        <p className="empty">This routine has no exercises.</p>
        {sessionControls}
      </section>
    );
  }

  const exercise = exerciseById.get(focused);
  if (!exercise) {
    // Unreachable in practice: exercises are archived rather than deleted,
    // and the querier above loads archived ones. Guarding here once keeps
    // every use below non-null instead of scattering `!` assertions.
    // It still renders the write error and the controls the other paths do:
    // the one branch that behaves differently is the one nobody notices has
    // gone wrong.
    return (
      <section>
        <h2>{session.name}</h2>
        {error && <p role="alert">{error}</p>}
        <p role="alert">That exercise is no longer in the library.</p>
        {sessionControls}
      </section>
    );
  }

  const item = itemByExerciseId.get(focused);
  const logged = sets.filter((s) => s.exerciseId === focused);
  const last = history[focused] ?? [];
  const fields = measurementFields(exercise.measurementType);
  const restSeconds = item?.restSeconds ?? settings.defaultRestSeconds;

  const planned = planSets({
    targetSets: item?.targetSets,
    lastPerformance: last,
    logged,
    defaultUnit: settings.unitPreference,
    adjust: adjust[focused] ?? 0,
  });

  function draftKey(position: number, property: string) {
    return `${focused}:${position}:${property}`;
  }

  function valueFor(row: { position: number }, property: string, derived?: number) {
    const key = draftKey(row.position, property);
    if (key in drafts) return drafts[key];
    return derived === undefined ? '' : String(derived);
  }

  // An arrow function assigned to a const, not a function declaration: only
  // that form keeps TypeScript's narrowing of `exercise` (guarded above) in
  // scope here. A `function confirmSet(...)` declaration is hoisted and
  // loses the narrowing, since the checker can't rule out it being called
  // from somewhere before the guard ran.
  const confirmSet = async (row: (typeof planned)[number]) => {
    const key = `${focused}:${row.position}`;
    if (busy === key) return;
    setBusy(key);

    const values: Partial<LoggedSet> = {};
    for (const field of fields) {
      const raw = valueFor(row, field.property, row[field.property]);
      const parsed = raw.trim() === '' ? undefined : Number(raw);
      // Cast deliberately: field.property is a union of four keys, and
      // TypeScript narrows a union-keyed write to their intersection, which
      // is `never`. The runtime shape is correct by construction.
      if (parsed !== undefined && !Number.isNaN(parsed)) {
        (values as Record<string, number>)[field.property] = parsed;
      }
    }

    // Nothing parsed for any field: there is nothing to write. Calling
    // logSet here would put a set with no weight/reps/duration into the
    // sets table for something the user never performed — exactly what the
    // planned-rows-are-UI-state split exists to prevent, since that phantom
    // set would then surface as next session's prefill and silently blank
    // the row it was supposed to fill. Tapping a row you haven't filled in
    // yet isn't an error; it's just a no-op.
    if (Object.keys(values).length === 0) {
      setBusy(null);
      return;
    }

    // `wrote`, not `logged` — this function's own `logged` name is already
    // taken by the outer `const logged = sets.filter(...)` (a LoggedSet[]),
    // which this flag has no relation to.
    let wrote = false;
    await run(async () => {
      await logSet({
        sessionId: session.id,
        exerciseId: exercise.id,
        setType: warmup[key] ? 'warmup' : 'working',
        unit: row.unit,
        ...values,
      });
      wrote = true;
    });

    // Gated on the local flag, not run unconditionally: run() swallows a
    // rejection so it can render the message instead of throwing, which
    // means the code after it runs on both outcomes. Clearing here
    // regardless would wipe the weight and reps the user just typed the
    // moment a write fails — exactly when they need to retry, not retype.
    if (wrote) {
      setDrafts((d) => {
        const next = { ...d };
        for (const field of fields) delete next[draftKey(row.position, field.property)];
        return next;
      });
      setWarmup((w) => {
        const { [key]: _cleared, ...rest } = w;
        return rest;
      });
    }
    // Clears on both outcomes: only gating this too would leave a failed
    // row's confirm button disabled forever, trading a recoverable error
    // for a screen the user cannot do anything with.
    setBusy(null);
  };

  return (
    <section>
      <h2>{session.name}</h2>
      {error && <p role="alert">{error}</p>}

      <nav aria-label="Exercises in this session">
        {exerciseIds.map((id) => (
          <button
            key={id}
            type="button"
            aria-current={id === focused}
            onClick={() => setFocusedId(id)}
          >
            {exerciseById.get(id)?.name ?? 'Unknown exercise'}
          </button>
        ))}
      </nav>

      <h3>{exercise.name}</h3>
      {exercise.isArchived && <p>This exercise is archived.</p>}

      {item?.targetSets !== undefined && (
        <p className="prescription">
          {item.targetSets} &times;{' '}
          {item.targetRepMin !== undefined && item.targetRepMax !== undefined
            ? `${item.targetRepMin}–${item.targetRepMax}`
            : (item.targetRepMin ?? item.targetRepMax ?? '')}
        </p>
      )}
      <p className="rest">Rest {formatDuration(restSeconds)}</p>

      <p className="last-time">
        {last.length === 0
          ? 'No history for this exercise yet.'
          : `Last time: ${last
              .map((s) => formatSet(s, exercise.measurementType))
              .join(' · ')}`}
      </p>

      <ol className="logged-sets">
        {logged.map((set, index) => (
          <li key={set.id}>
            <span>
              {index + 1}. {formatSet(set, exercise.measurementType)}
              {set.setType === 'warmup' && ' (warm-up)'}
            </span>
            <button
              type="button"
              aria-label={`Remove logged set ${index + 1}`}
              onClick={() => run(() => deleteSet(set.id))}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>

      <ol className="planned-sets">
        {planned.map((row) => (
          <li key={row.position}>
            {fields.map((field) => (
              <label key={field.property}>
                {field.label}
                {field.unitBearing ? ` (${row.unit})` : ''}
                <input
                  type="number"
                  aria-label={`${field.label} for set ${row.position}`}
                  value={valueFor(row, field.property, row[field.property])}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [draftKey(row.position, field.property)]: e.target.value,
                    }))
                  }
                />
              </label>
            ))}

            <label>
              Warm-up
              <input
                type="checkbox"
                aria-label={`Mark set ${row.position} as a warm-up`}
                checked={warmup[`${focused}:${row.position}`] ?? false}
                onChange={(e) =>
                  setWarmup((w) => ({ ...w, [`${focused}:${row.position}`]: e.target.checked }))
                }
              />
            </label>

            <button
              type="button"
              // Disabled while its own write is in flight. Two fast taps
              // would otherwise log the set twice; logSet's transactional
              // order assignment keeps them distinct, but the second set is
              // still one the user did not perform.
              disabled={busy === `${focused}:${row.position}`}
              onClick={() => void confirmSet(row)}
            >
              Log set {row.position}
            </button>
          </li>
        ))}
      </ol>

      {planned.length > 0 && (
        <button
          type="button"
          // One control for the whole list, not one per row. `adjust` is a
          // signed count that planSets applies to the total row count — it
          // can express "one fewer row" but never "remove row N". A button
          // per row wired to that decrement always dropped the
          // highest-positioned row no matter which one was tapped, so the
          // label ("Remove planned set N") lied for every row but the last.
          // Naming the single remaining control for the row it actually
          // removes keeps the label honest instead of making the model
          // richer than a signed count for no user-visible gain.
          aria-label={`Remove planned set ${planned[planned.length - 1].position}`}
          onClick={() => setAdjust((a) => ({ ...a, [focused]: (a[focused] ?? 0) - 1 }))}
        >
          Remove
        </button>
      )}

      <button
        type="button"
        onClick={() => setAdjust((a) => ({ ...a, [focused]: (a[focused] ?? 0) + 1 }))}
      >
        Add set
      </button>

      {sessionControls}
    </section>
  );
}
