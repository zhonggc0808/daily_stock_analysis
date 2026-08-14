import { useCallback, useEffect, useRef } from 'react';
import type { TaskInfo } from '../types/analysis';
import { useTaskStream } from './useTaskStream';
import { useVisibilityAwarePolling } from './useVisibilityAwarePolling';

type UseDashboardLifecycleOptions = {
  loadInitialHistory: () => Promise<void>;
  refreshHistory: (silent?: boolean) => Promise<void>;
  refreshHistoryForCompletedTask?: (task: TaskInfo) => Promise<void>;
  refreshActiveTasks: () => Promise<void>;
  loadStockBar: () => Promise<void>;
  refreshStockBar: () => Promise<void>;
  loadMarketReviewHistory?: () => Promise<void>;
  refreshMarketReviewHistory?: (silent?: boolean) => Promise<void>;
  syncTaskCreated: (task: TaskInfo) => void;
  syncTaskUpdated: (task: TaskInfo) => void;
  syncTaskFailed: (task: TaskInfo) => void;
  removeTask: (taskId: string) => void;
  onDashboardDataRefresh?: () => void;
  onCompletedTaskDataRefreshStarted?: (task: TaskInfo) => void;
  onCompletedTaskDataRefreshed?: (task: TaskInfo) => void;
  enabled?: boolean;
};

export function useDashboardLifecycle({
  loadInitialHistory,
  refreshHistory,
  refreshHistoryForCompletedTask,
  refreshActiveTasks,
  loadStockBar,
  refreshStockBar,
  loadMarketReviewHistory,
  refreshMarketReviewHistory,
  syncTaskCreated,
  syncTaskUpdated,
  syncTaskFailed,
  removeTask,
  onDashboardDataRefresh,
  onCompletedTaskDataRefreshStarted,
  onCompletedTaskDataRefreshed,
  enabled = true,
}: UseDashboardLifecycleOptions): void {
  const removalTimeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void loadInitialHistory();
    void loadStockBar();
    void loadMarketReviewHistory?.();
    void refreshActiveTasks();
  }, [enabled, loadInitialHistory, loadMarketReviewHistory, loadStockBar, refreshActiveTasks]);

  const handlePeriodicRefresh = useCallback(async () => {
    onDashboardDataRefresh?.();
    await Promise.allSettled([
      refreshHistory(true),
      refreshStockBar(),
      refreshMarketReviewHistory?.(true),
      refreshActiveTasks(),
    ]);
  }, [onDashboardDataRefresh, refreshActiveTasks, refreshHistory, refreshMarketReviewHistory, refreshStockBar]);

  useVisibilityAwarePolling({
    callback: handlePeriodicRefresh,
    intervalMs: 30_000,
    enabled,
    hiddenBehavior: 'pause',
    immediate: false,
    syncOnVisible: true,
  });

  useEffect(() => {
    return () => {
      removalTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      removalTimeoutsRef.current = [];
    };
  }, []);

  const scheduleTaskRemoval = (taskId: string, delayMs: number) => {
    const timeoutId = window.setTimeout(() => {
      removeTask(taskId);
      removalTimeoutsRef.current = removalTimeoutsRef.current.filter((item) => item !== timeoutId);
    }, delayMs);

    removalTimeoutsRef.current.push(timeoutId);
  };

  useTaskStream({
    onTaskCreated: syncTaskCreated,
    onTaskStarted: syncTaskUpdated,
    onTaskProgress: syncTaskUpdated,
    onConnected: () => {
      void refreshActiveTasks();
    },
    onTaskCompleted: (task) => {
      syncTaskUpdated(task);
      onCompletedTaskDataRefreshStarted?.(task);
      const historyRefresh = refreshHistoryForCompletedTask
        ? refreshHistoryForCompletedTask(task)
        : refreshHistory(true);
      const stockBarRefresh = refreshStockBar();
      void Promise.allSettled([historyRefresh, stockBarRefresh]).then(() => {
        onCompletedTaskDataRefreshed?.(task);
      });
      void refreshMarketReviewHistory?.(true);
      scheduleTaskRemoval(task.taskId, 2_000);
    },
    onTaskFailed: (task) => {
      syncTaskFailed(task);
      scheduleTaskRemoval(task.taskId, 5_000);
    },
    onError: () => {
      console.warn('SSE connection disconnected, reconnecting...');
    },
    enabled,
  });
}

export default useDashboardLifecycle;
