import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

export type VisibilityPollingHiddenBehavior = 'pause' | 'slow' | 'continue';

export type UseVisibilityAwarePollingOptions = {
  /** The async callback to execute. Return false or call stop() to end polling. */
  callback: (signal: AbortSignal) => Promise<boolean | void>;
  /** Polling interval in milliseconds when page is visible. */
  intervalMs: number;
  /** Whether polling is enabled. Defaults to true. */
  enabled?: boolean;
  /** Behavior when document is hidden: 'pause' (default), 'slow', or 'continue'. */
  hiddenBehavior?: VisibilityPollingHiddenBehavior;
  /** Slower interval in milliseconds when hiddenBehavior is 'slow'. Defaults to intervalMs * 4. */
  hiddenIntervalMs?: number;
  /** Whether to execute immediately on enable/mount. Defaults to false. */
  immediate?: boolean;
  /** Whether to immediately trigger a sync when page becomes visible after being hidden. Defaults to true. */
  syncOnVisible?: boolean;
  /** Optional error handler for non-abort errors. */
  onError?: (error: unknown) => void;
};

export type UseVisibilityAwarePollingReturn = {
  refresh: () => Promise<void>;
  stop: () => void;
  start: () => void;
  isPolling: boolean;
};

/**
 * Determines whether an error is caused by request abort/cancellation.
 */
export function isAbortOrCanceledError(error: unknown): boolean {
  if (!error) return false;
  if (axios.isCancel(error)) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (typeof error === 'object' && error !== null) {
    const err = error as { name?: string; code?: string; message?: string };
    if (err.name === 'AbortError' || err.name === 'CanceledError') return true;
    if (err.code === 'ERR_CANCELED') return true;
    if (err.message === 'canceled' || err.message === 'canceled by client') return true;
  }
  return false;
}

/**
 * A robust polling hook that guarantees serial execution (no overlapping requests),
 * pauses or slows down when page is hidden via Page Visibility API, immediately syncs
 * on return to foreground, and cleanly aborts in-flight requests on unmount or stop.
 */
export function useVisibilityAwarePolling({
  callback,
  intervalMs,
  enabled = true,
  hiddenBehavior = 'pause',
  hiddenIntervalMs,
  immediate = false,
  syncOnVisible = true,
  onError,
}: UseVisibilityAwarePollingOptions): UseVisibilityAwarePollingReturn {
  const [isPolling, setIsPolling] = useState(enabled);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const timerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const generationRef = useRef<number>(0);
  const manuallyStoppedRef = useRef<boolean>(false);
  const pendingExecutionRef = useRef<boolean>(false);
  const pendingManualExecutionRef = useRef<boolean>(false);

  const clearScheduledTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const abortInFlight = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    manuallyStoppedRef.current = true;
    pendingExecutionRef.current = false;
    pendingManualExecutionRef.current = false;
    clearScheduledTimer();
    abortInFlight();
    setIsPolling(false);
  }, [abortInFlight, clearScheduledTimer]);

  const executeTick = useCallback(
    async (isManualTrigger = false): Promise<void> => {
      if (!enabledRef.current || manuallyStoppedRef.current) {
        return;
      }

      if (inFlightRef.current) {
        pendingExecutionRef.current = true;
        pendingManualExecutionRef.current = pendingManualExecutionRef.current || isManualTrigger;
        return;
      }

      clearScheduledTimer();

      const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (!isManualTrigger && isHidden && hiddenBehavior === 'pause') {
        return;
      }

      const currentGen = ++generationRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      inFlightRef.current = true;

      let shouldContinue: boolean | void = true;
      let runQueuedExecution = false;
      let queuedExecutionIsManual = false;

      try {
        shouldContinue = await callbackRef.current(controller.signal);
      } catch (err: unknown) {
        if (!isAbortOrCanceledError(err)) {
          onErrorRef.current?.(err);
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        inFlightRef.current = false;

        const currentlyHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        if (
          pendingExecutionRef.current &&
          enabledRef.current &&
          !manuallyStoppedRef.current &&
          !(currentlyHidden && hiddenBehavior === 'pause')
        ) {
          runQueuedExecution = true;
          queuedExecutionIsManual = pendingManualExecutionRef.current;
          pendingExecutionRef.current = false;
          pendingManualExecutionRef.current = false;
        }
      }

      if (runQueuedExecution) {
        await executeTick(queuedExecutionIsManual);
        return;
      }

      if (currentGen !== generationRef.current || manuallyStoppedRef.current || !enabledRef.current) {
        return;
      }

      if (shouldContinue === false) {
        manuallyStoppedRef.current = true;
        setIsPolling(false);
        return;
      }

      // Determine next delay
      const currentlyHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (currentlyHidden && hiddenBehavior === 'pause') {
        return;
      }

      const nextDelay = currentlyHidden && hiddenBehavior === 'slow'
        ? (hiddenIntervalMs ?? intervalMs * 4)
        : intervalMs;

      timerRef.current = window.setTimeout(() => {
        void executeTick(false);
      }, nextDelay);
    },
    [clearScheduledTimer, hiddenBehavior, hiddenIntervalMs, intervalMs]
  );

  const refresh = useCallback(async () => {
    generationRef.current += 1;
    clearScheduledTimer();
    pendingExecutionRef.current = true;
    pendingManualExecutionRef.current = true;
    abortInFlight();
    if (!inFlightRef.current) {
      pendingExecutionRef.current = false;
      pendingManualExecutionRef.current = false;
      await executeTick(true);
    }
  }, [abortInFlight, clearScheduledTimer, executeTick]);

  const start = useCallback(() => {
    if (!enabledRef.current) {
      return;
    }
    generationRef.current += 1;
    manuallyStoppedRef.current = false;
    pendingExecutionRef.current = true;
    pendingManualExecutionRef.current = false;
    clearScheduledTimer();
    abortInFlight();
    setIsPolling(true);
    if (!inFlightRef.current) {
      pendingExecutionRef.current = false;
      void executeTick(false);
    }
  }, [abortInFlight, clearScheduledTimer, executeTick]);

  // Main lifecycle effect
  useEffect(() => {
    if (!enabled) {
      generationRef.current += 1;
      pendingExecutionRef.current = false;
      pendingManualExecutionRef.current = false;
      clearScheduledTimer();
      abortInFlight();
      setIsPolling(false);
      return undefined;
    }

    manuallyStoppedRef.current = false;
    setIsPolling(true);

    if (immediate) {
      void executeTick(false);
    } else {
      const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (!(isHidden && hiddenBehavior === 'pause')) {
        timerRef.current = window.setTimeout(() => {
          void executeTick(false);
        }, intervalMs);
      }
    }

    return () => {
      generationRef.current += 1;
      pendingExecutionRef.current = false;
      pendingManualExecutionRef.current = false;
      clearScheduledTimer();
      abortInFlight();
    };
  }, [abortInFlight, clearScheduledTimer, enabled, executeTick, hiddenBehavior, immediate, intervalMs]);

  // Visibility change listener
  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const handleVisibilityChange = () => {
      const isHidden = document.visibilityState === 'hidden';

      if (!isHidden) {
        if (enabledRef.current && !manuallyStoppedRef.current) {
          if (syncOnVisible) {
            void refresh();
          } else {
            clearScheduledTimer();
            timerRef.current = window.setTimeout(() => {
              void executeTick(false);
            }, intervalMs);
          }
        }
      } else {
        if (hiddenBehavior === 'pause') {
          generationRef.current += 1;
          pendingExecutionRef.current = false;
          pendingManualExecutionRef.current = false;
          clearScheduledTimer();
          abortInFlight();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [abortInFlight, clearScheduledTimer, executeTick, hiddenBehavior, intervalMs, refresh, syncOnVisible]);

  return {
    refresh,
    stop,
    start,
    isPolling,
  };
}

export default useVisibilityAwarePolling;
