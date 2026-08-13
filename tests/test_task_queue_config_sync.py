# -*- coding: utf-8 -*-
"""Unit tests for task queue MAX_WORKERS runtime synchronization."""

from __future__ import annotations

import sys
import threading
import time
import types
import unittest
from types import SimpleNamespace
from unittest.mock import patch

# Keep task_queue import lightweight in environments without optional deps,
# but restore sys.modules immediately to avoid cross-test pollution.
_orig_data_provider_base = sys.modules.get("data_provider.base")
_orig_data_provider = sys.modules.get("data_provider")

if _orig_data_provider_base is None:
    base_mod = types.ModuleType("data_provider.base")
    base_mod.canonical_stock_code = lambda x: (x or "").strip().upper()
    base_mod.normalize_stock_code = lambda x: (x or "").strip().upper().removesuffix(".SH").removesuffix(".SZ")
    sys.modules["data_provider.base"] = base_mod

if _orig_data_provider is None:
    pkg_mod = types.ModuleType("data_provider")
    pkg_mod.base = sys.modules["data_provider.base"]
    sys.modules["data_provider"] = pkg_mod

from src.services.task_queue import AnalysisTaskQueue, TaskStatus, get_task_queue, _dedupe_stock_code_key

if _orig_data_provider_base is None:
    sys.modules.pop("data_provider.base", None)
else:
    sys.modules["data_provider.base"] = _orig_data_provider_base

if _orig_data_provider is None:
    sys.modules.pop("data_provider", None)
else:
    sys.modules["data_provider"] = _orig_data_provider


class TaskQueueConfigSyncTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._original_instance = AnalysisTaskQueue._instance
        AnalysisTaskQueue._instance = None

    def tearDown(self) -> None:
        queue = AnalysisTaskQueue._instance
        if queue is not None and queue is not self._original_instance:
            executor = getattr(queue, "_executor", None)
            if executor is not None and hasattr(executor, "shutdown"):
                executor.shutdown(wait=False)
        AnalysisTaskQueue._instance = self._original_instance

    def test_sync_max_workers_applies_when_idle(self) -> None:
        queue = AnalysisTaskQueue(max_workers=3)
        shutdown_wait_args = []

        class ExecutorStub:
            def shutdown(self, wait=True, cancel_futures=False):
                shutdown_wait_args.append(wait)

        queue._executor = ExecutorStub()

        result = queue.sync_max_workers(1)
        self.assertEqual(result, "applied")
        self.assertEqual(queue.max_workers, 1)
        self.assertIsNone(queue._executor)
        self.assertEqual(shutdown_wait_args, [False])

    def test_sync_max_workers_deferred_when_busy(self) -> None:
        queue = AnalysisTaskQueue(max_workers=3)
        queue._analyzing_stocks["600519"] = "task1"

        result = queue.sync_max_workers(1)
        self.assertEqual(result, "deferred_busy")
        self.assertEqual(queue.max_workers, 3)

    def test_get_task_queue_uses_runtime_configured_max_workers(self) -> None:
        with patch("src.config.get_config", return_value=SimpleNamespace(max_workers=1)):
            queue = get_task_queue()

        self.assertEqual(queue.max_workers, 1)

    def test_get_task_queue_keeps_singleton_identity_after_sync(self) -> None:
        with patch("src.config.get_config", return_value=SimpleNamespace(max_workers=3)):
            first = get_task_queue()
        with patch("src.config.get_config", return_value=SimpleNamespace(max_workers=1)):
            second = get_task_queue()

        self.assertIs(first, second)
        self.assertEqual(second.max_workers, 1)

    def test_get_task_queue_supports_string_max_workers(self) -> None:
        with patch("src.config.get_config", return_value=SimpleNamespace(max_workers="2")):
            queue = get_task_queue()

        self.assertEqual(queue.max_workers, 2)

    def test_dedupe_stock_code_key_normalizes_market_suffix(self) -> None:
        self.assertEqual(_dedupe_stock_code_key(" 600519.sh "), "600519")

    def test_get_task_queue_defers_sync_when_busy(self) -> None:
        queue = AnalysisTaskQueue(max_workers=3)
        queue._analyzing_stocks["600519"] = "task1"

        with patch("src.config.get_config", return_value=SimpleNamespace(max_workers=1)):
            synced = get_task_queue()

        self.assertIs(synced, queue)
        self.assertEqual(synced.max_workers, 3)

    def test_running_background_task_finishes_as_cancelled_after_return(self) -> None:
        queue = AnalysisTaskQueue(max_workers=1)
        started = threading.Event()
        release = threading.Event()

        def run_task():
            started.set()
            self.assertTrue(release.wait(timeout=2))
            return {"candidate_count": 1}

        task = queue.submit_background_task(
            run_task,
            stock_code="screening_screen",
            report_type="screening_screen",
        )
        self.assertTrue(started.wait(timeout=2))

        cancelling = queue.cancel_task(task.task_id)
        self.assertIsNotNone(cancelling)
        self.assertEqual(cancelling.status, TaskStatus.CANCEL_REQUESTED)
        self.assertTrue(queue.is_cancellation_requested(task.task_id))
        release.set()

        deadline = time.monotonic() + 2
        final = queue.get_task(task.task_id)
        while final is not None and final.status != TaskStatus.CANCELLED and time.monotonic() < deadline:
            time.sleep(0.01)
            final = queue.get_task(task.task_id)

        self.assertIsNotNone(final)
        self.assertEqual(final.status, TaskStatus.CANCELLED)
        self.assertIsNone(final.result)

    def test_running_background_task_finishes_as_cancelled_after_error(self) -> None:
        queue = AnalysisTaskQueue(max_workers=1)
        started = threading.Event()
        release = threading.Event()

        def run_task():
            started.set()
            self.assertTrue(release.wait(timeout=2))
            raise RuntimeError("cancel checkpoint")

        task = queue.submit_background_task(
            run_task,
            stock_code="screening_screen",
            report_type="screening_screen",
        )
        self.assertTrue(started.wait(timeout=2))
        queue.cancel_task(task.task_id)
        release.set()

        deadline = time.monotonic() + 2
        final = queue.get_task(task.task_id)
        while final is not None and final.status != TaskStatus.CANCELLED and time.monotonic() < deadline:
            time.sleep(0.01)
            final = queue.get_task(task.task_id)

        self.assertIsNotNone(final)
        self.assertEqual(final.status, TaskStatus.CANCELLED)
        self.assertIsNone(final.error)


if __name__ == "__main__":
    unittest.main()
