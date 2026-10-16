"""Phase 2: AX tree fingerprint + incremental diff."""

from __future__ import annotations

import json

from tools.computer_use.ax_diff import (
    ElementFp,
    diff_trees,
    fingerprint_elements,
    format_tree_diff,
)
from tools.computer_use.backend import CaptureResult, UIElement


def test_diff_detects_added_removed_changed():
    prev = [
        ElementFp(0, "AXWindow", "Doc"),
        ElementFp(1, "AXTextArea", "hello", "s1:1"),
        ElementFp(2, "AXButton", "Save", "s1:2"),
    ]
    curr = [
        ElementFp(0, "AXWindow", "Doc", "s2:0"),  # new snapshot token — still unchanged slot
        ElementFp(1, "AXTextArea", "hello world", "s2:1"),  # label change at same index+role
        ElementFp(2, "AXButton", "Save", "s2:2"),
        ElementFp(3, "AXButton", "Extra", "s2:3"),  # added
    ]
    d = diff_trees(prev, curr)
    assert d.unchanged == 2  # window + Save
    assert len(d.changed) == 1 and d.changed[0][1].label == "hello world"
    assert len(d.added) == 1 and d.added[0].label == "Extra"
    assert d.removed == []


def test_format_unchanged():
    d = diff_trees(
        [ElementFp(1, "AXButton", "OK")],
        [ElementFp(1, "AXButton", "OK")],
    )
    assert d.empty
    assert "unchanged" in format_tree_diff(d)


def test_fingerprint_from_uielement():
    els = [
        UIElement(index=3, role="AXButton", label="Go", element_token="s9:3"),
    ]
    fps = fingerprint_elements(els)
    assert fps[0] == ElementFp(3, "AXButton", "Go", "s9:3")


def test_capture_ax_second_call_is_diff_first(monkeypatch):
    """Second ax capture of the same window leads summary with tree_diff, not full dump."""
    from tools.computer_use import tool as cu_tool

    cu_tool.reset_backend_for_tests()

    elements_a = [
        UIElement(index=0, role="AXWindow", label="Win", element_token="s1:0"),
        UIElement(index=1, role="AXTextArea", label="A", element_token="s1:1"),
        UIElement(index=2, role="AXButton", label="OK", element_token="s1:2"),
    ]
    elements_b = [
        UIElement(index=0, role="AXWindow", label="Win", element_token="s2:0"),
        UIElement(index=1, role="AXTextArea", label="B", element_token="s2:1"),
        UIElement(index=2, role="AXButton", label="OK", element_token="s2:2"),
        UIElement(index=3, role="AXButton", label="Extra", element_token="s2:3"),
    ]

    class FakeBackend:
        def __init__(self):
            self._active_window_id = 99
            self._n = 0

        def start(self): pass
        def stop(self): pass
        def is_available(self): return True

        def capture(self, mode="som", app=None, pid=None, window_id=None):
            self._n += 1
            els = elements_a if self._n == 1 else elements_b
            return CaptureResult(mode=mode, width=100, height=100, elements=els,
                                 app="TextEdit", window_title="Untitled")

    fake = FakeBackend()
    monkeypatch.setattr(cu_tool, "_get_backend", lambda session_id="": fake)
    monkeypatch.setattr(cu_tool, "privilege_blocks_mutate", lambda *a, **k: None)
    monkeypatch.setattr(cu_tool, "_require_fresh_capture", lambda *a, **k: None)

    r1 = json.loads(cu_tool.handle_computer_use(
        {"action": "capture", "mode": "ax"}, session_id="axdiff-1"))
    assert "tree_diff" not in r1
    assert "#0" in r1["summary"] or "AXWindow" in r1["summary"]

    r2 = json.loads(cu_tool.handle_computer_use(
        {"action": "capture", "mode": "ax"}, session_id="axdiff-1"))
    assert "tree_diff" in r2
    assert r2["tree_diff"]["added"] >= 1 or r2["tree_diff"]["changed"] >= 1
    assert "tree_diff:" in r2["summary"]
    assert "full_tree=true" in r2["summary"]
    # elements array still present for click indices
    assert len(r2["elements"]) == 4

    r3 = json.loads(cu_tool.handle_computer_use(
        {"action": "capture", "mode": "ax", "full_tree": True}, session_id="axdiff-1"))
    assert "tree_diff:" in r3["summary"]
    # full_tree expands element lines again
    assert "AXTextArea" in r3["summary"] or "AXButton" in r3["summary"]
