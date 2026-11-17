"""Config integration tests — managed scope wins over user config at the leaf."""
import textwrap

import pytest


@pytest.fixture
def homes(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    managed = tmp_path / "managed"
    managed.mkdir()
    monkeypatch.setenv("LEMON_HOME", str(home))
    monkeypatch.setenv("LEMON_MANAGED_DIR", str(managed))
    import lemon_cli.config as cfg
    from lemon_cli import managed_scope

    cfg._LOAD_CONFIG_CACHE.clear()
    cfg._RAW_CONFIG_CACHE.clear()
    managed_scope.invalidate_managed_cache()
    return home, managed


def _write(path, body):
    path.write_text(textwrap.dedent(body), encoding="utf-8")
    import lemon_cli.config as cfg
    from lemon_cli import managed_scope

    cfg._LOAD_CONFIG_CACHE.clear()
    cfg._RAW_CONFIG_CACHE.clear()
    managed_scope.invalidate_managed_cache()


def test_managed_beats_user(homes):
    from lemon_cli.config import load_config, cfg_get

    home, managed = homes
    _write(home / "config.yaml", "model:\n  default: user/model\n")
    _write(managed / "config.yaml", "model:\n  default: managed/model\n")
    assert cfg_get(load_config(), "model", "default") == "managed/model"


def test_managed_list_wins_wholesale(homes):
    """D3: a managed list value replaces the user's wholesale."""
    from lemon_cli.config import load_config, cfg_get

    home, managed = homes
    _write(home / "config.yaml", "toolsets:\n  enabled: [a, b, c]\n")
    _write(managed / "config.yaml", "toolsets:\n  enabled: [x]\n")
    assert cfg_get(load_config(), "toolsets", "enabled") == ["x"]


def test_user_cannot_shadow_managed_literal_via_envref(homes, monkeypatch):
    """A managed literal must NOT be expandable via a ${VAR} the user controls.

    The managed value is a plain literal 'managed/locked' with no ${...}, so a
    user-defined env var has nothing to substitute. This asserts the managed
    literal survives verbatim regardless of user env, and that managed wins.
    """
    from lemon_cli.config import load_config, cfg_get

    home, managed = homes
    monkeypatch.setenv("EVIL", "user/override")
    _write(home / "config.yaml", "model:\n  default: ${EVIL}\n")
    _write(managed / "config.yaml", "model:\n  default: managed/locked\n")
    assert cfg_get(load_config(), "model", "default") == "managed/locked"


def test_managed_nested_dict_default_flattens_on_load(homes):
    """A dict-valued managed ``model.default`` must flatten on load.

    ``load_config()`` merges the managed overlay after its single
    normalization pass, so a managed ``model.default: {provider: ...,
    model: ...}`` used to reach runtime readers as a raw dict. The overlay
    is now normalized before merging (parity with
    ``managed_scope.apply_managed_overlay``), so the merged config exposes a
    string ``default`` paired with the nested ``provider``.
    """
    from lemon_cli.config import load_config, cfg_get

    home, managed = homes
    _write(home / "config.yaml", "model:\n  default: user/model\n")
    _write(managed / "config.yaml", "model:\n  default:\n    provider: nous\n    model: managed/nested\n")
    cfg = load_config()
    assert cfg_get(cfg, "model", "default") == "managed/nested"
    assert cfg_get(cfg, "model", "provider") == "nous"


def test_managed_bare_string_model_flattens_to_default_on_load(homes):
    """A bare ``model: <string>`` in the managed file stays a dict shape.

    Mirrors the existing managed-overlay contract: a bare string model must
    merge as ``model.default`` so readers that do
    ``cfg["model"]["default"]`` keep working (never a bare string at
    ``cfg["model"]``).
    """
    from lemon_cli.config import load_config, cfg_get

    home, managed = homes
    _write(home / "config.yaml", "model:\n  default: user/model\n")
    _write(managed / "config.yaml", "model: managed/bare\n")
    cfg = load_config()
    assert cfg_get(cfg, "model", "default") == "managed/bare"


def test_user_mcp_server_map_replaces_managed_server_on_load(homes):
    """A desktop mcp.json save wins the whole server map.

    The saved object replaces that managed server (a leaf merge must not put
    harness fields back), a new name is kept, and a harness name left out of
    the save stays gone — including when the save clears the map. Pinned keys
    outside mcp_servers, such as model.default, still lose to the managed layer
    and are not written into the user file.
    """
    from lemon_cli.config import load_config
    from lemon_cli.mcp_config import _replace_mcp_servers

    home, managed = homes
    _write(
        home / "config.yaml",
        """
        display:
          skin: user-skin
        model:
          default: user/model
        """,
    )
    _write(
        managed / "config.yaml",
        """
        model:
          default: managed/model
        mcp_servers:
          harness-ads:
            url: https://managed.example/mcp
            enabled: true
            auth: oauth
            region: managed-pin
            oauth:
              client_id: managed-oauth-client
          harness-search:
            url: https://managed.example/search
            enabled: true
        """,
    )

    before = load_config()
    assert before["model"]["default"] == "managed/model"
    assert set(before["mcp_servers"]) == {"harness-ads", "harness-search"}
    assert before["mcp_servers"]["harness-ads"]["region"] == "managed-pin"

    saved = {
        "harness-ads": {
            "url": "https://user.example/mcp",
            "enabled": False,
            "auth": "oauth",
            "oauth": {"client_id": "user-oauth-client"},
        },
        "user-notes": {"url": "https://user.example/notes"},
    }
    ok, issues = _replace_mcp_servers(saved)
    assert ok, issues

    loaded = load_config()
    ads = loaded["mcp_servers"]["harness-ads"]
    assert ads["url"] == "https://user.example/mcp"
    assert ads["enabled"] is False
    assert ads["oauth"] == {"client_id": "user-oauth-client"}
    assert "region" not in ads
    assert loaded["mcp_servers"]["user-notes"]["url"] == "https://user.example/notes"
    assert "harness-search" not in loaded["mcp_servers"]
    assert loaded["model"]["default"] == "managed/model"
    assert loaded["display"]["skin"] == "user-skin"

    raw = (home / "config.yaml").read_text(encoding="utf-8")
    assert "managed/model" not in raw
    assert "managed-oauth-client" not in raw
    assert "user-skin" in raw
    assert "harness-search" not in raw
    assert "https://user.example/notes" in raw

    ok, issues = _replace_mcp_servers({})
    assert ok, issues
    cleared = load_config()
    assert cleared.get("mcp_servers") == {}
    assert "harness-ads" not in cleared.get("mcp_servers", {})
    assert "harness-search" not in cleared.get("mcp_servers", {})
    assert cleared["model"]["default"] == "managed/model"


def test_user_mcp_server_map_replaces_managed_server_on_load(homes):
    """A desktop mcp.json save wins the whole server map.

    The saved object replaces that managed server (a leaf merge must not put
    harness fields back), a new name is kept, and a harness name left out of
    the save stays gone — including when the save clears the map. Pinned keys
    outside mcp_servers, such as model.default, still lose to the managed layer
    and are not written into the user file.
    """
    from lemon_cli.config import load_config
    from lemon_cli.mcp_config import _replace_mcp_servers

    home, managed = homes
    _write(
        home / "config.yaml",
        """
        display:
          skin: user-skin
        model:
          default: user/model
        """,
    )
    _write(
        managed / "config.yaml",
        """
        model:
          default: managed/model
        mcp_servers:
          harness-ads:
            url: https://managed.example/mcp
            enabled: true
            auth: oauth
            region: managed-pin
            oauth:
              client_id: managed-oauth-client
          harness-search:
            url: https://managed.example/search
            enabled: true
        """,
    )

    before = load_config()
    assert before["model"]["default"] == "managed/model"
    assert set(before["mcp_servers"]) == {"harness-ads", "harness-search"}
    assert before["mcp_servers"]["harness-ads"]["region"] == "managed-pin"

    saved = {
        "harness-ads": {
            "url": "https://user.example/mcp",
            "enabled": False,
            "auth": "oauth",
            "oauth": {"client_id": "user-oauth-client"},
        },
        "user-notes": {"url": "https://user.example/notes"},
    }
    ok, issues = _replace_mcp_servers(saved)
    assert ok, issues

    loaded = load_config()
    ads = loaded["mcp_servers"]["harness-ads"]
    assert ads["url"] == "https://user.example/mcp"
    assert ads["enabled"] is False
    assert ads["oauth"] == {"client_id": "user-oauth-client"}
    assert "region" not in ads
    assert loaded["mcp_servers"]["user-notes"]["url"] == "https://user.example/notes"
    assert "harness-search" not in loaded["mcp_servers"]
    assert loaded["model"]["default"] == "managed/model"
    assert loaded["display"]["skin"] == "user-skin"

    raw = (home / "config.yaml").read_text(encoding="utf-8")
    assert "managed/model" not in raw
    assert "managed-oauth-client" not in raw
    assert "user-skin" in raw
    assert "harness-search" not in raw
    assert "https://user.example/notes" in raw

    ok, issues = _replace_mcp_servers({})
    assert ok, issues
    cleared = load_config()
    assert cleared.get("mcp_servers") == {}
    assert "harness-ads" not in cleared.get("mcp_servers", {})
    assert "harness-search" not in cleared.get("mcp_servers", {})
    assert cleared["model"]["default"] == "managed/model"
