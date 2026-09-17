from __future__ import annotations

from pathlib import Path

from lemon_cli.desktop_identity import (
    internal_desktop_build,
    valid_internal_harness_config,
)

VALID = """{
  "schemaVersion": 1,
  "profile": "internal",
  "ui": {
    "agents": false,
    "cron": true,
    "messaging": false,
    "terminal": true,
    "webhooks": false
  }
}
"""


def test_internal_desktop_build_requires_valid_harness_config(tmp_path, monkeypatch):
    invalid = tmp_path / "invalid.json"
    invalid.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(invalid))
    monkeypatch.delenv("LEMON_DESKTOP_INTERNAL", raising=False)

    assert valid_internal_harness_config(invalid) is False
    assert internal_desktop_build() is False

    valid = tmp_path / "internal.json"
    valid.write_text(VALID, encoding="utf-8")
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(valid))

    assert valid_internal_harness_config(valid) is True
    assert internal_desktop_build() is True


def test_internal_desktop_build_accepts_explicit_desktop_child_signal(monkeypatch):
    monkeypatch.delenv("LEMON_DESKTOP_HARNESS_CONFIG", raising=False)
    monkeypatch.setenv("LEMON_DESKTOP_INTERNAL", "1")

    assert internal_desktop_build() is True


def test_internal_desktop_build_accepts_legacy_desktop_child_signal(monkeypatch):
    monkeypatch.delenv("LEMON_DESKTOP_HARNESS_CONFIG", raising=False)
    monkeypatch.delenv("LEMON_DESKTOP_INTERNAL", raising=False)
    monkeypatch.setenv("HERMES_DESKTOP_INTERNAL", "1")

    assert internal_desktop_build() is True


def test_internal_desktop_build_prefers_nonblank_lemon_selector(tmp_path):
    valid = tmp_path / "lemon-internal.json"
    valid.write_text(VALID, encoding="utf-8")

    assert (
        internal_desktop_build(
            {
                "LEMON_DESKTOP_HARNESS_CONFIG": str(valid),
                "HERMES_DESKTOP_HARNESS_CONFIG": str(tmp_path / "missing.json"),
            }
        )
        is True
    )


def test_internal_desktop_build_blank_lemon_selector_falls_back_to_legacy(tmp_path):
    valid = tmp_path / "legacy-internal.json"
    valid.write_text(VALID, encoding="utf-8")

    assert (
        internal_desktop_build(
            {
                "LEMON_DESKTOP_HARNESS_CONFIG": "  \t ",
                "HERMES_DESKTOP_HARNESS_CONFIG": str(valid),
            }
        )
        is True
    )


def test_internal_desktop_build_invalid_nonblank_lemon_selector_fails_closed(
    tmp_path,
):
    valid_legacy = tmp_path / "legacy-internal.json"
    valid_legacy.write_text(VALID, encoding="utf-8")

    assert (
        internal_desktop_build(
            {
                "LEMON_DESKTOP_HARNESS_CONFIG": str(tmp_path / "missing.json"),
                "HERMES_DESKTOP_HARNESS_CONFIG": str(valid_legacy),
            }
        )
        is False
    )
