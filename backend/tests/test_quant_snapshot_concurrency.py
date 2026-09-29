"""后台预热与即时筛选不会并行构建同一批全市场数据。"""
from concurrent.futures import ThreadPoolExecutor
import threading

import quant


def test_snapshot_builds_are_serialized(monkeypatch):
    entered = threading.Event()
    release = threading.Event()
    state_lock = threading.Lock()
    active = 0
    peak = 0

    def build():
        nonlocal active, peak
        with state_lock:
            active += 1
            peak = max(peak, active)
        entered.set()
        assert release.wait(2)
        with state_lock:
            active -= 1
        return {"trade_date": "2026-09-18"}

    monkeypatch.setattr(quant, "_build_rps_snapshot", build)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(quant.rps_snapshot)
        assert entered.wait(2)
        second = executor.submit(quant.rps_snapshot)
        release.set()
        assert first.result() == second.result()
    assert peak == 1


def test_prewarm_marks_running_before_thread_starts(monkeypatch):
    starts = []

    class DeferredThread:
        def __init__(self, **kwargs):
            pass

        def start(self):
            starts.append(True)

    monkeypatch.setattr(quant, "_RPS_PREWARM_STATE", {"running": False})
    monkeypatch.setattr(quant.threading, "Thread", DeferredThread)
    assert quant.trigger_rps_prewarm() is not None
    assert quant.trigger_rps_prewarm() is None
    assert starts == [True]
