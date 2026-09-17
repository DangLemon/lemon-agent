"""Runtime identity helpers shared by desktop-facing Python entry points.

The internal Lemon AI build carries a validated harness resource.  New builds
select it with ``LEMON_DESKTOP_HARNESS_CONFIG``; the legacy
``LEMON_DESKTOP_HARNESS_CONFIG`` spelling remains a fallback for compatibility.
An arbitrary path must never change the installed product identity.  Keep this
validation intentionally small and dependency-free so it is safe to use from
the installer/uninstaller before the full agent configuration is available.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Mapping


_HARNESS_SCHEMA_VERSION = 1
_HARNESS_UI_KEYS = frozenset({"agents", "cron", "messaging", "terminal", "webhooks"})


def is_valid_internal_harness_path(selected: str | os.PathLike[str] | None) -> bool:
    """Return whether *selected* is a structurally valid internal harness resource.

    This mirrors the identity-bearing portion of the Electron harness schema.
    Full secret/config validation remains owned by the JavaScript build/runtime
    validator; Python only needs enough proof to select Lemon paths safely.
    """

    if not selected:
        return False

    try:
        path = Path(selected).expanduser()
        if not path.is_file():
            return False
        resource = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, TypeError, ValueError):
        return False

    if not isinstance(resource, dict):
        return False
    if resource.get("schemaVersion") != _HARNESS_SCHEMA_VERSION:
        return False
    if resource.get("profile") != "internal":
        return False

    ui = resource.get("ui")
    if not isinstance(ui, dict) or set(ui) != _HARNESS_UI_KEYS:
        return False
    return all(isinstance(value, bool) for value in ui.values())


def internal_desktop_build(env: Mapping[str, str] | None = None) -> bool:
    """Return true only for a trusted explicit internal identity signal.

    Electron passes ``LEMON_DESKTOP_INTERNAL=1`` after validating the packaged
    resource.  The schema-valid resource fallback keeps direct installer and
    test invocations deterministic without requiring Electron.
    """

    environ = os.environ if env is None else env
    if str(environ.get("LEMON_DESKTOP_INTERNAL", "")).strip() == "1":
        return True

    lemon_selected = environ.get("LEMON_DESKTOP_HARNESS_CONFIG")
    selected = (
        lemon_selected
        if str(lemon_selected or "").strip()
        else environ.get("LEMON_DESKTOP_HARNESS_CONFIG")
    )
    return is_valid_internal_harness_path(selected)


def valid_internal_harness_config(path: str | os.PathLike[str] | None) -> bool:
    """Compatibility spelling used by installer identity tests."""

    return is_valid_internal_harness_path(path)


__all__ = [
    "internal_desktop_build",
    "is_valid_internal_harness_path",
    "valid_internal_harness_config",
]
