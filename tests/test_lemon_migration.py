from __future__ import annotations

import json
from pathlib import Path

from lemon_migration import (
    migrate_default_home_once,
    migration_marker_name,
    rollback_default_home_migration,
    rollback_guard_name,
)


def test_migrate_and_rollback_preserve_complete_home(tmp_path: Path) -> None:
    legacy = tmp_path / ".hermes"
    lemon = tmp_path / ".lemon-ai"
    (legacy / "profiles" / "coder").mkdir(parents=True)
    (legacy / "config.yaml").write_text("model: demo\n", encoding="utf-8")
    (legacy / "state.db").write_bytes(b"sqlite-state")
    (legacy / "profiles" / "coder" / ".env").write_text("TOKEN=secret\n", encoding="utf-8")

    migrated = migrate_default_home_once(legacy_home=legacy, lemon_home=lemon)

    assert migrated.state == "migrated"
    assert not legacy.exists()
    assert (lemon / "config.yaml").read_text(encoding="utf-8") == "model: demo\n"
    assert (lemon / "state.db").read_bytes() == b"sqlite-state"
    assert (lemon / "profiles" / "coder" / ".env").read_text(encoding="utf-8") == "TOKEN=secret\n"
    marker = json.loads((lemon / migration_marker_name()).read_text(encoding="utf-8"))
    assert marker["method"] == "atomic_rename"

    rolled_back = rollback_default_home_migration(legacy_home=legacy, lemon_home=lemon)

    assert rolled_back.state == "rolled_back"
    assert not lemon.exists()
    assert (legacy / "state.db").read_bytes() == b"sqlite-state"
    assert not (legacy / migration_marker_name()).exists()
    assert (tmp_path / rollback_guard_name()).is_file()

    blocked = migrate_default_home_once(legacy_home=legacy, lemon_home=lemon)
    assert blocked.state == "disabled"
    forced = migrate_default_home_once(legacy_home=legacy, lemon_home=lemon, ignore_rollback_guard=True)
    assert forced.state == "migrated"


def test_migration_refuses_two_populated_homes(tmp_path: Path) -> None:
    legacy = tmp_path / ".hermes"
    lemon = tmp_path / ".lemon-ai"
    legacy.mkdir()
    lemon.mkdir()
    (legacy / "state.db").write_bytes(b"legacy")
    (lemon / "state.db").write_bytes(b"lemon")

    result = migrate_default_home_once(legacy_home=legacy, lemon_home=lemon)

    assert result.state == "conflict"
    assert (legacy / "state.db").read_bytes() == b"legacy"
    assert (lemon / "state.db").read_bytes() == b"lemon"


def test_migration_replaces_empty_target_directory(tmp_path: Path) -> None:
    legacy = tmp_path / ".hermes"
    lemon = tmp_path / ".lemon-ai"
    legacy.mkdir()
    lemon.mkdir()
    (legacy / "config.yaml").write_text("agent: {}\n", encoding="utf-8")

    result = migrate_default_home_once(legacy_home=legacy, lemon_home=lemon)

    assert result.state == "migrated"
    assert (lemon / "config.yaml").read_text(encoding="utf-8") == "agent: {}\n"
