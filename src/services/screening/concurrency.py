# Derived from AlphaSift revision 9f522747caafd3c0b1ddb7e14d5cf44c8580b6cf.
# Licensed under Apache-2.0 and modified for daily_stock_analysis.
"""Concurrency helpers shared by the screening pipeline."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import FIRST_COMPLETED, Future, wait
from typing import TypeVar


T = TypeVar("T")


def iter_completed_with_cancellation(
    futures: Iterable[Future[T]],
    cancellation_check: Callable[[], None] | None,
    *,
    poll_interval_seconds: float = 0.1,
) -> Iterator[Future[T]]:
    """Yield completed futures while polling the caller's cancellation state."""
    pending = set(futures)
    while pending:
        if cancellation_check is not None:
            cancellation_check()
        completed, pending = wait(
            pending,
            timeout=max(0.01, float(poll_interval_seconds)),
            return_when=FIRST_COMPLETED,
        )
        if cancellation_check is not None:
            cancellation_check()
        yield from completed
