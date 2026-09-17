import json
import os
import importlib.util
import subprocess
import sys
import time
from pathlib import Path

import pytest
import yaml


def _resource(tmp_path: Path, **provider):
    body = {
        "schemaVersion": 1,
        "profile": "internal",
        "ui": {
            "agents": False,
            "cron": True,
            "messaging": False,
            "terminal": True,
            "webhooks": False,
        },
        "managedConfig": {"mcp_servers": {}},
        "initialProvider": {
            "id": "lemon-ai-company",
            "name": "AI công ty",
            "base_url": "http://127.0.0.1:5173/v1",
            "model": "openai-codex-gpt-5-5",
            "key_env": "LEMON_AI_COMPANY_API_KEY",
            **provider,
        },
    }
    path = tmp_path / "internal-desktop-harness.json"
    path.write_text(json.dumps(body), encoding="utf-8")
    return path


def _seed(tmp_path: Path, home: Path, profile: str = ""):
    module_path = (
        Path(__file__).resolve().parents[2]
        / "apps"
        / "desktop"
        / "electron"
        / "lemon-ai-harness-seed.py"
    )
    spec = importlib.util.spec_from_file_location("internal_desktop_harness_seed", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    seed_from_resource = module.seed_from_resource

    return seed_from_resource(_resource(tmp_path), lemon_home=home, profile=profile)


def _read_yaml(path: Path):
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


@pytest.fixture(autouse=True)
def _clear_config_state(monkeypatch):
    from lemon_cli import config, managed_scope

    monkeypatch.delenv("LEMON_MANAGED_DIR", raising=False)
    config._LOAD_CONFIG_CACHE.clear()
    config._RAW_CONFIG_CACHE.clear()
    managed_scope.invalidate_managed_cache()


def test_empty_profile_seeds_company_and_selects_it(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("LEMON_HOME", str(home))

    result = _seed(tmp_path, home)

    saved = _read_yaml(home / "config.yaml")
    assert result == {"ok": True, "seeded_provider": True, "selected_provider": True}
    assert saved["providers"]["lemon-ai-company"]["key_env"] == "LEMON_AI_COMPANY_API_KEY"
    assert saved["model"] == {
        "provider": "lemon-ai-company",
        "default": "openai-codex-gpt-5-5",
        "base_url": "http://127.0.0.1:5173/v1",
        "key_env": "LEMON_AI_COMPANY_API_KEY",
    }
    assert "sk-" not in (home / "config.yaml").read_text(encoding="utf-8")


def test_complete_raw_selection_is_preserved(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(
        "model:\n"
        "  provider: openrouter\n"
        "  default: anthropic/claude-sonnet-4\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LEMON_HOME", str(home))

    result = _seed(tmp_path, home)

    saved = _read_yaml(home / "config.yaml")
    assert result["seeded_provider"] is True
    assert result["selected_provider"] is False
    assert saved["model"] == {
        "provider": "openrouter",
        "default": "anthropic/claude-sonnet-4",
    }
    assert saved["providers"]["lemon-ai-company"]["base_url"] == "http://127.0.0.1:5173/v1"


def test_existing_user_endpoint_keeps_selection_unresolved(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(
        "providers:\n"
        "  office-ai:\n"
        "    name: Office AI\n"
        "    base_url: https://office.example/v1\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LEMON_HOME", str(home))

    result = _seed(tmp_path, home)

    saved = _read_yaml(home / "config.yaml")
    assert result["seeded_provider"] is True
    assert result["selected_provider"] is False
    assert "model" not in saved
    assert set(saved["providers"]) == {"office-ai", "lemon-ai-company"}


def test_existing_company_row_is_user_owned_and_not_overwritten(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(
        "providers:\n"
        "  lemon-ai-company:\n"
        "    name: Edited\n"
        "    base_url: https://edited.example/v1\n"
        "    model: edited-model\n"
        "    key_env: LEMON_CUSTOM_ENDPOINT_LEMON_AI_COMPANY_API_KEY\n"
        "model:\n"
        "  provider: lemon-ai-company\n"
        "  default: edited-model\n"
        "  base_url: https://edited.example/v1\n"
        "  key_env: LEMON_CUSTOM_ENDPOINT_LEMON_AI_COMPANY_API_KEY\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LEMON_HOME", str(home))

    result = _seed(tmp_path, home)

    saved = _read_yaml(home / "config.yaml")
    assert result == {"ok": True, "seeded_provider": False, "selected_provider": False}
    assert saved["providers"]["lemon-ai-company"]["base_url"] == "https://edited.example/v1"
    assert saved["model"]["key_env"] == "LEMON_CUSTOM_ENDPOINT_LEMON_AI_COMPANY_API_KEY"


def test_restart_with_new_managed_dir_preserves_user_selected_endpoint(tmp_path, monkeypatch):
    from lemon_cli.config import load_config
    from lemon_cli.web_models import CustomEndpointUpdate
    from lemon_cli.web_routers.config_env import _write_custom_endpoint, save_config
    from lemon_cli import config, managed_scope

    home = tmp_path / "home"
    managed = tmp_path / "managed-one"
    managed.mkdir()
    (managed / "config.yaml").write_text("mcp_servers: {}\n", encoding="utf-8")
    monkeypatch.setenv("LEMON_HOME", str(home))
    monkeypatch.setenv("LEMON_MANAGED_DIR", str(managed))
    _seed(tmp_path, home)

    cfg = load_config()
    _write_custom_endpoint(
        cfg,
        CustomEndpointUpdate(
            id="office-ai",
            name="Office AI",
            base_url="https://office.example/v1",
            model="office-model",
            api_key="office-secret",
            make_default=True,
        ),
    )
    save_config(cfg)

    managed_two = tmp_path / "managed-two"
    managed_two.mkdir()
    (managed_two / "config.yaml").write_text("mcp_servers: {}\n", encoding="utf-8")
    monkeypatch.setenv("LEMON_MANAGED_DIR", str(managed_two))
    config._LOAD_CONFIG_CACHE.clear()
    config._RAW_CONFIG_CACHE.clear()
    managed_scope.invalidate_managed_cache()

    result = _seed(tmp_path, home)
    effective = load_config()
    raw_text = (home / "config.yaml").read_text(encoding="utf-8")

    assert result["selected_provider"] is False
    assert effective["model"]["provider"] == "office-ai"
    assert effective["model"]["base_url"] == "https://office.example/v1"
    from lemon_cli.config import custom_endpoint_key_env

    assert effective["model"]["key_env"] == custom_endpoint_key_env("office-ai")
    assert "office-secret" not in raw_text


def test_profile_seeding_is_isolated(tmp_path, monkeypatch):
    from lemon_cli.profiles import create_profile

    home = tmp_path / "home"
    profile_home = home / "profiles" / "sales"
    monkeypatch.setenv("LEMON_HOME", str(home))

    _seed(tmp_path, home)
    create_profile("sales", no_alias=True, no_skills=True)
    _seed(tmp_path, home, "sales")

    root_saved = _read_yaml(home / "config.yaml")
    profile_saved = _read_yaml(profile_home / "config.yaml")
    profile_saved["providers"]["lemon-ai-company"]["base_url"] = "https://sales.example/v1"
    profile_home.joinpath("config.yaml").write_text(yaml.safe_dump(profile_saved, sort_keys=False), encoding="utf-8")

    assert _read_yaml(home / "config.yaml")["providers"]["lemon-ai-company"]["base_url"] == "http://127.0.0.1:5173/v1"
    assert _read_yaml(profile_home / "config.yaml")["providers"]["lemon-ai-company"]["base_url"] == "https://sales.example/v1"


def test_custom_endpoint_validation_uses_saved_profile_key_for_blank_draft(tmp_path, monkeypatch):
    from lemon_cli.config import save_config, save_env_value
    from lemon_cli.profiles import create_profile
    from lemon_cli.web_models import CustomEndpointUpdate
    from lemon_cli.web_routers.config_env import _config_profile_scope, _custom_endpoint_validation_key

    home = tmp_path / "home"
    monkeypatch.setenv("LEMON_HOME", str(home))
    create_profile("sales", no_alias=True, no_skills=True)

    with _config_profile_scope("sales"):
        save_env_value("LEMON_CUSTOM_ENDPOINT_OFFICE_AI_API_KEY", "saved-profile-secret")
        save_config(
            {
                "providers": {
                    "office-ai": {
                        "name": "Office AI",
                        "base_url": "https://office.example/v1",
                        "model": "office-model",
                        "key_env": "LEMON_CUSTOM_ENDPOINT_OFFICE_AI_API_KEY",
                    }
                }
            }
        )

    assert not (home / ".env").exists()
    with _config_profile_scope("sales"):
        cfg = _read_yaml(home / "profiles" / "sales" / "config.yaml")
        key = _custom_endpoint_validation_key(
            CustomEndpointUpdate(
                id="office-ai",
                name="Office AI",
                base_url="https://office.example/v1",
                model="office-model",
            ),
            cfg,
        )

    assert key == "saved-profile-secret"

    with _config_profile_scope("sales"):
        cleared = _custom_endpoint_validation_key(
            CustomEndpointUpdate(
                id="office-ai",
                name="Office AI",
                base_url="https://office.example/v1",
                model="office-model",
                api_key="",
            ),
            cfg,
        )

    assert cleared == ""


def test_seed_save_merges_concurrent_user_config_writes(tmp_path, monkeypatch):
    from lemon_cli.config import read_user_config_raw, save_config

    home = tmp_path / "home"
    monkeypatch.setenv("LEMON_HOME", str(home))
    save_config({"ui": {"theme": "dark"}})

    module_path = (
        Path(__file__).resolve().parents[2]
        / "apps"
        / "desktop"
        / "electron"
        / "lemon-ai-harness-seed.py"
    )
    spec = importlib.util.spec_from_file_location("internal_desktop_harness_seed_merge", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    original_read = read_user_config_raw
    first_read = True

    def read_then_simulate_concurrent_write():
        nonlocal first_read
        data = original_read()
        if first_read:
            first_read = False
            save_config({"features": {"new_during_boot": True}}, merge_existing=True)
        return data

    monkeypatch.setattr("lemon_cli.config.read_user_config_raw", read_then_simulate_concurrent_write)

    result = module.seed_from_resource(_resource(tmp_path), lemon_home=home)
    saved = _read_yaml(home / "config.yaml")

    assert result["seeded_provider"] is True
    assert saved["features"]["new_during_boot"] is True
    assert saved["ui"]["theme"] == "dark"
    assert saved["providers"]["lemon-ai-company"]["key_env"] == "LEMON_AI_COMPANY_API_KEY"



def test_seed_waits_for_canonical_config_lock_before_preserving_company_row(tmp_path, monkeypatch):
    home = tmp_path / "home"
    ready = tmp_path / "writer-ready"
    monkeypatch.setenv("LEMON_HOME", str(home))

    writer = subprocess.Popen(
        [
            sys.executable,
            "-c",
            """
import os, sys, time
from pathlib import Path
os.environ['LEMON_HOME'] = sys.argv[1]
from lemon_cli.config import config_file_lock, save_config
with config_file_lock(Path(sys.argv[1]) / 'config.yaml'):
    save_config({
        'providers': {
            'lemon-ai-company': {
                'name': 'Edited Company AI',
                'base_url': 'https://edited.example/v1',
                'model': 'edited-company-model',
                'key_env': 'LEMON_CUSTOM_COMPANY_KEY',
            }
        }
    }, merge_existing=True)
    Path(sys.argv[2]).write_text('ready', encoding='utf-8')
    time.sleep(0.4)
""",
            str(home),
            str(ready),
        ],
        cwd=Path(__file__).resolve().parents[2],
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[2])},
    )
    try:
        deadline = time.time() + 5
        while not ready.exists() and time.time() < deadline:
            if writer.poll() is not None:
                raise AssertionError(f"writer exited early: {writer.returncode}")
            time.sleep(0.02)
        assert ready.exists()

        result = _seed(tmp_path, home)
    finally:
        writer.wait(timeout=5)

    saved = _read_yaml(home / "config.yaml")

    assert result == {"ok": True, "seeded_provider": False, "selected_provider": True}
    assert saved["providers"]["lemon-ai-company"] == {
        "name": "Edited Company AI",
        "base_url": "https://edited.example/v1",
        "model": "edited-company-model",
        "key_env": "LEMON_CUSTOM_COMPANY_KEY",
    }
    assert saved["model"] == {
        "provider": "lemon-ai-company",
        "default": "edited-company-model",
        "base_url": "https://edited.example/v1",
        "key_env": "LEMON_CUSTOM_COMPANY_KEY",
    }

def test_seed_rejects_profile_traversal(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("LEMON_HOME", str(home))

    with pytest.raises(ValueError):
        _seed(tmp_path, home, "../outside")

    assert not (tmp_path / "outside").exists()


def test_config_write_transaction_allows_reentrant_save_config(tmp_path, monkeypatch):
    from lemon_cli.config import config_write_transaction, save_config

    home = tmp_path / "home"
    monkeypatch.setenv("LEMON_HOME", str(home))

    with config_write_transaction(home / "config.yaml"):
        save_config({"providers": {"inside-lock": {"model": "m"}}})

    saved = _read_yaml(home / "config.yaml")
    assert saved["providers"]["inside-lock"]["model"] == "m"


def test_config_file_lock_reentrancy_is_keyed_by_config_path(tmp_path, monkeypatch):
    import lemon_cli.config as config_mod
    from lemon_cli.config import config_file_lock

    home = tmp_path / "home"
    path_a = home / "config.yaml"
    path_b = home / "profiles" / "sales" / "config.yaml"
    monkeypatch.setenv("LEMON_HOME", str(home))
    locked = []
    original_lock = config_mod._lock_config_file

    def record_lock(handle, lock):
        if lock:
            locked.append(str(Path(handle.name)))
        original_lock(handle, lock)

    monkeypatch.setattr(config_mod, "_lock_config_file", record_lock)

    with config_file_lock(path_a):
        with config_file_lock(path_b):
            pass

    assert locked == [str(path_a.with_name(".config.yaml.lock")), str(path_b.with_name(".config.yaml.lock"))]


def test_config_file_lock_initializes_fresh_lock_file(tmp_path, monkeypatch):
    from lemon_cli.config import config_file_lock

    home = tmp_path / "home"
    config_path = home / "config.yaml"
    monkeypatch.setenv("LEMON_HOME", str(home))

    with config_file_lock(config_path):
        pass

    assert config_path.with_name(".config.yaml.lock").stat().st_size >= 1


def test_seed_fallback_lock_initializes_fresh_lock_file(tmp_path):
    module_path = (
        Path(__file__).resolve().parents[2]
        / "apps"
        / "desktop"
        / "electron"
        / "lemon-ai-harness-seed.py"
    )
    spec = importlib.util.spec_from_file_location("internal_desktop_harness_seed_lock_init", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    config_path = tmp_path / "home" / "config.yaml"
    with module._compat_config_file_lock(config_path):
        pass

    assert config_path.with_name(".config.yaml.lock").stat().st_size >= 1
