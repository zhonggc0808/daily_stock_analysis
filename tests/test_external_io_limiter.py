import threading
import time
from concurrent.futures import ThreadPoolExecutor

from src.services.external_io_limiter import (
    configure_external_io_limit,
    external_io_slot,
)


def test_external_io_limit_is_bounded_and_thread_reentrant() -> None:
    configure_external_io_limit(2)
    active = 0
    peak = 0
    lock = threading.Lock()

    def work() -> None:
        nonlocal active, peak
        with external_io_slot():
            with external_io_slot():
                with lock:
                    active += 1
                    peak = max(peak, active)
                time.sleep(0.03)
                with lock:
                    active -= 1

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(work) for _ in range(5)]
        for future in futures:
            future.result(timeout=1)

    assert peak == 2
    configure_external_io_limit(6)
