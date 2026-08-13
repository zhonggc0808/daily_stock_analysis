"""Process-wide, thread-reentrant concurrency limit for external I/O."""

import threading
from contextlib import contextmanager
from typing import Iterator


_lock = threading.Lock()
_limit = 6
_semaphore = threading.BoundedSemaphore(_limit)
_local = threading.local()


def configure_external_io_limit(limit: int) -> None:
    """Configure the process limit before analysis work is submitted."""
    global _limit, _semaphore
    normalized = max(1, int(limit))
    with _lock:
        if normalized == _limit:
            return
        _limit = normalized
        _semaphore = threading.BoundedSemaphore(normalized)


@contextmanager
def external_io_slot() -> Iterator[None]:
    """Acquire one slot, allowing nested provider calls in the same thread."""
    depth = int(getattr(_local, "depth", 0))
    if depth > 0:
        _local.depth = depth + 1
        try:
            yield
        finally:
            _local.depth -= 1
        return

    semaphore = _semaphore
    semaphore.acquire()
    _local.depth = 1
    try:
        yield
    finally:
        _local.depth = 0
        semaphore.release()
