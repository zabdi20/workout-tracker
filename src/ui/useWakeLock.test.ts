import { renderHook } from '@testing-library/react';
import { useWakeLock } from './useWakeLock';

function stubWakeLock() {
  const listeners: Array<() => void> = [];
  const sentinel = {
    release: vi.fn(async () => {}),
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'release') listeners.push(handler);
    }),
  };
  const request = vi.fn(async () => sentinel);
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
  });
  /** Fire the browser's own release, which iOS does whenever the page hides. */
  const fireRelease = () => listeners.forEach((h) => h());
  return { sentinel, request, fireRelease };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
});

it('acquires a lock when the condition turns true', async () => {
  const { request } = stubWakeLock();
  const { rerender } = renderHook(({ hold }) => useWakeLock(hold), {
    initialProps: { hold: false },
  });
  expect(request).not.toHaveBeenCalled();

  rerender({ hold: true });
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
});

it('releases when the condition turns false', async () => {
  const { sentinel } = stubWakeLock();
  const { rerender } = renderHook(({ hold }) => useWakeLock(hold), {
    initialProps: { hold: true },
  });
  await vi.waitFor(() => expect(sentinel.addEventListener).toHaveBeenCalled());

  rerender({ hold: false });
  await vi.waitFor(() => expect(sentinel.release).toHaveBeenCalled());
});

it('releases on unmount, so a lock cannot outlive the screen', async () => {
  const { sentinel } = stubWakeLock();
  const { unmount } = renderHook(() => useWakeLock(true));
  await vi.waitFor(() => expect(sentinel.addEventListener).toHaveBeenCalled());

  unmount();
  await vi.waitFor(() => expect(sentinel.release).toHaveBeenCalled());
});

it('does not request the lock again while the boolean prop is unchanged', async () => {
  // This pins React's own dependency-array behavior, not an internal dedup
  // guard: the effect only reruns when `shouldHold` changes (Object.is), so
  // rerendering with the same `true` value never re-invokes acquire(). The
  // hook has no ref-based "already holding one" check — see useWakeLock.ts
  // for why one would be unreachable dead code.
  const { request } = stubWakeLock();
  const { rerender } = renderHook(({ hold }) => useWakeLock(hold), {
    initialProps: { hold: true },
  });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

  rerender({ hold: true });
  rerender({ hold: true });
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not re-release a lock the browser already released', async () => {
  // iOS drops the lock on its own whenever the document hides. The 'release'
  // listener clears the stored sentinel so that when the condition later
  // turns false, cleanup does not call release() again on a sentinel the
  // browser has already let go of.
  const { request, sentinel, fireRelease } = stubWakeLock();
  const { rerender } = renderHook(({ hold }) => useWakeLock(hold), {
    initialProps: { hold: true },
  });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

  fireRelease();
  rerender({ hold: false });

  expect(sentinel.release).not.toHaveBeenCalled();
});

it('does nothing when the browser has no Wake Lock API', () => {
  // jsdom has none. A missing lock means the screen sleeps normally, which is
  // not worth surfacing to someone mid-set.
  expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
});

it('survives a rejected request', async () => {
  // The API rejects when the document is not visible.
  const request = vi.fn(async () => {
    throw new Error('not allowed');
  });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
});
