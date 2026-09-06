import type { RestTimerRecord } from '../../domain/restTimer';
import {
  clearRestTimer,
  readRestTimer,
  writeRestTimer,
  REST_TIMER_KEY,
} from './restTimerStore';

const stored: RestTimerRecord = {
  sessionId: 's1',
  endsAt: 1_700_000_090_000,
  restSeconds: 90,
  firedAt: null,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it('round-trips a record', () => {
  writeRestTimer(stored);
  expect(readRestTimer('s1')).toEqual(stored);
});

it('reports no timer when nothing was written', () => {
  expect(readRestTimer('s1')).toBeNull();
});

it('clears a record on request', () => {
  writeRestTimer(stored);
  clearRestTimer();
  expect(readRestTimer('s1')).toBeNull();
});

it('refuses a record left behind by another session, and clears it', () => {
  writeRestTimer(stored);
  expect(readRestTimer('another-session')).toBeNull();
  // Cleared rather than merely ignored: left in place, it would be adopted
  // the moment a session with the matching id came back into view.
  expect(localStorage.getItem(REST_TIMER_KEY)).toBeNull();
});

it('discards a corrupt entry rather than parsing NaN into the countdown', () => {
  localStorage.setItem(REST_TIMER_KEY, '{not json');
  expect(readRestTimer('s1')).toBeNull();
  expect(localStorage.getItem(REST_TIMER_KEY)).toBeNull();
});

it('discards an entry that parses but is the wrong shape', () => {
  // Written by an older build, or by something else on the origin. Adopting
  // it would render "Rest NaN:NaN".
  localStorage.setItem(REST_TIMER_KEY, JSON.stringify({ sessionId: 's1', endsAt: 'soon' }));
  expect(readRestTimer('s1')).toBeNull();
  expect(localStorage.getItem(REST_TIMER_KEY)).toBeNull();
});

it('accepts a record that has already fired', () => {
  const fired = { ...stored, firedAt: 1_700_000_090_000 };
  writeRestTimer(fired);
  expect(readRestTimer('s1')).toEqual(fired);
});

it('reports no timer when localStorage itself throws', () => {
  // Safari in private browsing. A session screen that will not render is a
  // far worse outcome than a lost countdown.
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('access denied');
  });
  expect(() => readRestTimer('s1')).not.toThrow();
  expect(readRestTimer('s1')).toBeNull();
});

it('does not throw when a write is refused', () => {
  // Never fail a set log over a countdown that could not be persisted.
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota exceeded');
  });
  expect(() => writeRestTimer(stored)).not.toThrow();
});

it('does not throw when a clear is refused', () => {
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('access denied');
  });
  expect(() => clearRestTimer()).not.toThrow();
});
