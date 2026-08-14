import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { persistScreeningResult, screeningApi, type ScreeningCandidate, type ScreeningScreenTaskStatus } from '../../api/screening';
import {
  clearPersistedScreenTask,
  formatScreenTaskFailure,
  persistScreenTask,
  readPersistedScreenTask,
  useScreeningTask,
} from '../useScreeningTask';

vi.mock('../../api/screening', () => ({
  screeningApi: {
    startScreen: vi.fn(),
    getScreenTask: vi.fn(),
    cancelScreenTask: vi.fn(),
  },
  persistScreeningResult: vi.fn(),
  clearPersistedScreeningResult: vi.fn(),
}));

describe('useScreeningTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPersistedScreenTask();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('restores persisted task on mount and starts polling', async () => {
    persistScreenTask({
      taskId: 'task-restored-1',
      market: 'cn',
      strategy: 'dual_low',
      maxResults: 5,
    });

    vi.mocked(screeningApi.getScreenTask).mockResolvedValueOnce({
      taskId: 'task-restored-1',
      status: 'completed',
      progress: 100,
      message: 'Done',
      result: {
        enabled: true,
        candidateCount: 1,
        candidates: [{ rank: 1, code: '600519', name: '贵州茅台', reason: 'Test' } as unknown as ScreeningCandidate],
      },
    });

    const onCompleted = vi.fn();

    const { result } = renderHook(() =>
      useScreeningTask({ onCompleted })
    );

    expect(result.current.activeTaskId).toBe('task-restored-1');
    expect(result.current.loading).toBe(true);

    // Let polling run
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(screeningApi.getScreenTask).toHaveBeenCalledWith('task-restored-1', expect.anything());
    expect(onCompleted).toHaveBeenCalled();
    expect(result.current.activeTaskId).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(readPersistedScreenTask()).toBeNull();
  });

  it('starts a new task and polls until completed', async () => {
    vi.mocked(screeningApi.startScreen).mockResolvedValueOnce({
      taskId: 'task-new-123',
      status: 'pending',
      message: 'Started',
      strategy: 'dual_low',
      market: 'cn',
      maxResults: 3,
    });

    vi.mocked(screeningApi.getScreenTask)
      .mockResolvedValueOnce({
        taskId: 'task-new-123',
        status: 'processing',
        progress: 45,
        message: 'Scanning...',
      })
      .mockResolvedValueOnce({
        taskId: 'task-new-123',
        status: 'completed',
        progress: 100,
        message: 'Done',
        result: {
          enabled: true,
          candidateCount: 2,
          candidates: [] as ScreeningCandidate[],
        },
      });

    const onCompleted = vi.fn();

    const { result } = renderHook(() =>
      useScreeningTask({ onCompleted })
    );

    expect(result.current.activeTaskId).toBeNull();

    await act(async () => {
      await result.current.startTask({ market: 'cn', strategy: 'dual_low', maxResults: 3 });
    });

    expect(result.current.activeTaskId).toBe('task-new-123');
    expect(result.current.loading).toBe(true);

    // 1st poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(result.current.taskProgress).toBe(45);
    expect(result.current.taskMessage).toBe('Scanning...');

    // 2nd poll (after interval)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    expect(onCompleted).toHaveBeenCalled();
    expect(result.current.activeTaskId).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('cancels active task cleanly', async () => {
    vi.mocked(screeningApi.startScreen).mockResolvedValueOnce({
      taskId: 'task-to-cancel',
      status: 'processing',
      message: 'Started',
      strategy: 'dual_low',
      market: 'cn',
      maxResults: 3,
    });

    vi.mocked(screeningApi.cancelScreenTask).mockResolvedValueOnce({
      taskId: 'task-to-cancel',
      status: 'cancelled',
      message: 'Cancelled by user',
    });

    const onCancelled = vi.fn();

    const { result } = renderHook(() =>
      useScreeningTask({ onCancelled })
    );

    await act(async () => {
      await result.current.startTask({ market: 'cn', strategy: 'dual_low', maxResults: 3 });
    });

    expect(result.current.activeTaskId).toBe('task-to-cancel');

    await act(async () => {
      await result.current.cancelTask();
    });

    expect(onCancelled).toHaveBeenCalled();
    expect(result.current.activeTaskId).toBeNull();
    expect(result.current.taskCancelled).toBe(true);
    expect(readPersistedScreenTask()).toBeNull();
  });

  it('ignores a late completed poll after cancellation wins the race', async () => {
    let resolvePoll: ((task: ScreeningScreenTaskStatus) => void) | undefined;
    vi.mocked(screeningApi.startScreen).mockResolvedValueOnce({
      taskId: 'task-race',
      status: 'processing',
      message: 'Started',
      strategy: 'dual_low',
      market: 'cn',
      maxResults: 3,
    });
    vi.mocked(screeningApi.getScreenTask).mockImplementationOnce(() => new Promise((resolve) => {
      resolvePoll = resolve;
    }));
    vi.mocked(screeningApi.cancelScreenTask).mockResolvedValueOnce({
      taskId: 'task-race',
      status: 'cancelled',
      message: 'Cancelled by user',
    });

    const onCompleted = vi.fn();
    const onCancelled = vi.fn();
    const { result } = renderHook(() => useScreeningTask({ onCompleted, onCancelled }));

    await act(async () => {
      await result.current.startTask({ market: 'cn', strategy: 'dual_low', maxResults: 3 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screeningApi.getScreenTask).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.cancelTask();
    });

    await act(async () => {
      resolvePoll?.({
        taskId: 'task-race',
        status: 'completed',
        result: { enabled: true, candidateCount: 0, candidates: [] },
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(onCompleted).not.toHaveBeenCalled();
    expect(persistScreeningResult).not.toHaveBeenCalled();
  });

  it('summarizes internal task failures before displaying them', () => {
    expect(formatScreenTaskFailure('https://provider.invalid timed out')).toBe('选股任务失败：请求超时');
  });
});
