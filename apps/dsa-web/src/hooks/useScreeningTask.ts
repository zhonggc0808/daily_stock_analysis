import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearPersistedScreeningResult,
  persistScreeningResult,
  screeningApi,
  type ScreeningScreenResponse,
  type ScreeningScreenTaskStatus,
} from '../api/screening';
import {
  formatParsedApiError,
  getParsedApiError,
  toApiErrorMessage,
  type ParsedApiError,
} from '../api/error';
import { useVisibilityAwarePolling } from './useVisibilityAwarePolling';
import { summarizeScreeningDiagnostic } from '../utils/screeningDiagnostic';

export const SCREEN_TASK_STORAGE_KEY = 'dsa.screening.activeScreenTask.v1';
export const SCREEN_TASK_POLL_INTERVAL_MS = 2000;

export type PersistedScreenTask = {
  taskId: string;
  market: string;
  strategy: string;
  maxResults: number;
};

export const readPersistedScreenTask = (): PersistedScreenTask | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(SCREEN_TASK_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedScreenTask>;
    if (typeof parsed.taskId !== 'string' || !parsed.taskId.trim()) {
      return null;
    }
    const restoredMaxResults = Number(parsed.maxResults);
    return {
      taskId: parsed.taskId,
      market: typeof parsed.market === 'string' && parsed.market.trim() ? parsed.market : 'cn',
      strategy: typeof parsed.strategy === 'string' && parsed.strategy.trim() ? parsed.strategy : 'dual_low',
      maxResults: Number.isFinite(restoredMaxResults) ? Math.min(100, Math.max(1, restoredMaxResults)) : 3,
    };
  } catch {
    return null;
  }
};

export const persistScreenTask = (task: PersistedScreenTask): void => {
  try {
    window.sessionStorage.setItem(SCREEN_TASK_STORAGE_KEY, JSON.stringify(task));
  } catch {
    // Session storage is best-effort
  }
};

export const clearPersistedScreenTask = (): void => {
  try {
    window.sessionStorage.removeItem(SCREEN_TASK_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures
  }
};

export const isRunningScreenTask = (status?: string | null): boolean => {
  if (!status) return false;
  return ['pending', 'processing', 'running', 'cancel_requested'].includes(status);
};

export const isUnrecoverableScreenTaskError = (error: ParsedApiError): boolean =>
  error.title === '选股任务不可恢复';

export const formatRecoverableScreenTaskPollingError = (error: ParsedApiError): string => {
  if (error.category === 'upstream_timeout') {
    return '选股任务仍在后台运行，状态轮询暂时超时，将自动重试。';
  }
  if (error.category === 'upstream_network' || error.category === 'local_connection_failed') {
    return '选股任务仍在后台运行，暂时无法连接本地服务获取状态，将自动重试。';
  }
  return formatParsedApiError(error) || '暂时无法获取选股任务状态，稍后将自动重试。';
};

export const formatScreenTaskFailure = (message?: string | null): string => {
  const normalized = message?.trim();
  if (!normalized) {
    return '选股任务失败，请稍后重试。';
  }
  return `选股任务失败：${summarizeScreeningDiagnostic(normalized)}`;
};

export type UseScreeningTaskOptions = {
  onCompleted?: (result: ScreeningScreenResponse) => void;
  onFailed?: (error: string) => void;
  onCancelled?: () => void;
};

export type UseScreeningTaskReturn = {
  activeTaskId: string | null;
  loading: boolean;
  cancelling: boolean;
  taskCancelled: boolean;
  taskProgress: number;
  taskMessage: string;
  error: string;
  setError: (error: string) => void;
  startTask: (payload: { market: string; strategy: string; maxResults: number }) => Promise<void>;
  cancelTask: () => Promise<void>;
  clearTask: () => void;
  resetTaskState: () => void;
};

export function useScreeningTask({
  onCompleted,
  onFailed,
  onCancelled,
}: UseScreeningTaskOptions = {}): UseScreeningTaskReturn {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(() => {
    const persisted = readPersistedScreenTask();
    return persisted ? persisted.taskId : null;
  });
  const [loading, setLoading] = useState<boolean>(() => readPersistedScreenTask() !== null);
  const [cancelling, setCancelling] = useState(false);
  const [taskCancelled, setTaskCancelled] = useState(false);
  const [taskProgress, setTaskProgress] = useState(0);
  const [taskMessage, setTaskMessage] = useState(() => (
    readPersistedScreenTask() !== null ? '正在恢复未完成的选股任务...' : ''
  ));
  const [error, setError] = useState('');

  const onCompletedRef = useRef(onCompleted);
  const onFailedRef = useRef(onFailed);
  const onCancelledRef = useRef(onCancelled);
  const currentTaskIdRef = useRef<string | null>(activeTaskId);
  const generationRef = useRef<number>(0);

  useEffect(() => {
    onCompletedRef.current = onCompleted;
    onFailedRef.current = onFailed;
    onCancelledRef.current = onCancelled;
    currentTaskIdRef.current = activeTaskId;
  }, [onCompleted, onFailed, onCancelled, activeTaskId]);

  const finishTask = useCallback(() => {
    generationRef.current += 1;
    currentTaskIdRef.current = null;
    clearPersistedScreenTask();
    setActiveTaskId(null);
    setLoading(false);
  }, []);

  const resetTaskState = useCallback(() => {
    generationRef.current += 1;
    currentTaskIdRef.current = null;
    clearPersistedScreenTask();
    setActiveTaskId(null);
    setLoading(false);
    setCancelling(false);
    setTaskCancelled(false);
    setTaskProgress(0);
    setTaskMessage('');
    setError('');
  }, []);

  const handleTaskStatus = useCallback((task: ScreeningScreenTaskStatus, expectedTaskId: string): boolean => {
    if (expectedTaskId !== currentTaskIdRef.current) {
      return false;
    }

    const nextProgress = Number(task.progress ?? 0);
    setTaskProgress(Number.isFinite(nextProgress) ? nextProgress : 0);
    setTaskMessage(task.message || '');

    if (task.status === 'completed') {
      if (task.result) {
        persistScreeningResult(task.result);
        setError('');
        onCompletedRef.current?.(task.result);
      } else {
        const errorMsg = '选股任务已完成，但服务端未返回候选结果。';
        setError(errorMsg);
        onFailedRef.current?.(errorMsg);
      }
      finishTask();
      return false;
    }

    if (task.status === 'failed') {
      const errorMsg = formatScreenTaskFailure(task.error || task.message);
      setError(errorMsg);
      onFailedRef.current?.(errorMsg);
      finishTask();
      return false;
    }

    if (task.status === 'cancelled') {
      setTaskCancelled(true);
      setCancelling(false);
      setTaskMessage(task.message || '选股任务已取消');
      setError('');
      onCancelledRef.current?.();
      finishTask();
      return false;
    }

    if (isRunningScreenTask(task.status)) {
      setCancelling(task.status === 'cancel_requested');
      setLoading(true);
      return true; // continue polling
    }

    setError(`选股任务返回未知状态：${task.status || 'unknown'}`);
    finishTask();
    return false;
  }, [finishTask]);

  const pollCallback = useCallback(async (signal: AbortSignal): Promise<boolean> => {
    const taskId = currentTaskIdRef.current;
    if (!taskId) {
      return false;
    }

    const expectedGeneration = generationRef.current;

    try {
      const task = await screeningApi.getScreenTask(taskId, { signal });
      if (expectedGeneration !== generationRef.current || taskId !== currentTaskIdRef.current) {
        return false;
      }
      return handleTaskStatus(task, taskId);
    } catch (err: unknown) {
      if (expectedGeneration !== generationRef.current || taskId !== currentTaskIdRef.current) {
        return false;
      }
      const parsedError = getParsedApiError(err);
      if (isUnrecoverableScreenTaskError(parsedError)) {
        const errorMsg = formatParsedApiError(parsedError) || '选股任务不可恢复，请重新提交。';
        setError(errorMsg);
        onFailedRef.current?.(errorMsg);
        finishTask();
        return false;
      }
      setError(formatRecoverableScreenTaskPollingError(parsedError));
      setLoading(true);
      return true; // continue polling on recoverable error
    }
  }, [finishTask, handleTaskStatus]);

  useVisibilityAwarePolling({
    callback: pollCallback,
    intervalMs: SCREEN_TASK_POLL_INTERVAL_MS,
    enabled: Boolean(activeTaskId),
    hiddenBehavior: 'pause',
    syncOnVisible: true,
    immediate: true,
  });

  const startTask = useCallback(async (payload: { market: string; strategy: string; maxResults: number }): Promise<void> => {
    const expectedGeneration = ++generationRef.current;
    setLoading(true);
    setCancelling(false);
    setTaskCancelled(false);
    setError('');
    setTaskProgress(0);
    setTaskMessage('正在提交选股任务...');

    try {
      const task = await screeningApi.startScreen(payload);
      if (expectedGeneration !== generationRef.current) {
        return;
      }
      persistScreenTask({
        taskId: task.taskId,
        market: payload.market,
        strategy: payload.strategy,
        maxResults: payload.maxResults,
      });
      clearPersistedScreeningResult();
      currentTaskIdRef.current = task.taskId;
      setActiveTaskId(task.taskId);
      setTaskProgress(0);
      setTaskMessage(task.message || '选股任务已提交');
    } catch (err: unknown) {
      finishTask();
      setError(toApiErrorMessage(err, '选股任务提交失败，请稍后重试。'));
      throw err;
    }
  }, [finishTask]);

  const cancelTask = useCallback(async (): Promise<void> => {
    const taskId = currentTaskIdRef.current;
    if (!taskId || cancelling) {
      return;
    }
    setCancelling(true);
    setError('');
    setTaskMessage('正在取消选股任务...');

    try {
      const task = await screeningApi.cancelScreenTask(taskId);
      if (taskId !== currentTaskIdRef.current) {
        return;
      }
      if (task.status === 'cancelled') {
        finishTask();
        setTaskCancelled(true);
        setTaskMessage(task.message || '选股任务已取消');
        setCancelling(false);
        onCancelledRef.current?.();
      }
    } catch (err: unknown) {
      setCancelling(false);
      setError(toApiErrorMessage(err, '取消选股失败，请稍后重试。'));
      throw err;
    }
  }, [cancelling, finishTask]);

  const clearTask = useCallback(() => {
    resetTaskState();
  }, [resetTaskState]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      currentTaskIdRef.current = null;
    };
  }, []);

  return {
    activeTaskId,
    loading,
    cancelling,
    taskCancelled,
    taskProgress,
    taskMessage,
    error,
    setError,
    startTask,
    cancelTask,
    clearTask,
    resetTaskState,
  };
}

export default useScreeningTask;
