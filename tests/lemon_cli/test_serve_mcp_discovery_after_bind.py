"""Desktop `serve` keeps MCP discovery off startup until a real prompt."""

from __future__ import annotations

import json
import logging

import lemon_cli.main as main
import lemon_cli.mcp_startup as mcp_startup


def test_desktop_serve_does_not_start_discovery_at_startup(monkeypatch):
    monkeypatch.setenv("LEMON_DESKTOP", "1")
    calls = []
    monkeypatch.setattr(mcp_startup, "start_background_mcp_discovery", lambda **kwargs: calls.append(kwargs))
    monkeypatch.setattr(main, "_sync_bundled_skills_quietly", lambda: None)
    monkeypatch.setattr(main, "_resolve_dashboard_web_dist", lambda *args: None)
    monkeypatch.setattr("lemon_cli.config.apply_terminal_config_to_env", lambda: None)
    monkeypatch.setattr("lemon_cli.plugins.discover_plugins", lambda: None)

    main._dashboard_prepare_runtime(object(), headless_backend=True)

    assert calls == []


def test_non_desktop_dashboard_still_starts_discovery(monkeypatch):
    monkeypatch.delenv("LEMON_DESKTOP", raising=False)
    calls = []
    monkeypatch.setattr(mcp_startup, "start_background_mcp_discovery", lambda **kwargs: calls.append(kwargs))
    monkeypatch.setattr(main, "_sync_bundled_skills_quietly", lambda: None)
    monkeypatch.setattr(main, "_resolve_dashboard_web_dist", lambda *args: None)
    monkeypatch.setattr("lemon_cli.config.apply_terminal_config_to_env", lambda: None)
    monkeypatch.setattr("lemon_cli.plugins.discover_plugins", lambda: None)

    main._dashboard_prepare_runtime(object(), headless_backend=False)

    assert calls == [{"logger": main.logger, "thread_name": "dashboard-mcp-discovery"}]
