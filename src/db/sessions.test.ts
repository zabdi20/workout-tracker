import { db, resetDbForTests } from './db';
import { archiveRoutine, createRoutine } from './routines';
import {
  deleteCompletedSession,
  discardSession,
  finishSession,
  getInProgressSession,
  getSession,
  listCompletedSessions,
  moveSession,
  startSession,
} from './sessions';
import { getOrCreateActiveCycle, saveCycle, getActiveCycle } from './cycles';
import { lastPerformance, logSet } from './sets';

beforeEach(async () => {
  await resetDbForTests();
});

describe('getInProgressSession', () => {
  it('returns undefined when nothing is in progress', async () => {
    expect(await getInProgressSession()).toBeUndefined();
  });

  it('returns the session once one is started', async () => {
    const routine = await createRoutine('Push A');
    const started = await startSession(routine);
    expect((await getInProgressSession())?.id).toBe(started.id);
  });
});

describe('startSession', () => {
  it('snapshots the routine name so a later rename does not rewrite history', async () => {
    const routine = await createRoutine('Push A');
    const session = await startSession(routine);

    expect(session.name).toBe('Push A');
    expect(session.routineId).toBe(routine.id);
    expect(session.status).toBe('in_progress');
    expect(session.endedAt).toBeUndefined();
  });

  it('creates exactly one session when called concurrently', async () => {
    // StrictMode double-invokes effects, and a double-tap on Start is the
    // same race: both calls can observe an empty table before either writes.
    const routine = await createRoutine('Push A');
    await Promise.all([startSession(routine), startSession(routine)]);
    expect(await db.sessions.count()).toBe(1);
  });

  it('is idempotent for the same routine', async () => {
    const routine = await createRoutine('Push A');
    const first = await startSession(routine);
    const second = await startSession(routine);
    expect(second.id).toBe(first.id);
  });

  it('refuses to start a second session for a different routine', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    await startSession(push);

    await expect(startSession(pull)).rejects.toThrow(/already in progress/i);
    expect(await db.sessions.count()).toBe(1);
  });
});

describe('finishSession', () => {
  it('completes the session and stamps endedAt', async () => {
    const routine = await createRoutine('Push A');
    const session = await startSession(routine);

    await finishSession(session.id);

    const done = await getSession(session.id);
    expect(done?.status).toBe('completed');
    expect(done?.endedAt).toBeGreaterThan(0);
    expect(await getInProgressSession()).toBeUndefined();
  });

  it('advances the rotation past the routine that was trained', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    const cycle = await getOrCreateActiveCycle();
    await saveCycle({ ...cycle, routineIds: [push.id, pull.id], currentIndex: 0 });

    const session = await startSession(push);
    await finishSession(session.id);

    expect((await getActiveCycle())?.currentIndex).toBe(1);
  });

  it('re-anchors the rotation when a routine is trained out of order', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    const legs = await createRoutine('Legs');
    const cycle = await getOrCreateActiveCycle();
    await saveCycle({
      ...cycle,
      routineIds: [push.id, pull.id, legs.id],
      currentIndex: 0,
    });

    const session = await startSession(legs);
    await finishSession(session.id);

    // position(legs) + 1 wraps back to the start, not currentIndex + 1.
    expect((await getActiveCycle())?.currentIndex).toBe(0);
  });

  it('leaves the rotation alone when the routine was archived mid-session', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    const cycle = await getOrCreateActiveCycle();
    await saveCycle({ ...cycle, routineIds: [push.id, pull.id], currentIndex: 1 });

    const session = await startSession(pull);
    // archiveRoutine strips it from every cycle, so advanceAfter can no
    // longer find it. No special case is needed: indexOf returns -1 and
    // advanceAfter returns the cycle unchanged.
    await archiveRoutine(pull.id);
    await finishSession(session.id);

    const after = await getActiveCycle();
    expect(after?.routineIds).toEqual([push.id]);
    expect(after?.currentIndex).toBe(0);
    expect((await getSession(session.id))?.status).toBe('completed');
  });

  it('rejects an unknown session', async () => {
    await expect(finishSession('nope')).rejects.toThrow(/not found/i);
  });
});

describe('discardSession', () => {
  it('removes the session and every set logged into it', async () => {
    const routine = await createRoutine('Push A');
    const session = await startSession(routine);
    await logSet({
      sessionId: session.id,
      exerciseId: 'bench',
      setType: 'working',
      unit: 'lb',
      weight: 135,
      reps: 8,
    });

    await discardSession(session.id);

    expect(await getSession(session.id)).toBeUndefined();
    expect(await db.sets.count()).toBe(0);
  });

  it('leaves other sessions untouched', async () => {
    const push = await createRoutine('Push A');
    const first = await startSession(push);
    await logSet({
      sessionId: first.id,
      exerciseId: 'bench',
      setType: 'working',
      unit: 'lb',
      weight: 135,
      reps: 8,
    });
    await finishSession(first.id);

    const second = await startSession(push);
    await discardSession(second.id);

    expect(await getSession(first.id)).toBeDefined();
    expect(await db.sets.count()).toBe(1);
  });
});

const MIN = 60_000;
const DAY = 86_400_000;
const T = Date.UTC(2025, 0, 6, 17, 0); // a past Monday, on the minute

async function finished(
  id: string,
  startedAt: number,
  setTimes: number[] = [],
  routineId: string | null = null,
) {
  await db.sessions.add({ id, routineId, name: id, startedAt, endedAt: startedAt + 60 * MIN, status: 'completed' });
  for (const [i, at] of setTimes.entries()) {
    await db.sets.add({ id: `${id}-${i}`, sessionId: id, exerciseId: 'bench', order: i, setType: 'working', unit: 'lb', weight: 200, reps: 5, completedAt: at });
  }
}

describe('finishSession on a finished session', () => {
  it('does not re-stamp a session that is already finished', async () => {
    const session = await startSession(await createRoutine('Push A'));
    await finishSession(session.id);
    await db.sessions.update(session.id, { endedAt: 1000 });
    await finishSession(session.id);
    expect((await getSession(session.id))?.endedAt).toBe(1000);
  });

  it('does not advance the rotation a second time', async () => {
    // advanceAfter sets currentIndex to position(R) + 1, which is absolute: two
    // finishes in a row land on the same index, so a second advance would be
    // invisible. The pointer has to move on in between, as it does when the user
    // skips ahead, for a second advance to show.
    const a = await createRoutine('A');
    const b = await createRoutine('B');
    const c = await createRoutine('C');
    const cycle = await getOrCreateActiveCycle();
    const rotation = { ...cycle, routineIds: [a.id, b.id, c.id] };
    await saveCycle({ ...rotation, currentIndex: 0 });

    const session = await startSession(a);
    await finishSession(session.id);
    expect((await getActiveCycle())?.currentIndex).toBe(1);

    await saveCycle({ ...rotation, currentIndex: 2 });
    await finishSession(session.id);
    expect((await getActiveCycle())?.currentIndex).toBe(2);
  });
});

describe('listCompletedSessions', () => {
  it('lists finished workouts newest first and leaves out the one in progress', async () => {
    // The ids are chosen so that neither primary-key order, in either
    // direction, nor oldest-first happens to equal the expected order.
    await finished('a-mid', T + DAY);
    await finished('b-old', T);
    await finished('c-new', T + 2 * DAY);
    await db.sessions.add({ id: 'live', routineId: null, name: 'live', startedAt: T + 3 * DAY, status: 'in_progress' });
    expect((await listCompletedSessions()).map((s) => s.id)).toEqual(['c-new', 'a-mid', 'b-old']);
  });
});

describe('moveSession', () => {
  it('moves the workout and every one of its sets by the same amount', async () => {
    await finished('w', T, [T + MIN, T + 2 * MIN]);
    await moveSession('w', T - DAY);
    const moved = await getSession('w');
    expect(moved?.startedAt).toBe(T - DAY);
    expect(moved?.endedAt).toBe(T - DAY + 60 * MIN);
    expect((await db.sets.where('sessionId').equals('w').sortBy('order')).map((s) => s.completedAt))
      .toEqual([T - DAY + MIN, T - DAY + 2 * MIN]);
  });

  it('keeps "last time" pointing at the right workout after a move', async () => {
    await finished('earlier', T, [T + MIN]);
    await db.sets.update('earlier-0', { weight: 185 });
    await finished('later', T + DAY, [T + DAY + MIN]);
    await moveSession('later', T - DAY);
    expect((await lastPerformance('bench', 'none')).map((s) => s.weight)).toEqual([185]);
  });

  it('applies a repeated save of the same time only once', async () => {
    // Fired together, as a double-tap does, so the second call is already
    // waiting when the first starts. startedAt and endedAt are written as
    // absolute values and read the same after a double shift; only the set
    // shows it, so the assertion on the set is the one that matters.
    await finished('w', T, [T + MIN]);
    await Promise.all([moveSession('w', T - DAY), moveSession('w', T - DAY)]);
    const moved = await getSession('w');
    expect(moved?.startedAt).toBe(T - DAY);
    expect(moved?.endedAt).toBe(T - DAY + 60 * MIN);
    expect((await db.sets.get('w-0'))?.completedAt).toBe(T - DAY + MIN);
  });

  it('treats a time in the same minute as no change', async () => {
    await finished('w', T + 37_000, [T + MIN]);
    await moveSession('w', T);
    expect((await getSession('w'))?.startedAt).toBe(T + 37_000);
    expect((await db.sets.get('w-0'))?.completedAt).toBe(T + MIN);
  });

  it('refuses to move a workout so it starts in the future', async () => {
    await finished('w', T);
    await expect(moveSession('w', Date.now() + DAY)).rejects.toThrow(/future/i);
    expect((await getSession('w'))?.startedAt).toBe(T);
  });

  it('refuses to move a workout so it ends in the future, though it starts in the past', async () => {
    // The workout lasts 60 minutes, so starting it 10 minutes ago ends it 50
    // minutes from now. A check on the new start alone would let this through.
    await finished('w', T, [T + MIN]);
    const tenMinutesAgo = Math.floor((Date.now() - 10 * MIN) / MIN) * MIN;
    await expect(moveSession('w', tenMinutesAgo)).rejects.toThrow(/future/i);
    expect((await getSession('w'))?.startedAt).toBe(T);
    expect((await db.sets.get('w-0'))?.completedAt).toBe(T + MIN);
  });

  it.each([[NaN], [Infinity], [-Infinity]])('refuses %s as a start time and changes nothing', async (bad) => {
    // A cleared datetime-local input parses to NaN. NaN fails every comparison,
    // so neither guard below it would fire, and the workout and its sets would
    // all be written as NaN, which is not a valid index key.
    await finished('w', T, [T + MIN]);
    await expect(moveSession('w', bad)).rejects.toThrow(/invalid start time/i);
    const unchanged = await getSession('w');
    expect(unchanged?.startedAt).toBe(T);
    expect(unchanged?.endedAt).toBe(T + 60 * MIN);
    expect((await db.sets.get('w-0'))?.completedAt).toBe(T + MIN);
  });

  it('refuses the workout in progress', async () => {
    await db.sessions.add({ id: 'live', routineId: null, name: 'live', startedAt: T, status: 'in_progress' });
    await expect(moveSession('live', T - DAY)).rejects.toThrow();
    expect((await getSession('live'))?.startedAt).toBe(T);
  });

  it('rejects an unknown workout', async () => {
    await expect(moveSession('nope', T)).rejects.toThrow(/not found/i);
  });
});

describe('deleteCompletedSession', () => {
  it('deletes a finished workout and its sets, and nothing else', async () => {
    await finished('gone', T, [T + MIN]);
    await finished('kept', T + DAY, [T + DAY + MIN]);
    await deleteCompletedSession('gone');
    expect(await getSession('gone')).toBeUndefined();
    expect(await db.sets.where('sessionId').equals('gone').count()).toBe(0);
    expect(await db.sets.where('sessionId').equals('kept').count()).toBe(1);
  });

  it('refuses the workout in progress, which has Discard', async () => {
    await db.sessions.add({ id: 'live', routineId: null, name: 'live', startedAt: T, status: 'in_progress' });
    await expect(deleteCompletedSession('live')).rejects.toThrow();
    expect(await getSession('live')).toBeDefined();
  });

  it('leaves the rotation where it is', async () => {
    const a = await createRoutine('A');
    const b = await createRoutine('B');
    const cycle = await getOrCreateActiveCycle();
    await saveCycle({ ...cycle, routineIds: [a.id, b.id], currentIndex: 1 });
    // A routine that is in the rotation, so an un-advance keyed on the
    // session's routine would have something to act on.
    await finished('w', T, [], a.id);
    await deleteCompletedSession('w');
    expect((await getActiveCycle())?.currentIndex).toBe(1);
  });
});
