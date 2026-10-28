import multiprocessing
import sys
from pathlib import Path

import pytest

from agent.provider_artifacts import _profile_file_lock, _windows_profile_file_lock


def _acquire_lock(lock_path, started, acquired):
    started.set()
    with _profile_file_lock(lock_path):
        acquired.set()


def test_profile_lock_blocks_a_second_process(tmp_path):
    context = multiprocessing.get_context("spawn")
    started = context.Event()
    acquired = context.Event()
    lock_path = tmp_path / ".store.lock"
    process = context.Process(target=_acquire_lock, args=(lock_path, started, acquired))

    with _profile_file_lock(lock_path):
        process.start()
        assert started.wait(5)
        assert not acquired.wait(0.2)

    process.join(5)
    assert process.exitcode == 0
    assert acquired.is_set()


def test_windows_lock_file_does_not_grow_after_repeated_acquisition(tmp_path, monkeypatch):
    class FakeWindowsLock:
        LK_NBLCK = 1
        LK_UNLCK = 2

        @staticmethod
        def locking(_fd, _mode, _size):
            pass

    import agent.provider_artifacts as artifacts

    monkeypatch.setitem(sys.modules, "msvcrt", FakeWindowsLock)
    monkeypatch.setattr(
        artifacts,
        "open",
        lambda path, mode: Path(path).open("x+b" if mode == "x+b" else "r+b"),
        raising=False,
    )
    lock_path = tmp_path / ".store.lock"

    with _windows_profile_file_lock(lock_path):
        pass
    initial_size = lock_path.stat().st_size
    with _windows_profile_file_lock(lock_path):
        pass

    assert initial_size == 1
    assert lock_path.stat().st_size == initial_size
