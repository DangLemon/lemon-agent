"""Configured source repository behavior for ``lemon update``."""

from pathlib import Path
from unittest.mock import patch

import pytest

from lemon_cli import update_cmd


def test_configured_repository_reclassifies_lemon_origin(monkeypatch):
    monkeypatch.setenv("LEMON_UPDATE_REPOSITORY", "DangLemon/lemon-agent")

    assert update_cmd._configured_update_repository() == "DangLemon/lemon-agent"
    assert (
        update_cmd._configured_update_repository_url()
        == "https://github.com/DangLemon/lemon-agent.git"
    )
    assert update_cmd._is_fork("https://github.com/DangLemon/lemon-agent.git") is False
    assert update_cmd._is_fork("git@github.com:DangLemon/lemon-agent.git") is False


def test_configured_repository_honors_install_repository(monkeypatch):
    monkeypatch.delenv("LEMON_UPDATE_REPOSITORY", raising=False)
    monkeypatch.setenv("LEMON_INSTALL_REPOSITORY", "DangLemon/lemon-agent")

    assert update_cmd._configured_update_repository() == "DangLemon/lemon-agent"


def test_configured_repository_prefers_update_repository_over_install_repository(monkeypatch):
    monkeypatch.setenv("LEMON_UPDATE_REPOSITORY", "ExampleOrg/runtime-agent")
    monkeypatch.setenv("LEMON_INSTALL_REPOSITORY", "DangLemon/lemon-agent")

    assert update_cmd._configured_update_repository() == "ExampleOrg/runtime-agent"


def test_configured_repository_uses_lemon_for_internal_desktop_env(monkeypatch):
    monkeypatch.delenv("LEMON_UPDATE_REPOSITORY", raising=False)
    monkeypatch.delenv("LEMON_INSTALL_REPOSITORY", raising=False)
    monkeypatch.setenv("LEMON_DESKTOP_INTERNAL", "1")

    assert update_cmd._configured_update_repository() == "DangLemon/lemon-agent"


def test_configured_repository_keeps_public_default_without_internal_env(monkeypatch):
    monkeypatch.delenv("LEMON_UPDATE_REPOSITORY", raising=False)
    monkeypatch.delenv("LEMON_INSTALL_REPOSITORY", raising=False)
    monkeypatch.delenv("LEMON_DESKTOP_INTERNAL", raising=False)
    monkeypatch.delenv("LEMON_DESKTOP_INTERNAL", raising=False)
    monkeypatch.delenv("LEMON_DESKTOP_INTERNAL_PACKAGE", raising=False)

    assert update_cmd._configured_update_repository() == "DangLemon/lemon-agent"


def test_configured_repository_rejects_urls(monkeypatch):
    monkeypatch.setenv("LEMON_UPDATE_REPOSITORY", "https://github.com/DangLemon/lemon-agent")

    with pytest.raises(ValueError, match="LEMON_UPDATE_REPOSITORY"):
        update_cmd._configured_update_repository()


def test_configured_repository_disables_upstream_sync(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("LEMON_UPDATE_REPOSITORY", "DangLemon/lemon-agent")

    with patch.object(update_cmd, "_has_upstream_remote") as has_upstream:
        assert update_cmd._sync_with_upstream_if_needed(["git"], tmp_path) is False

    has_upstream.assert_not_called()


def test_zip_fallback_uses_configured_repository(monkeypatch):
    from lemon_cli.update_cmd_zip import _zip_source_archive_url

    monkeypatch.setenv("LEMON_UPDATE_REPOSITORY", "DangLemon/lemon-agent")

    assert (
        _zip_source_archive_url("main")
        == "https://github.com/DangLemon/lemon-agent/archive/refs/heads/main.zip"
    )


def test_banner_release_url_uses_configured_repository(monkeypatch, tmp_path: Path):
    from lemon_cli import banner

    monkeypatch.setenv("LEMON_UPDATE_REPOSITORY", "DangLemon/lemon-agent")

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)

    with patch.object(banner, "_git_stdout", return_value="v1.2.3"):
        assert banner.get_latest_release_tag(repo_dir) == (
            "v1.2.3",
            "https://github.com/DangLemon/lemon-agent/releases/tag/v1.2.3",
        )
