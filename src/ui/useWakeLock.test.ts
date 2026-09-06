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

it('does not acquire a second lock while it already holds one', async () => {
  const { request } = stubWakeLock();
  const { rerender } = renderHook(({ hold }) => useWakeLock(hold), {
    initialProps: { hold: true },
  });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

  rerender({ hold: true });
  rerender({ hold: true });
  expect(request).toHaveBeenCalledTimes(1);
});

it('can acquire again after the browser released the lock itself', async () => {
  // iOS drops the lock whenever the document hides and never restores it.
  // Without clearing the stored sentinel, the next acquire would be skipped
  // because the hook still believed it held one.
  const { request, fireRelease } = stubWakeLock();
  const { rerender } = renderHook(({ hold }) => useWakeLock(hold), {
    initialProps: { hold: true },
  });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

  fireRelease();
  rerender({ hold: false });
  rerender({ hold: true });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
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
