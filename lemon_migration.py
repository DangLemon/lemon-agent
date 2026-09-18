"""One-time filesystem migration from the legacy Hermes identity to Lemon AI.

The default homes are siblings on every supported platform, so migration uses an
atomic rename. Two populated homes are never merged: SQLite state, credentials,
profiles, and runtime markers do not have a safe generic merge operation.
"""

from __future__ import annotations

import json
import os
import stat
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

_MIGRATION_SCHEMA = 1
_MIGRATION_MARKER = ".lemon-identity-migration.json"
_ROLLBACK_GUARD = ".lemon-identity-migration-disabled"

MigrationState = Literal[
    "not_needed",
    "migrated",
    "already_migrated",
    "disabled",
    "conflict",
    "error",
    "rolled_back",
]


@dataclass(frozen=True)
class IdentityMigrationResult:
    state: MigrationState
    legacy_home: Path
    lemon_home: Path
    detail: str = ""

    @property
    def changed(self) -> bool:
        return self.state in {"migrated", "rolled_back"}


def default_identity_homes() -> tuple[Path, Path]:
    """Return ``(legacy_home, lemon_home)`` for the current platform."""
    if sys.platform == "win32":
        local_appdata = os.environ.get("LOCALAPPDATA", "").strip()
        base = Path(local_appdata) if local_appdata else Path.home() / "AppData" / "Local"
        return base / "hermes", base / "Lemon AI"
    home = Path.home()
    return home / ".hermes", home / ".lemon-ai"


def _path_has_content(path: Path) -> bool:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    except OSError:
        return True
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        return True
    try:
        next(path.iterdir())
    except StopIteration:
        return False
    except OSError:
        return True
    return True


def _write_json_atomic(path: Path, payload: dict) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _same_path(left: Path, right: Path) -> bool:
    try:
        return left.resolve(strict=False) == right.resolve(strict=False)
    except OSError:
        return os.path.normcase(os.path.abspath(left)) == os.path.normcase(os.path.abspath(right))


def migrate_default_home_once(
    *,
    legacy_home: Path | None = None,
    lemon_home: Path | None = None,
    ignore_rollback_guard: bool = False,
) -> IdentityMigrationResult:
    """Atomically move a populated legacy default home into an empty Lemon home.

    Existing explicit ``LEMON_HOME`` values are handled by callers and are never
    rewritten here. A populated Lemon home wins over a populated legacy home;
    the result reports ``conflict`` and leaves both trees untouched.
    """
    default_legacy, default_lemon = default_identity_homes()
    legacy = Path(legacy_home or default_legacy).expanduser()
    lemon = Path(lemon_home or default_lemon).expanduser()
    if _same_path(legacy, lemon):
        return IdentityMigrationResult("not_needed", legacy, lemon)

    marker = lemon / _MIGRATION_MARKER
    guard = lemon.parent / _ROLLBACK_GUARD
    if marker.is_file():
        return IdentityMigrationResult("already_migrated", legacy, lemon)
    if guard.exists() and not ignore_rollback_guard:
        return IdentityMigrationResult("disabled", legacy, lemon, f"automatic migration disabled by {guard}")
    if not _path_has_content(legacy):
        return IdentityMigrationResult("not_needed", legacy, lemon)
    if legacy.is_symlink():
        return IdentityMigrationResult("conflict", legacy, lemon, "legacy home is a symlink")
    if _path_has_content(lemon):
        return IdentityMigrationResult("conflict", legacy, lemon, "both legacy and Lemon homes contain data")
    if lemon.is_symlink():
        return IdentityMigrationResult("conflict", legacy, lemon, "Lemon home is a symlink")

    removed_empty_target = False
    try:
        if lemon.exists():
            lemon.rmdir()
            removed_empty_target = True
        lemon.parent.mkdir(parents=True, exist_ok=True)
        os.replace(legacy, lemon)
        try:
            _write_json_atomic(
                marker,
                {
                    "schema": _MIGRATION_SCHEMA,
                    "migrated_at": datetime.now(timezone.utc).isoformat(),
                    "legacy_home": str(legacy),
                    "lemon_home": str(lemon),
                    "method": "atomic_rename",
                },
            )
            guard.unlink(missing_ok=True)
        except OSError:
            os.replace(lemon, legacy)
            if removed_empty_target:
                lemon.mkdir(parents=False, exist_ok=True)
            raise
    except OSError as exc:
        return IdentityMigrationResult("error", legacy, lemon, str(exc))
    return IdentityMigrationResult("migrated", legacy, lemon)


def rollback_default_home_migration(
    *, legacy_home: Path | None = None, lemon_home: Path | None = None
) -> IdentityMigrationResult:
    """Move an automatically migrated Lemon home back to its recorded legacy path."""
    default_legacy, default_lemon = default_identity_homes()
    legacy = Path(legacy_home or default_legacy).expanduser()
    lemon = Path(lemon_home or default_lemon).expanduser()
    marker = lemon / _MIGRATION_MARKER
    guard = lemon.parent / _ROLLBACK_GUARD

    try:
        payload = json.loads(marker.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return IdentityMigrationResult("not_needed", legacy, lemon, "migration marker not found")
    except (OSError, UnicodeError, ValueError) as exc:
        return IdentityMigrationResult("error", legacy, lemon, f"cannot read migration marker: {exc}")

    if payload.get("schema") != _MIGRATION_SCHEMA:
        return IdentityMigrationResult("error", legacy, lemon, "unsupported migration marker schema")
    recorded_legacy = Path(str(payload.get("legacy_home", ""))).expanduser()
    recorded_lemon = Path(str(payload.get("lemon_home", ""))).expanduser()
    if not _same_path(recorded_legacy, legacy) or not _same_path(recorded_lemon, lemon):
        return IdentityMigrationResult("error", legacy, lemon, "migration marker paths do not match this machine")
    if _path_has_content(legacy):
        return IdentityMigrationResult("conflict", legacy, lemon, "legacy home was recreated after migration")

    try:
        if legacy.exists():
            legacy.rmdir()
        os.replace(lemon, legacy)
        (legacy / _MIGRATION_MARKER).unlink(missing_ok=True)
        _write_json_atomic(
            guard,
            {
                "schema": _MIGRATION_SCHEMA,
                "rolled_back_at": datetime.now(timezone.utc).isoformat(),
                "legacy_home": str(legacy),
                "lemon_home": str(lemon),
            },
        )
    except OSError as exc:
        return IdentityMigrationResult("error", legacy, lemon, str(exc))
    return IdentityMigrationResult("rolled_back", legacy, lemon)


def migration_marker_name() -> str:
    return _MIGRATION_MARKER


def rollback_guard_name() -> str:
    return _ROLLBACK_GUARD
