import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useVisibilityAwarePolling } from '../useVisibilityAwarePolling';

describe('useVisibilityAwarePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('schedules next execution serially only after previous callback settles', async () => {
    let inFlight = false;
    let overlapDetected = false;
    let executionCount = 0;

    const callback = vi.fn().mockImplementation(async () => {
      if (inFlight) {
        overlapDetected = true;
      }
      inFlight = true;
      executionCount += 1;
      // Simulate slow async work (300ms)
      await new Promise((resolve) => setTimeout(resolve, 300));
      inFlight = false;
      return true;
    });

    renderHook(() =>
      useVisibilityAwarePolling({
        callback,
        intervalMs: 1000,
        immediate: true,
      })
    );

    // Immediate execution starts
    expect(callback).toHaveBeenCalledTimes(1);

    // Advance 100ms - still in-flight
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(overlapDetected).toBe(false);

    // Advance 250ms more - first completes at 300ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(executionCount).toBe(1);

    // Next timer is scheduled for 1000ms AFTER 300ms (i.e. at 1300ms total, 950ms after current 350ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(executionCount).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(executionCount).toBe(2);
    expect(overlapDetected).toBe(false);
  });

  it('pauses periodic polling when page is hidden and syncs immediately on visible', async () => {
    const callback = vi.fn().mockResolvedValue(true);

    renderHook(() =>
      useVisibilityAwarePolling({
        callback,
        intervalMs: 1000,
        immediate: false,
        hiddenBehavior: 'pause',
        syncOnVisible: true,
      })
    );

    expect(callback).toHaveBeenCalledTimes(0);

    // Advance 1000ms when visible -> first tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    // Switch to hidden
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Advance 5000ms while hidden -> no more periodic calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    // Switch back to visible -> triggers immediate sync
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(callback).toHaveBeenCalledTimes(2);

    // After return to visible, periodic scheduling resumes
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('aborts in-flight request on unmount and ignores abort error', async () => {
    let receivedSignal: AbortSignal | null = null;
    const onError = vi.fn();

    const callback = vi.fn().mockImplementation((signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<void>((_, reject) => {
        signal.addEventListener('abort', () => {
          const err = new DOMException('The user aborted a request.', 'AbortError');
          reject(err);
        });
      });
    });

    const { unmount } = renderHook(() =>
      useVisibilityAwarePolling({
        callback,
        intervalMs: 1000,
        immediate: true,
        onError,
      })
    );

    expect(receivedSignal).not.toBeNull();
    expect((receivedSignal as unknown as AbortSignal).aborted).toBe(false);

    // Unmount while request is in-flight
    act(() => {
      unmount();
    });

    expect((receivedSignal as unknown as AbortSignal).aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops polling when callback returns false', async () => {
    let callCount = 0;
    const callback = vi.fn().mockImplementation(async () => {
      callCount += 1;
      return callCount < 2; // false on second call
    });

    const { result } = renderHook(() =>
      useVisibilityAwarePolling({
        callback,
        intervalMs: 500,
        immediate: true,
      })
    );

    expect(callback).toHaveBeenCalledTimes(1);
    expect(result.current.isPolling).toBe(true);

    // Advance to 2nd tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(550);
    });
    expect(callback).toHaveBeenCalledTimes(2);
    expect(result.current.isPolling).toBe(false);

    // Further time should not trigger calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('restarts polling immediately after an explicit stop', async () => {
    const callback = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useVisibilityAwarePolling({
        callback,
        intervalMs: 1000,
        immediate: false,
      })
    );

    act(() => result.current.stop());
    expect(result.current.isPolling).toBe(false);

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isPolling).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not let a callback that ignores abort resurrect polling after disable', async () => {
    let settle: (() => void) | undefined;
    const callback = vi.fn().mockImplementation(() => new Promise<boolean>((resolve) => {
      settle = () => resolve(true);
    }));

    const { rerender } = renderHook(
      ({ enabled }) => useVisibilityAwarePolling({
        callback,
        intervalMs: 1000,
        immediate: true,
        enabled,
      }),
      { initialProps: { enabled: true } },
    );

    expect(callback).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });

    await act(async () => {
      settle?.();
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight request when the page becomes hidden', () => {
    let receivedSignal: AbortSignal | null = null;
    const callback = vi.fn().mockImplementation((signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<boolean>(() => undefined);
    });

    renderHook(() => useVisibilityAwarePolling({
      callback,
      intervalMs: 1000,
      immediate: true,
      hiddenBehavior: 'pause',
    }));

    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(receivedSignal).not.toBeNull();
    expect((receivedSignal as unknown as AbortSignal).aborted).toBe(true);
  });
});
