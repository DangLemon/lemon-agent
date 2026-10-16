"""Privilege mode + fresh-capture ritual for computer_use (Phase 1 / 1b)."""

from __future__ import annotations

import json
import threading
import time

import pytest


def _install_backend(cu_tool, *, app_sticky: str = "TextEdit", session_id: str = "", fresh: bool = True):
    class _RecordingBackend:
        def __init__(self):
            self.calls = []
            self._last_app = app_sticky

        def start(self):
            pass

        def stop(self):
            pass

        def is_available(self):
            return True

        def click(self, **kw):
            self.calls.append(("click", kw))
            from tools.computer_use.backend import ActionResult

            return ActionResult(ok=True, action="click")

        def type_text(self, text, **kw):
            self.calls.append(("type", text, kw))
            from tools.computer_use.backend import ActionResult

            return ActionResult(ok=True, action="type")

        def capture(self, mode="som", app=None, **kw):
            self.calls.append(("capture", mode, app))
            from tools.computer_use.backend import CaptureResult

            return CaptureResult(
                mode=mode, width=1, height=1, png_b64=None, elements=[],
                app=app or app_sticky, window_title="",
            )

        def list_apps(self):
            return [{"name": "TextEdit"}, {"name": "Safari"}]

    backend = _RecordingBackend()
    cu_tool.reset_backend_for_tests()
    sid = str(session_id or "")
    cu_tool._backends[sid] = backend
    cu_tool._backend_permission_modes[sid] = "standard"
    cu_tool._backend_call_locks[sid] = threading.RLock()
    if sid == "":
        cu_tool._backend = backend
    if fresh:
        cu_tool.mark_capture_fresh(sid, app_sticky)
    return backend


def _payload(result):
    return json.loads(result) if isinstance(result, str) else result


@pytest.fixture
def cu_tool():
    from tools.computer_use import tool as cu_tool

    cu_tool.reset_backend_for_tests()
    cu_tool.set_approval_callback(None)
    yield cu_tool
    cu_tool.set_approval_callback(None)
    cu_tool.reset_backend_for_tests()


def test_capture_only_blocks_click_allows_capture(cu_tool, monkeypatch):
    monkeypatch.setattr(
        "tools.computer_use.privilege._computer_use_cfg",
        lambda: {"privilege_mode": "capture_only", "require_fresh_capture": False},
    )
    backend = _install_backend(cu_tool, session_id="priv-co", fresh=False)
    blocked = _payload(cu_tool.handle_computer_use(
        {"action": "click", "element": 1}, session_id="priv-co"))
    assert blocked.get("code") == "privilege_capture_only"
    assert backend.calls == []

    ok = _payload(cu_tool.handle_computer_use(
        {"action": "capture", "mode": "som", "app": "TextEdit"}, session_id="priv-co"))
    assert not (isinstance(ok, dict) and ok.get("error"))
    assert any(c[0] == "capture" for c in backend.calls)


def test_stale_capture_blocks_blind_click(cu_tool, monkeypatch):
    monkeypatch.setattr(
        "tools.computer_use.privilege._computer_use_cfg",
        lambda: {
            "privilege_mode": "ask",
            "require_fresh_capture": True,
            "capture_ttl_seconds": 120,
        },
    )
    backend = _install_backend(cu_tool, session_id="priv-stale", fresh=False)
    blocked = _payload(cu_tool.handle_computer_use(
        {"action": "click", "element": 2}, session_id="priv-stale"))
    assert blocked.get("code") == "stale_capture"
    assert backend.calls == []

    cu_tool.handle_computer_use(
        {"action": "capture", "mode": "som", "app": "TextEdit"}, session_id="priv-stale")
    ok = _payload(cu_tool.handle_computer_use(
        {"action": "click", "element": 2}, session_id="priv-stale"))
    assert not (isinstance(ok, dict) and ok.get("error"))
    assert any(c[0] == "click" for c in backend.calls)


def test_capture_ttl_expiry(cu_tool, monkeypatch):
    monkeypatch.setattr(
        "tools.computer_use.privilege._computer_use_cfg",
        lambda: {
            "privilege_mode": "ask",
            "require_fresh_capture": True,
            "capture_ttl_seconds": 1,
        },
    )
    backend = _install_backend(cu_tool, session_id="priv-ttl", fresh=True)
    with cu_tool._capture_freshness_lock:
        cu_tool._last_capture_at["priv-ttl"] = time.monotonic() - 5
    blocked = _payload(cu_tool.handle_computer_use(
        {"action": "type", "text": "hi"}, session_id="priv-ttl"))
    assert blocked.get("code") == "stale_capture"
    assert backend.calls == []


def test_trusted_apps_skips_approval_callback(cu_tool, monkeypatch):
    monkeypatch.setattr(
        "tools.computer_use.privilege._computer_use_cfg",
        lambda: {
            "privilege_mode": "trusted_apps",
            "trusted_apps": ["TextEdit"],
            "require_fresh_capture": False,
        },
    )
    seen = []

    def deny_all(action, args, summary):
        seen.append(action)
        return "deny"

    cu_tool.set_approval_callback(deny_all)
    backend = _install_backend(cu_tool, app_sticky="TextEdit", session_id="priv-trust", fresh=True)
    ok = _payload(cu_tool.handle_computer_use(
        {"action": "click", "element": 1, "app": "TextEdit"}, session_id="priv-trust"))
    assert not (isinstance(ok, dict) and ok.get("error"))
    assert seen == []  # trusted → no callback
    assert any(c[0] == "click" for c in backend.calls)


def test_untrusted_app_still_asks(cu_tool, monkeypatch):
    monkeypatch.setattr(
        "tools.computer_use.privilege._computer_use_cfg",
        lambda: {
            "privilege_mode": "trusted_apps",
            "trusted_apps": ["TextEdit"],
            "require_fresh_capture": False,
        },
    )
    seen = []

    def deny_all(action, args, summary):
        seen.append(action)
        return "deny"

    cu_tool.set_approval_callback(deny_all)
    backend = _install_backend(cu_tool, app_sticky="Safari", session_id="priv-untrust", fresh=True)
    denied = _payload(cu_tool.handle_computer_use(
        {"action": "click", "element": 1, "app": "Safari"}, session_id="priv-untrust"))
    assert denied.get("error") == "denied by user"
    assert seen == ["click"]
    assert backend.calls == []


def test_ask_mode_denies_when_callback_denies(cu_tool, monkeypatch):
    monkeypatch.setattr(
        "tools.computer_use.privilege._computer_use_cfg",
        lambda: {"privilege_mode": "ask", "require_fresh_capture": False},
    )
    cu_tool.set_approval_callback(lambda a, args, s: "deny")
    backend = _install_backend(cu_tool, session_id="priv-ask", fresh=True)
    denied = _payload(cu_tool.handle_computer_use(
        {"action": "click", "element": 9}, session_id="priv-ask"))
    assert denied.get("error") == "denied by user"
    assert backend.calls == []


def test_privilege_snapshot_defaults(monkeypatch):
    from tools.computer_use import privilege as priv

    monkeypatch.setattr(priv, "_computer_use_cfg", lambda: {})
    snap = priv.privilege_snapshot()
    assert snap["privilege_mode"] == "ask"
    assert snap["trusted_apps"] == []
    assert snap["require_fresh_capture"] is True


def test_trusted_app_exact_match_only(monkeypatch):
    from tools.computer_use import privilege as priv

    monkeypatch.setattr(priv, "_computer_use_cfg", lambda: {"trusted_apps": ["TextEdit"]})
    assert priv.app_is_trusted("TextEdit")
    assert priv.app_is_trusted("textedit")
    assert not priv.app_is_trusted("edi")  # no substring bypass
    assert not priv.app_is_trusted("TextEdit Helper")


def test_parse_privilege_mode_rejects_unknown():
    from tools.computer_use import privilege as priv

    with pytest.raises(ValueError, match="Unknown privilege_mode"):
        priv.parse_privilege_mode("yolo")
