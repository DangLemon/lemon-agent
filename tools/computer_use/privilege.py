"""Computer Use privilege policy (Settings picker + tool-layer enforce).

Layers (keep distinct from shell ``approvals.mode`` / YOLO):

* OS TCC — Accessibility / Screen Recording (``permissions.py``)
* ``computer_use.privilege_mode`` — what Lemon may do after OS grants
* Per-action approval callback — Ask before act (CLI/TUI); Trusted apps may skip

Modes:
* ``capture_only`` — read actions only; mutate rejected before approval
* ``ask`` — mutate goes through ``_request_approval`` (default)
* ``trusted_apps`` — mutate skips approval when sticky/requested app is trusted
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence

PRIVILEGE_MODES = frozenset({"capture_only", "ask", "trusted_apps"})
DEFAULT_PRIVILEGE_MODE = "ask"
DEFAULT_CAPTURE_TTL_SECONDS = 120
DEFAULT_REQUIRE_FRESH_CAPTURE = True

# Mutate actions that need a recent capture (Codex-style ritual). focus_app can
# establish a sticky target without a prior snapshot.
_FRESH_CAPTURE_ACTIONS = frozenset({
    "click", "double_click", "right_click", "middle_click",
    "drag", "scroll", "type", "key", "set_value",
})


def _computer_use_cfg() -> Dict[str, Any]:
    try:
        from lemon_cli.config import load_config

        cfg = load_config() or {}
        section = cfg.get("computer_use")
        return section if isinstance(section, dict) else {}
    except Exception:
        return {}


def normalize_privilege_mode(raw: Any) -> str:
    mode = str(raw or DEFAULT_PRIVILEGE_MODE).strip().lower()
    return mode if mode in PRIVILEGE_MODES else DEFAULT_PRIVILEGE_MODE


def parse_privilege_mode(raw: Any) -> str:
    """Raise ``ValueError`` on unknown modes (API path); defaults only when raw is empty."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return DEFAULT_PRIVILEGE_MODE
    mode = str(raw).strip().lower()
    if mode not in PRIVILEGE_MODES:
        raise ValueError(
            f"Unknown privilege_mode: {raw!r}. Use one of: {', '.join(sorted(PRIVILEGE_MODES))}")
    return mode


def normalize_app_key(app: str) -> str:
    return (app or "").strip().lower()


def trusted_app_keys(trusted: Sequence[Any] | None) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in trusted or ():
        key = normalize_app_key(str(item))
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out


def get_privilege_mode() -> str:
    return normalize_privilege_mode(_computer_use_cfg().get("privilege_mode"))


def get_trusted_apps() -> List[str]:
    return trusted_app_keys(_computer_use_cfg().get("trusted_apps"))


def get_capture_ttl_seconds() -> float:
    raw = _computer_use_cfg().get("capture_ttl_seconds", DEFAULT_CAPTURE_TTL_SECONDS)
    try:
        ttl = float(raw)
    except (TypeError, ValueError):
        return float(DEFAULT_CAPTURE_TTL_SECONDS)
    return max(0.0, ttl)


def require_fresh_capture_enabled() -> bool:
    raw = _computer_use_cfg().get("require_fresh_capture", DEFAULT_REQUIRE_FRESH_CAPTURE)
    if isinstance(raw, str):
        return raw.strip().lower() not in {"0", "false", "no", "off"}
    return bool(raw)


def app_is_trusted(app: str | None, trusted: Sequence[str] | None = None) -> bool:
    """Exact match after normalize (no substring — avoids accidental approval bypass)."""
    current = normalize_app_key(app or "")
    if not current:
        return False
    keys = set(trusted_app_keys(trusted if trusted is not None else get_trusted_apps()))
    return current in keys


def resolve_target_app(args: Dict[str, Any], backend: Any = None) -> str:
    """Best-effort app identity for privilege / trust checks."""
    requested = args.get("app")
    if isinstance(requested, str) and requested.strip():
        return requested.strip()
    last = getattr(backend, "_last_app", None) if backend is not None else None
    if isinstance(last, str) and last.strip():
        return last.strip()
    return ""


def privilege_blocks_mutate(action: str, *, destructive: bool) -> Optional[str]:
    """JSON error when privilege_mode forbids mutate; else None."""
    if not destructive and action != "bring_to_front":
        return None
    if get_privilege_mode() != "capture_only":
        return None
    return json.dumps({
        "error": "computer_use privilege_mode is capture_only — mutate actions are blocked",
        "code": "privilege_capture_only",
        "action": action,
        "hint": "Open Settings → Computer Use and switch privilege to "
                "'Ask before act' or 'Trusted apps', then retry.",
    })


def should_skip_approval_for_app(app: str | None) -> bool:
    """True when trusted_apps mode and *app* is on the allowlist."""
    return get_privilege_mode() == "trusted_apps" and app_is_trusted(app)


def fresh_capture_required(action: str) -> bool:
    return action in _FRESH_CAPTURE_ACTIONS and require_fresh_capture_enabled()


def privilege_snapshot() -> Dict[str, Any]:
    """Payload for GET /api/tools/computer-use/privilege."""
    return {
        "privilege_mode": get_privilege_mode(),
        "trusted_apps": get_trusted_apps(),
        "capture_ttl_seconds": get_capture_ttl_seconds(),
        "require_fresh_capture": require_fresh_capture_enabled(),
        "modes": sorted(PRIVILEGE_MODES),
    }


def apply_privilege_update(
    *,
    privilege_mode: Any = None,
    trusted_apps: Any = None,
) -> Dict[str, Any]:
    """Merge privilege fields into config.yaml and return the new snapshot."""
    from lemon_cli.config import load_config, save_config

    config = load_config() or {}
    section = config.setdefault("computer_use", {})
    if not isinstance(section, dict):
        section = {}
        config["computer_use"] = section
    if privilege_mode is not None:
        section["privilege_mode"] = parse_privilege_mode(privilege_mode)
    if trusted_apps is not None:
        if not isinstance(trusted_apps, (list, tuple)):
            raise ValueError("trusted_apps must be a list of app names / bundle ids")
        section["trusted_apps"] = trusted_app_keys(trusted_apps)
    save_config(config)
    return privilege_snapshot()


def remember_trusted_app(app: str) -> bool:
    """Persist *app* into computer_use.trusted_apps. Returns True if added/changed."""
    key = normalize_app_key(app)
    if not key:
        return False
    current = get_trusted_apps()
    if key in current:
        return False
    apply_privilege_update(trusted_apps=[*current, app.strip()])
    return True
