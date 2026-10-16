"""Opt-in Computer Use session history (Phase 3 — not Skysight).

Default OFF. When ``computer_use.history_enabled`` is true, successful tool
calls append a compact event to an in-memory ring (and optional jsonl under
``$LEMON_HOME/cache/computer_use/``). ``action=history`` / API summarize on
demand — never continuous background observation.
"""

from __future__ import annotations

import contextlib
import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

DEFAULT_HISTORY_ENABLED = False
DEFAULT_HISTORY_MAX_EVENTS = 200
DEFAULT_HISTORY_PERSIST = False

_lock = threading.Lock()
# sid -> list[event]
_events: Dict[str, List[Dict[str, Any]]] = {}


def _computer_use_cfg() -> Dict[str, Any]:
    try:
        from lemon_cli.config import load_config

        section = (load_config() or {}).get("computer_use")
        return section if isinstance(section, dict) else {}
    except Exception:
        return {}


def history_enabled() -> bool:
    raw = _computer_use_cfg().get("history_enabled", DEFAULT_HISTORY_ENABLED)
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return bool(raw)


def history_max_events() -> int:
    try:
        n = int(_computer_use_cfg().get("history_max_events", DEFAULT_HISTORY_MAX_EVENTS))
    except (TypeError, ValueError):
        n = DEFAULT_HISTORY_MAX_EVENTS
    return max(1, min(n, 2000))


def history_persist() -> bool:
    raw = _computer_use_cfg().get("history_persist", DEFAULT_HISTORY_PERSIST)
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return bool(raw)


def history_snapshot() -> Dict[str, Any]:
    return {
        "history_enabled": history_enabled(),
        "history_max_events": history_max_events(),
        "history_persist": history_persist(),
        "privacy_default": "off",
    }


def clear_session_history(session_id: str = "") -> None:
    sid = str(session_id or "")
    with _lock:
        _events.pop(sid, None)


def clear_all_history() -> None:
    with _lock:
        _events.clear()


def _redact_args(action: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Keep timeline useful without dumping long typed secrets into history."""
    out: Dict[str, Any] = {}
    for key in ("element", "app", "mode", "direction", "amount", "button",
                "delivery_mode", "bring_to_front", "pid", "window_id", "keys"):
        if key in args and args[key] is not None:
            out[key] = args[key]
    if "coordinate" in args and args["coordinate"] is not None:
        out["coordinate"] = args["coordinate"]
    text = args.get("text")
    if isinstance(text, str):
        out["text"] = text if len(text) <= 40 else text[:40] + "…"
        out["text_len"] = len(text)
    value = args.get("value")
    if isinstance(value, str):
        out["value"] = value if len(value) <= 40 else value[:40] + "…"
        out["value_len"] = len(value)
    out["action"] = action
    return out


def _result_brief(result: Any) -> Dict[str, Any]:
    if isinstance(result, dict):
        if result.get("_multimodal"):
            meta = result.get("meta") or {}
            return {"ok": True, "kind": "multimodal",
                    "mode": meta.get("mode"), "elements": meta.get("elements")}
        brief = {k: result.get(k) for k in ("ok", "action", "code", "error") if k in result}
        if "tree_diff" in result:
            brief["tree_diff"] = result["tree_diff"]
        if "total_elements" in result:
            brief["total_elements"] = result["total_elements"]
        msg = result.get("message")
        if isinstance(msg, str) and msg:
            brief["message"] = msg[:120]
        return brief
    if isinstance(result, str):
        with contextlib.suppress(Exception):
            data = json.loads(result)
            if isinstance(data, dict):
                return _result_brief(data)
        return {"raw": result[:120]}
    return {}


def record_event(session_id: str, action: str, args: Dict[str, Any], result: Any) -> None:
    """Append one event when history is enabled. Never raises into the tool path."""
    if not history_enabled() or action == "history":
        return
    try:
        sid = str(session_id or "")
        event = {
            "ts": time.time(),
            "action": action,
            "args": _redact_args(action, args or {}),
            "result": _result_brief(result),
        }
        cap = history_max_events()
        with _lock:
            bucket = _events.setdefault(sid, [])
            bucket.append(event)
            if len(bucket) > cap:
                del bucket[: len(bucket) - cap]
        if history_persist():
            _append_jsonl(sid, event)
    except Exception:
        return


def _append_jsonl(session_id: str, event: Dict[str, Any]) -> None:
    try:
        from lemon_constants import get_lemon_dir

        directory = get_lemon_dir("cache/computer_use", "computer_use_cache")
        directory.mkdir(parents=True, exist_ok=True)
        path = Path(directory) / f"history_{session_id or 'default'}.jsonl"
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception:
        return


def list_events(session_id: str = "", *, limit: int = 50) -> List[Dict[str, Any]]:
    sid = str(session_id or "")
    lim = max(1, min(int(limit or 50), history_max_events()))
    with _lock:
        bucket = list(_events.get(sid, []))
    return bucket[-lim:]


def summarize_history(session_id: str = "", *, limit: int = 50) -> Dict[str, Any]:
    """Human + structured timeline for “what did I just do”."""
    if not history_enabled():
        return {
            "enabled": False,
            "events": [],
            "count": 0,
            "summary": (
                "Computer Use history is OFF (privacy default). "
                "Set computer_use.history_enabled: true to record this session."
            ),
        }
    events = list_events(session_id, limit=limit)
    lines = [f"Computer Use history ({len(events)} event(s), newest last):"]
    for ev in events:
        args = ev.get("args") or {}
        res = ev.get("result") or {}
        bit = args.get("action") or ev.get("action")
        detail = ""
        if args.get("element") is not None:
            detail = f" element=#{args['element']}"
        elif args.get("app"):
            detail = f" app={args['app']!r}"
        elif args.get("text") is not None:
            detail = f" text={args['text']!r}"
        elif args.get("value") is not None:
            detail = f" value={args['value']!r}"
        ok = res.get("ok")
        code = res.get("code") or res.get("error")
        status = "ok" if ok is True or (ok is None and not code) else f"fail:{code or ok}"
        lines.append(f"  - {bit}{detail} → {status}")
    return {
        "enabled": True,
        "events": events,
        "count": len(events),
        "summary": "\n".join(lines) if events else "Computer Use history is ON but empty for this session.",
    }


def apply_history_update(*, history_enabled: Optional[bool] = None,
                         history_max_events: Optional[int] = None,
                         history_persist: Optional[bool] = None) -> Dict[str, Any]:
    """Persist history toggles into config.yaml (API path)."""
    from lemon_cli.config import load_config, save_config

    cfg = load_config() or {}
    section = cfg.setdefault("computer_use", {})
    if not isinstance(section, dict):
        section = {}
        cfg["computer_use"] = section
    if history_enabled is not None:
        section["history_enabled"] = bool(history_enabled)
    if history_persist is not None:
        section["history_persist"] = bool(history_persist)
    if history_max_events is not None:
        section["history_max_events"] = max(1, min(int(history_max_events), 2000))
    save_config(cfg)
    return history_snapshot()
