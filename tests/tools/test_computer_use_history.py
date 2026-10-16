"""Phase 3: opt-in Computer Use session history (privacy default OFF)."""

from __future__ import annotations

import json

from tools.computer_use import history as cu_history
from tools.computer_use.backend import CaptureResult, UIElement


def test_history_default_off(monkeypatch):
    monkeypatch.setattr(cu_history, "_computer_use_cfg", lambda: {})
    cu_history.clear_all_history()
    assert cu_history.history_enabled() is False
    out = cu_history.summarize_history("s1")
    assert out["enabled"] is False
    assert "OFF" in out["summary"]


def test_record_and_summarize_when_enabled(monkeypatch):
    monkeypatch.setattr(cu_history, "_computer_use_cfg", lambda: {
        "history_enabled": True, "history_max_events": 50, "history_persist": False,
    })
    cu_history.clear_all_history()
    cu_history.record_event("sid", "capture", {"action": "capture", "mode": "ax", "app": "TextEdit"},
                            {"mode": "ax", "total_elements": 3})
    cu_history.record_event("sid", "set_value", {"action": "set_value", "element": 1, "value": "hi"},
                            {"ok": True, "message": "set"})
    out = cu_history.summarize_history("sid")
    assert out["enabled"] is True
    assert out["count"] == 2
    assert "set_value" in out["summary"]
    assert "capture" in out["summary"]


def test_long_text_redacted(monkeypatch):
    monkeypatch.setattr(cu_history, "_computer_use_cfg", lambda: {"history_enabled": True})
    cu_history.clear_all_history()
    long = "x" * 100
    cu_history.record_event("s", "type", {"text": long}, {"ok": True})
    ev = cu_history.list_events("s")[0]
    assert ev["args"]["text_len"] == 100
    assert len(ev["args"]["text"]) < 50


def test_handle_history_action_no_backend(monkeypatch):
    from tools.computer_use import tool as cu_tool

    monkeypatch.setattr(cu_history, "_computer_use_cfg", lambda: {"history_enabled": True})
    cu_tool.reset_backend_for_tests()
    # Should not call _get_backend
    monkeypatch.setattr(cu_tool, "_get_backend", lambda **k: (_ for _ in ()).throw(RuntimeError("no backend")))
    cu_history.clear_all_history()
    cu_history.record_event("h1", "click", {"element": 2}, {"ok": True})
    out = json.loads(cu_tool.handle_computer_use({"action": "history"}, session_id="h1"))
    assert out["enabled"] is True
    assert out["count"] >= 1


def test_tool_records_when_enabled(monkeypatch):
    from tools.computer_use import tool as cu_tool

    monkeypatch.setattr(cu_history, "_computer_use_cfg", lambda: {"history_enabled": True})
    cu_tool.reset_backend_for_tests()

    class FakeBackend:
        def start(self): pass
        def stop(self): pass
        def is_available(self): return True
        def capture(self, mode="som", app=None, pid=None, window_id=None):
            return CaptureResult(
                mode=mode, width=10, height=10,
                elements=[UIElement(index=1, role="AXButton", label="OK")],
                app=app or "Demo", window_title="Win")

    fake = FakeBackend()
    monkeypatch.setattr(cu_tool, "_get_backend", lambda session_id="": fake)
    monkeypatch.setattr(cu_tool, "privilege_blocks_mutate", lambda *a, **k: None)
    monkeypatch.setattr(cu_tool, "_require_fresh_capture", lambda *a, **k: None)
    cu_history.clear_all_history()
    json.loads(cu_tool.handle_computer_use({"action": "capture", "mode": "ax"}, session_id="rec1"))
    out = cu_history.summarize_history("rec1")
    assert out["count"] >= 1
    assert any(e.get("action") == "capture" for e in out["events"])
