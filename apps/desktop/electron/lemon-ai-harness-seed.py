#!/usr/bin/env python3
"""Seed the Lemon AI editable provider before the Desktop backend starts."""

from __future__ import annotations

import argparse
import json
import contextlib
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterator


COMPANY_PROVIDER_ID = "lemon-ai-company"



def _ensure_lock_byte(handle) -> None:
    handle.seek(0, os.SEEK_END)
    if handle.tell() == 0:
        handle.write(b"0")
        handle.flush()
    handle.seek(0)


@contextlib.contextmanager
def _compat_config_file_lock(config_path: Path) -> Iterator[None]:
    lock_path = config_path.with_name(f".{config_path.name}.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as handle:
        _ensure_lock_byte(handle)
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

def _target_home(lemon_home: Path, profile: str) -> Path:
    key = (profile or "").strip()
    if not key:
        return lemon_home

    from lemon_cli.profiles import normalize_profile_name, validate_profile_name

    canon = normalize_profile_name(key)
    validate_profile_name(canon)
    if canon == "default":
        return lemon_home

    profiles_root = (lemon_home / "profiles").resolve()
    target = (profiles_root / canon).resolve()
    try:
        target.relative_to(profiles_root)
    except ValueError as exc:
        raise ValueError(f"Profile {profile!r} escapes Lemon AI profiles directory") from exc
    return target


def _provider_id(raw: Any) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", str(raw or "").strip().lower()).strip("-_")


def _complete_model_selection(raw: Dict[str, Any]) -> bool:
    model = raw.get("model")
    if not isinstance(model, dict):
        return False
    provider = str(model.get("provider") or "").strip()
    default = str(model.get("default") or model.get("name") or "").strip()
    return bool(provider and default)


def _has_non_company_endpoint(raw: Dict[str, Any], company_id: str) -> bool:
    providers = raw.get("providers")
    if isinstance(providers, dict):
        for provider_id, entry in providers.items():
            if _provider_id(provider_id) != company_id and isinstance(entry, dict):
                return True

    legacy = raw.get("custom_providers")
    if isinstance(legacy, list):
        return any(isinstance(entry, dict) for entry in legacy)

    return False



def _seed_config(raw: Dict[str, Any], initial: Dict[str, Any]) -> tuple[Dict[str, Any], Dict[str, bool]]:
    company_id = _provider_id(initial.get("id") or COMPANY_PROVIDER_ID) or COMPANY_PROVIDER_ID
    providers = raw.get("providers")
    if not isinstance(providers, dict):
        providers = {}

    complete_selection = _complete_model_selection(raw)
    has_user_endpoint = _has_non_company_endpoint(raw, company_id)
    seeded_provider = company_id not in {_provider_id(key) for key in providers}
    selected_provider = False

    if seeded_provider:
        providers[company_id] = _provider_entry(initial)
        raw["providers"] = providers

    if not complete_selection and not has_user_endpoint:
        entry = providers.get(company_id)
        if isinstance(entry, dict):
            raw["model"] = {
                "provider": company_id,
                "default": str(entry.get("model") or initial["model"]).strip(),
                "base_url": str(entry.get("base_url") or initial["base_url"]).strip().rstrip("/"),
                "key_env": str(entry.get("key_env") or initial["key_env"]).strip(),
            }
            selected_provider = True

    return raw, {"ok": True, "seeded_provider": seeded_provider, "selected_provider": selected_provider}


def _clear_config_caches(config_mod: Any, managed_scope: Any) -> None:
    config_mod._LOAD_CONFIG_CACHE.clear()
    config_mod._RAW_CONFIG_CACHE.clear()
    managed_scope.invalidate_managed_cache()

def _provider_entry(initial: Dict[str, Any]) -> Dict[str, Any]:
    model = str(initial["model"]).strip()
    entry: Dict[str, Any] = {
        "name": str(initial["name"]).strip(),
        "base_url": str(initial["base_url"]).strip().rstrip("/"),
        "model": model,
        "discover_models": bool(initial.get("discover_models", True)),
        "key_env": str(initial["key_env"]).strip(),
    }
    models: Dict[str, Dict[str, Any]] = {}
    for candidate in [*(initial.get("models") or []), model]:
        model_id = str(candidate or "").strip()
        if model_id:
            models.setdefault(model_id, {})
    if models:
        entry["models"] = models
    context_length = initial.get("context_length")
    if isinstance(context_length, int) and context_length > 0:
        entry["context_length"] = context_length
        models.setdefault(model, {})["context_length"] = context_length
    return entry


def seed_from_resource(resource_path: Path | str, *, hermes_home: Path | str | None = None, lemon_home: Path | str | None = None, profile: str = "") -> Dict[str, bool]:
    resource = json.loads(Path(resource_path).read_text(encoding="utf-8"))
    initial = resource.get("initialProvider")
    if not isinstance(initial, dict):
        return {"ok": True, "seeded_provider": False, "selected_provider": False}

    selected_home = lemon_home if lemon_home is not None else hermes_home
    if selected_home is None:
        raise ValueError("Lemon AI home is required")
    root_home = Path(selected_home)
    os.environ["LEMON_HOME"] = str(root_home)
    os.environ["HERMES_HOME"] = str(root_home)
    target_home = _target_home(root_home, profile)
    os.environ["LEMON_HOME"] = str(target_home)
    os.environ["HERMES_HOME"] = str(target_home)

    from lemon_cli import config as config_mod
    from lemon_cli import managed_scope
    from lemon_cli.config import read_user_config_raw, save_config
    try:
        from lemon_cli.config import config_write_transaction
    except ImportError:
        config_write_transaction = _compat_config_file_lock

    with config_write_transaction(target_home / "config.yaml"):
        _clear_config_caches(config_mod, managed_scope)
        next_raw, result = _seed_config(read_user_config_raw(), initial)
        if result["seeded_provider"] or result["selected_provider"]:
            save_config(next_raw, merge_existing=True)
        return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resource", required=True)
    parser.add_argument("--lemon-home")
    parser.add_argument("--hermes-home")
    parser.add_argument("--profile", default="")
    args = parser.parse_args()
    result = seed_from_resource(args.resource, lemon_home=args.lemon_home, hermes_home=args.hermes_home, profile=args.profile)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
