"""Tests for lemon_cli.gui_uninstall — GUI-only uninstall + install discovery.

Covers the cross-platform artifact discovery, the agent/GUI detection the
desktop UI gates options on, and that ``uninstall_gui`` removes only GUI
artifacts (built renderer/release/node_modules, packaged bundle, Electron
userData) while leaving the Python agent + config/sessions/.env intact.
"""

import base64
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import lemon_cli.gui_uninstall as gu

VALID_INTERNAL_HARNESS_JSON = '{\n  "schemaVersion": 1,\n  "profile": "internal",\n  "ui": {\n    "agents": false,\n    "cron": true,\n    "messaging": false,\n    "terminal": true,\n    "webhooks": false\n  }\n}\n'


def _write_internal_harness(path: Path) -> None:
    path.write_text(VALID_INTERNAL_HARNESS_JSON, encoding="utf-8")


def _make_agent(lemon_home: Path) -> Path:
    """Create a fake agent install: source package + venv."""
    agent_root = lemon_home / "lemon-agent"
    (agent_root / "lemon_cli").mkdir(parents=True)
    (agent_root / "lemon_cli" / "__init__.py").write_text("")
    (agent_root / "venv" / "bin").mkdir(parents=True)
    return agent_root


def _make_gui_build(lemon_home: Path) -> None:
    """Create the source-built GUI artifacts a `lemon desktop` run produces."""
    desktop = lemon_home / "lemon-agent" / "apps" / "desktop"
    (desktop / "dist").mkdir(parents=True)
    (desktop / "dist" / "index.html").write_text("<html>")
    (desktop / "release" / "linux-unpacked").mkdir(parents=True)
    (desktop / "node_modules").mkdir(parents=True)
    (lemon_home / "lemon-agent" / "node_modules").mkdir(parents=True)
    (lemon_home / "desktop-build-stamp.json").write_text("{}")


def _make_user_data(lemon_home: Path) -> None:
    (lemon_home / "config.yaml").write_text("x: 1\n")
    (lemon_home / ".env").write_text("KEY=secret\n")
    (lemon_home / "sessions").mkdir()


def _create_windows_shortcut(shortcut: Path, target: Path) -> None:
    create_script = r'''
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$source = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

[ComImport]
[Guid("00021401-0000-0000-C000-000000000046")]
public class ShellLink
{
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("000214F9-0000-0000-C000-000000000046")]
public interface IShellLinkW
{
    void GetPath(
        [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile,
        int cchMaxPath,
        IntPtr pfd,
        uint fFlags);
    void GetIDList(out IntPtr ppidl);
    void SetIDList(IntPtr pidl);
    void GetDescription(
        [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName,
        int cchMaxName);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetWorkingDirectory(
        [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir,
        int cchMaxPath);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
    void GetArguments(
        [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs,
        int cchMaxPath);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
    void GetHotkey(out short pwHotkey);
    void SetHotkey(short wHotkey);
    void GetShowCmd(out int piShowCmd);
    void SetShowCmd(int iShowCmd);
    void GetIconLocation(
        [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath,
        int cchIconPath,
        out int piIcon);
    void SetIconLocation(
        [MarshalAs(UnmanagedType.LPWStr)] string pszIconPath,
        int iIcon);
    void SetRelativePath(
        [MarshalAs(UnmanagedType.LPWStr)] string pszPathRel,
        uint dwReserved);
    void Resolve(IntPtr hwnd, uint fFlags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("0000010B-0000-0000-C000-000000000046")]
public interface IPersistFile
{
    void GetClassID(out Guid pClassID);
    [PreserveSig]
    int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
    void Save(
        [MarshalAs(UnmanagedType.LPWStr)] string pszFileName,
        [MarshalAs(UnmanagedType.Bool)] bool fRemember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
}

public static class ShellLinkCom
{
    public static void Create(string shortcutPath, string targetPath)
    {
        IShellLinkW shellLink = (IShellLinkW)new ShellLink();
        shellLink.SetPath(targetPath);
        ((IPersistFile)shellLink).Save(shortcutPath, true);
    }
}
"@
Add-Type -TypeDefinition $source
[ShellLinkCom]::Create($env:TEST_SHORTCUT_PATH, $env:TEST_SHORTCUT_TARGET)
'''
    encoded_create_script = base64.b64encode(create_script.encode("utf-16le")).decode(
        "ascii"
    )
    env = {
        **os.environ,
        "TEST_SHORTCUT_PATH": str(shortcut),
        "TEST_SHORTCUT_TARGET": str(target),
    }
    result = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            encoded_create_script,
        ],
        check=False,
        capture_output=True,
        encoding="utf-8",
        env=env,
        timeout=20,
    )
    assert result.returncode == 0, (
        "failed to create Windows shortcut with IShellLinkW fixture\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


def test_gui_install_summary_shape(tmp_path, monkeypatch):
    lemon_home = tmp_path / ".lemon-ai"
    _make_agent(lemon_home)
    _make_gui_build(lemon_home)
    monkeypatch.setattr(gu, "packaged_gui_app_paths", lambda: [])
    monkeypatch.setattr(gu, "desktop_userdata_dir", lambda: tmp_path / "none")

    summary = gu.gui_install_summary(lemon_home)
    # JSON-serializable primitives the desktop UI gates on.
    assert summary["agent_installed"] is True
    assert summary["gui_installed"] is True
    assert isinstance(summary["source_built_artifacts"], list)
    assert all(isinstance(p, str) for p in summary["source_built_artifacts"])
    assert summary["lemon_home"] == str(lemon_home)
    assert summary["platform"] == sys.platform


def test_invalid_internal_env_keeps_uninstall_identity_ordinary(tmp_path, monkeypatch):
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(tmp_path / "missing.json"))

    assert gu._desktop_product_names() == ["Lemon AI"]
    assert gu._runtime_root_names() == ["lemon-agent"]


def test_internal_source_built_gui_artifacts_scope_to_lemon_root_by_default(
    tmp_path, monkeypatch
):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    lemon_home = tmp_path / ".lemon-ai"

    artifacts = gu.source_built_gui_artifacts(lemon_home)

    assert lemon_home / "lemon-agent" / "apps" / "desktop" / "release" in artifacts
    assert lemon_home / "hermes-agent" / "apps" / "desktop" / "release" not in artifacts


def test_internal_source_built_gui_artifacts_include_legacy_root_for_explicit_migration(
    tmp_path, monkeypatch
):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    monkeypatch.setenv("LEMON_DESKTOP_LEGACY_MIGRATION", "1")
    lemon_home = tmp_path / ".lemon-ai"

    artifacts = gu.source_built_gui_artifacts(lemon_home)

    assert lemon_home / "lemon-agent" / "apps" / "desktop" / "release" in artifacts
    assert lemon_home / "hermes-agent" / "apps" / "desktop" / "release" in artifacts


def test_internal_agent_detection_accepts_lemon_runtime_root(tmp_path, monkeypatch):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    lemon_home = tmp_path / ".lemon-ai"
    (lemon_home / "lemon-agent" / "lemon_cli").mkdir(parents=True)

    assert gu.agent_is_installed(lemon_home) is True


def test_ordinary_agent_detection_ignores_legacy_hermes_runtime_root(tmp_path, monkeypatch):
    monkeypatch.delenv("LEMON_DESKTOP_HARNESS_CONFIG", raising=False)
    lemon_home = tmp_path / ".lemon-ai"
    (lemon_home / "hermes-agent" / "lemon_cli").mkdir(parents=True)

    assert gu.agent_is_installed(lemon_home) is False


def test_linux_discovery_includes_launcher_entry(tmp_path, monkeypatch):
    """The launcher entry that `lemon desktop` installs is removable."""
    monkeypatch.setattr(gu.sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))

    from lemon_cli import linux_desktop_entry as lde

    assert lde.desktop_entry_path() in gu.packaged_gui_app_paths()


@pytest.mark.macos_only
def test_macos_packaged_gui_paths_are_lemon_for_ordinary_build(monkeypatch):
    monkeypatch.delenv("LEMON_DESKTOP_HARNESS_CONFIG", raising=False)

    paths = gu.packaged_gui_app_paths()

    assert paths[:2] == [
        Path("/Applications/Lemon AI.app"),
        Path.home() / "Applications" / "Lemon AI.app",
    ]


@pytest.mark.macos_only
def test_macos_packaged_gui_paths_scope_to_lemon_by_default(tmp_path, monkeypatch):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))

    paths = gu.packaged_gui_app_paths()

    assert paths == [
        Path("/Applications/Lemon AI.app"),
        Path.home() / "Applications" / "Lemon AI.app",
    ]


@pytest.mark.windows_only
def test_windows_packaged_gui_paths_are_lemon_for_ordinary_build(
    tmp_path, monkeypatch
):
    monkeypatch.delenv("LEMON_DESKTOP_HARNESS_CONFIG", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setenv("ProgramFiles", str(tmp_path / "program-files"))

    paths = gu.packaged_gui_app_paths()

    assert paths == [
        tmp_path / "local" / "Programs" / "Lemon AI",
        tmp_path / "program-files" / "Lemon AI",
    ]


@pytest.mark.macos_only
def test_macos_packaged_gui_paths_include_legacy_for_explicit_migration(tmp_path, monkeypatch):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    monkeypatch.setenv("LEMON_DESKTOP_LEGACY_MIGRATION", "1")

    paths = gu.packaged_gui_app_paths()

    assert paths == [
        Path("/Applications/Lemon AI.app"),
        Path.home() / "Applications" / "Lemon AI.app",
        Path("/Applications/Hermes.app"),
        Path.home() / "Applications" / "Hermes.app",
    ]


@pytest.mark.windows_only
def test_windows_packaged_gui_paths_scope_to_lemon_by_default(
    tmp_path, monkeypatch
):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setenv("ProgramFiles", str(tmp_path / "program-files"))

    paths = gu.packaged_gui_app_paths()

    assert paths == [
        tmp_path / "local" / "Programs" / "Lemon AI",
        tmp_path / "program-files" / "Lemon AI",
    ]


def test_windows_lemon_uninstall_ignores_existing_legacy_desktop_without_migration(
    tmp_path, monkeypatch
):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setattr(gu.sys, "platform", "win32")
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setenv("ProgramFiles", str(tmp_path / "program-files"))
    legacy_path = tmp_path / "local" / "lemon-desktop"
    legacy_path.mkdir(parents=True)

    paths = gu.packaged_gui_app_paths()

    assert legacy_path not in paths
    assert paths == [
        tmp_path / "local" / "Programs" / "Lemon AI",
        tmp_path / "program-files" / "Lemon AI",
    ]


def test_windows_lemon_uninstall_includes_existing_legacy_desktop_for_explicit_migration(
    tmp_path, monkeypatch
):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setattr(gu.sys, "platform", "win32")
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    monkeypatch.setenv("LEMON_DESKTOP_LEGACY_MIGRATION", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    legacy_path = tmp_path / "local" / "hermes-desktop"
    legacy_path.mkdir(parents=True)

    assert legacy_path in gu.packaged_gui_app_paths()


def test_windows_lemon_gui_uninstall_removes_only_lemon_shortcuts(tmp_path, monkeypatch):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setattr(gu.sys, "platform", "win32")
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))

    programs = tmp_path / "roaming" / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    desktop = tmp_path / "profile" / "Desktop"
    programs.mkdir(parents=True)
    desktop.mkdir(parents=True)
    lemon_program = programs / "Lemon AI.lnk"
    lemon_desktop = desktop / "Lemon AI.lnk"
    hermes_program = programs / "Hermes.lnk"
    hermes_desktop = desktop / "Hermes.lnk"
    for shortcut in (lemon_program, lemon_desktop, hermes_program, hermes_desktop):
        shortcut.write_text("shortcut", encoding="utf-8")
    target_map = {
        lemon_program: tmp_path / "local" / "Programs" / "Lemon AI" / "Lemon AI.exe",
        lemon_desktop: tmp_path / ".lemon-ai" / "lemon-agent" / "apps" / "desktop" / "release" / "win-unpacked" / "Lemon AI.exe",
        hermes_program: tmp_path / "local" / "Programs" / "Hermes" / "Hermes.exe",
        hermes_desktop: tmp_path / ".hermes" / "hermes-agent" / "apps" / "desktop" / "release" / "win-unpacked" / "Hermes.exe",
    }
    known_calls: list[int] = []

    def known_folder(csidl: int, fallback: Path) -> Path:
        known_calls.append(csidl)
        return programs if csidl == gu.CSIDL_PROGRAMS else desktop

    monkeypatch.setattr(gu, "_windows_known_folder_path", known_folder)
    monkeypatch.setattr(gu, "_read_windows_shortcut_target", lambda path: str(target_map[path]))

    removed = gu.uninstall_gui(tmp_path / ".lemon-ai")

    assert lemon_program in removed
    assert lemon_desktop in removed
    assert not lemon_program.exists()
    assert not lemon_desktop.exists()
    assert hermes_program.exists()
    assert hermes_desktop.exists()
    assert known_calls == [gu.CSIDL_DESKTOPDIRECTORY, gu.CSIDL_PROGRAMS]


def test_windows_shortcut_paths_keep_same_name_shortcut_targeting_other_app(
    tmp_path, monkeypatch
):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setattr(gu.sys, "platform", "win32")
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))

    programs = tmp_path / "programs"
    desktop = tmp_path / "desktop"
    programs.mkdir()
    desktop.mkdir()
    owned = programs / "Lemon AI.lnk"
    same_name_other_target = desktop / "Lemon AI.lnk"
    owned.write_text("shortcut", encoding="utf-8")
    same_name_other_target.write_text("shortcut", encoding="utf-8")

    target_map = {
        owned: tmp_path / "local" / "Programs" / "Lemon AI" / "Lemon AI.exe",
        same_name_other_target: tmp_path / "other-vendor" / "Lemon AI" / "Lemon AI.exe",
    }

    monkeypatch.setattr(
        gu,
        "_windows_known_folder_path",
        lambda csidl, fallback: programs if csidl == gu.CSIDL_PROGRAMS else desktop,
    )
    monkeypatch.setattr(gu, "_read_windows_shortcut_target", lambda path: str(target_map[path]))

    assert gu.windows_shortcut_paths(tmp_path / ".lemon-ai") == [owned]


def test_windows_shortcut_owned_matches_product_name_case_insensitively(
    tmp_path, monkeypatch
):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    shortcut = tmp_path / "lemon ai.lnk"
    target = (
        tmp_path
        / ".lemon-ai"
        / "lemon-agent"
        / "apps"
        / "desktop"
        / "release"
        / "win-unpacked"
        / "Lemon AI.exe"
    )

    monkeypatch.setattr(gu, "_read_windows_shortcut_target", lambda path: str(target))

    assert gu._windows_shortcut_owned(shortcut, tmp_path / ".lemon-ai") is True


def test_windows_known_folder_lookup_uses_unbounded_modern_api():
    source = Path(gu.__file__).read_text(encoding="utf-8")

    assert "SHGetKnownFolderPath" in source
    assert "SHGetFolderPathW" not in source
    assert "MAX_PATH" not in source


def test_windows_shortcut_target_probe_uses_encoded_script_and_env_path(
    tmp_path, monkeypatch
):
    shortcut = tmp_path / "Lemon AI $(hostile) Đặc biệt.lnk"
    expected_target = "C:\\Program Files\\Lemon AI\\Ứng dụng Lemon\\Lemon AI.exe"
    encoded_target = base64.b64encode(expected_target.encode("utf-8")).decode("ascii")
    calls = []

    class Result:
        def __init__(self) -> None:
            self.returncode = 0
            self.stdout = f"{encoded_target}\n"

    def fake_run(args, **kwargs):
        calls.append((args, kwargs))
        return Result()

    monkeypatch.setattr(gu.sys, "platform", "win32")
    monkeypatch.setattr(gu.subprocess, "run", fake_run)

    assert gu._read_windows_shortcut_target(shortcut) == expected_target
    args, kwargs = calls[0]
    assert args[:5] == [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
    ]
    decoded = gu.base64.b64decode(args[5]).decode("utf-16le")
    assert "$env:LEMON_AI_SHORTCUT_PATH" in decoded
    assert "OutputEncoding" in decoded
    assert "ShellLinkCom" in decoded
    assert "ReadTarget($p)" in decoded
    assert "WScript.Shell" not in decoded
    assert (
        "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([ShellLinkCom]::ReadTarget($p)))"
        in decoded
    )
    assert str(shortcut) not in args
    assert kwargs["env"]["LEMON_AI_SHORTCUT_PATH"] == str(shortcut)
    assert kwargs["encoding"] == "utf-8"
    assert kwargs["timeout"] == 5


@pytest.mark.parametrize("stdout", ["", "not base64"])
def test_windows_shortcut_target_probe_returns_none_for_malformed_stdout(
    tmp_path, monkeypatch, stdout
):
    class Result:
        returncode = 0

        def __init__(self) -> None:
            self.stdout = stdout

    monkeypatch.setattr(gu.sys, "platform", "win32")
    monkeypatch.setattr(gu.subprocess, "run", lambda *args, **kwargs: Result())

    assert gu._read_windows_shortcut_target(tmp_path / "Lemon AI.lnk") is None


@pytest.mark.windows_only
@pytest.mark.parametrize("csidl", [gu.CSIDL_DESKTOPDIRECTORY, gu.CSIDL_PROGRAMS])
def test_windows_known_folder_path_resolves_with_system_api(tmp_path, csidl):
    fallback = tmp_path / "known-folder-fallback"

    resolved = gu._windows_known_folder_path(csidl, fallback)

    assert resolved != fallback
    assert resolved.is_absolute()


@pytest.mark.windows_only
def test_windows_shortcut_target_probe_reads_unicode_target(tmp_path):
    target_dir = tmp_path / "Ứng dụng Lemon"
    target_dir.mkdir()
    target = target_dir / "Lemon AI.exe"
    shutil.copy2(sys.executable, target)
    shortcut = tmp_path / "Lemon AI.lnk"
    _create_windows_shortcut(shortcut, target)

    assert gu._read_windows_shortcut_target(shortcut) == str(target)


@pytest.mark.windows_only
def test_windows_packaged_gui_paths_include_legacy_for_explicit_migration(
    tmp_path, monkeypatch
):
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    monkeypatch.setenv("LEMON_DESKTOP_LEGACY_MIGRATION", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setenv("ProgramFiles", str(tmp_path / "program-files"))

    paths = gu.packaged_gui_app_paths()

    assert paths == [
        tmp_path / "local" / "Programs" / "Lemon AI",
        tmp_path / "local" / "Programs" / "Hermes",
        tmp_path / "program-files" / "Lemon AI",
        tmp_path / "program-files" / "Hermes",
    ]


def test_internal_linux_discovery_scopes_to_lemon_entry_and_icon_by_default(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(gu.sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))

    paths = gu.packaged_gui_app_paths()

    assert tmp_path / "xdg" / "applications" / "lemon-ai.desktop" in paths
    assert tmp_path / "xdg" / "applications" / "lemon.desktop" not in paths
    assert (
        tmp_path / "xdg" / "icons" / "hicolor" / "256x256" / "apps" / "lemon-ai.png"
        in paths
    )
    assert tmp_path / "xdg" / "icons" / "hicolor" / "256x256" / "apps" / "lemon.png" not in paths


def test_internal_linux_discovery_includes_legacy_entries_for_explicit_migration(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(gu.sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    config = tmp_path / "internal.json"
    _write_internal_harness(config)
    monkeypatch.setenv("LEMON_DESKTOP_HARNESS_CONFIG", str(config))
    monkeypatch.setenv("LEMON_DESKTOP_LEGACY_MIGRATION", "1")

    paths = gu.packaged_gui_app_paths()

    assert tmp_path / "xdg" / "applications" / "hermes.desktop" in paths
    assert tmp_path / "xdg" / "icons" / "hicolor" / "256x256" / "apps" / "hermes.png" in paths


def test_uninstall_removes_launcher_entry_and_refreshes_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(gu.sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))

    from lemon_cli import linux_desktop_entry as lde

    entry = lde.desktop_entry_path()
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_text("x", encoding="utf-8")

    refreshed: list[Path] = []
    monkeypatch.setattr(
        lde,
        "refresh_desktop_databases",
        lambda d: refreshed.append(d) or ["kbuildsycoca6"],
    )

    lemon_home = tmp_path / ".lemon-ai"
    _make_agent(lemon_home)
    icon = lde.icon_path(lemon_home / "lemon-agent")
    icon.parent.mkdir(parents=True, exist_ok=True)
    icon.write_bytes(b"\x89PNG")
    monkeypatch.setattr(gu, "desktop_userdata_dir", lambda: tmp_path / "none")

    removed = gu.uninstall_gui(lemon_home)

    assert entry in removed and not entry.exists()
    assert refreshed == [entry.parent]
    # The icon lives in the checkout. A GUI uninstall must not delete it.
    assert lde.icon_path(lemon_home / "lemon-agent").exists()
    # The agent itself survives a GUI uninstall.
    assert (lemon_home / "lemon-agent" / "lemon_cli").is_dir()


def test_uninstall_skips_cache_refresh_when_no_launcher_entry(tmp_path, monkeypatch):
    monkeypatch.setattr(gu.sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))

    from lemon_cli import linux_desktop_entry as lde

    refreshed: list[Path] = []
    monkeypatch.setattr(
        lde, "refresh_desktop_databases", lambda d: refreshed.append(d) or []
    )
    monkeypatch.setattr(gu, "desktop_userdata_dir", lambda: tmp_path / "none")

    gu.uninstall_gui(tmp_path / ".lemon-ai")

    assert refreshed == []


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX symlink semantics")
def test_remove_path_handles_symlink(tmp_path):
    target = tmp_path / "real"
    target.mkdir()
    link = tmp_path / "link"
    link.symlink_to(target)
    assert gu._remove_path(link) is True
    assert not link.exists()
    # The symlink is gone but its target is untouched.
    assert target.exists()


class _Args:
    """Minimal argparse-Namespace stand-in for run_uninstall."""

    def __init__(self, *, yes=False, full=False, gui=False, gui_summary=False):
        self.yes = yes
        self.full = full
        self.gui = gui
        self.gui_summary = gui_summary


def test_uninstall_args_namespace_mode_mapping():
    """_UninstallArgs maps mode → the gui/full flags run_uninstall reads."""
    import lemon_cli.uninstall as uninstall

    gui = uninstall._UninstallArgs(mode="gui")
    assert gui.gui is True and gui.full is False and gui.yes is True

    lite = uninstall._UninstallArgs(mode="lite")
    assert lite.gui is False and lite.full is False and lite.yes is True

    full = uninstall._UninstallArgs(mode="full")
    assert full.gui is False and full.full is True and full.yes is True


def test_windows_uninstall_env_cleanup_keeps_hermes_aliases_for_ordinary_lemon(
    monkeypatch,
):
    import lemon_cli.uninstall as uninstall

    monkeypatch.delenv("LEMON_DESKTOP_HARNESS_CONFIG", raising=False)
    fake = _FakeWinreg(
        {
            "LEMON_HOME": "C:\\Users\\me\\AppData\\Local\\Lemon AI",
            "LEMON_GIT_BASH_PATH": "C:\\Users\\me\\AppData\\Local\\Lemon AI\\git\\cmd\\git.exe",
            "LEMON_INSTALL_RUNTIME_DIR_NAME": "lemon-agent",
            "HERMES_HOME": "D:\\Hermes",
            "HERMES_GIT_BASH_PATH": "D:\\Hermes\\git\\cmd\\git.exe",
        }
    )
    monkeypatch.setitem(sys.modules, "winreg", fake)

    removed = uninstall.remove_lemon_env_vars_windows()

    assert removed == ["LEMON_HOME", "LEMON_INSTALL_RUNTIME_DIR_NAME", "LEMON_GIT_BASH_PATH"]
    assert "HERMES_HOME" in fake.values
    assert "HERMES_GIT_BASH_PATH" in fake.values


def test_windows_uninstall_env_cleanup_removes_hermes_aliases_when_registry_home_matches(
    monkeypatch,
):
    import lemon_cli.uninstall as uninstall

    monkeypatch.delenv("LEMON_DESKTOP_HARNESS_CONFIG", raising=False)
    monkeypatch.delenv("LEMON_DESKTOP_INTERNAL", raising=False)
    fake = _FakeWinreg(
        {
            "LEMON_HOME": "D:\\Lemon AI",
            "LEMON_GIT_BASH_PATH": "D:\\Lemon AI\\git\\cmd\\git.exe",
            "LEMON_INSTALL_RUNTIME_DIR_NAME": "lemon-agent",
            "HERMES_HOME": "D:\\Lemon AI",
            "HERMES_GIT_BASH_PATH": "D:\\Lemon AI\\git\\cmd\\git.exe",
        }
    )
    monkeypatch.setitem(sys.modules, "winreg", fake)

    removed = uninstall.remove_lemon_env_vars_windows()

    assert removed == [
        "LEMON_HOME",
        "LEMON_INSTALL_RUNTIME_DIR_NAME",
        "LEMON_GIT_BASH_PATH",
        "HERMES_HOME",
        "HERMES_GIT_BASH_PATH",
    ]
    assert fake.values == {}


def test_windows_lemon_uninstall_env_cleanup_preserves_separate_hermes_aliases(
    monkeypatch,
):
    import lemon_cli.uninstall as uninstall

    fake = _FakeWinreg(
        {
            "LEMON_HOME": "D:\\Lemon AI",
            "LEMON_GIT_BASH_PATH": "D:\\Lemon AI\\git\\cmd\\git.exe",
            "LEMON_INSTALL_RUNTIME_DIR_NAME": "lemon-agent",
            "HERMES_HOME": "C:\\Users\\me\\AppData\\Local\\hermes",
            "HERMES_GIT_BASH_PATH": "C:\\Users\\me\\AppData\\Local\\hermes\\git\\cmd\\git.exe",
        }
    )
    monkeypatch.setitem(sys.modules, "winreg", fake)

    removed = uninstall.remove_lemon_env_vars_windows(Path("D:\\Lemon AI"))

    assert removed == ["LEMON_HOME", "LEMON_INSTALL_RUNTIME_DIR_NAME", "LEMON_GIT_BASH_PATH"]
    assert fake.values == {
        "HERMES_HOME": "C:\\Users\\me\\AppData\\Local\\hermes",
        "HERMES_GIT_BASH_PATH": "C:\\Users\\me\\AppData\\Local\\hermes\\git\\cmd\\git.exe",
    }


def test_windows_lemon_uninstall_env_cleanup_removes_system_git_alias(monkeypatch):
    import lemon_cli.uninstall as uninstall

    lemon_home = Path("C:\\Users\\me\\AppData\\Local\\lemon")
    fake = _FakeWinreg(
        {
            "LEMON_HOME": str(lemon_home),
            "LEMON_GIT_BASH_PATH": "C:\\Program Files\\Git\\cmd\\git.exe",
        }
    )
    monkeypatch.setitem(sys.modules, "winreg", fake)

    removed = uninstall.remove_lemon_env_vars_windows(lemon_home)

    assert removed == ["LEMON_HOME", "LEMON_GIT_BASH_PATH"]
    assert fake.values == {}


class _FakeKey:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeWinreg:
    HKEY_CURRENT_USER = object()
    KEY_READ = 1
    KEY_WRITE = 2
    REG_SZ = 1

    def __init__(self, values: dict[str, str]):
        self.values = dict(values)

    def OpenKey(self, *args):
        return _FakeKey()

    def QueryValueEx(self, key, name):
        if name not in self.values:
            raise FileNotFoundError(name)
        return self.values[name], self.REG_SZ

    def DeleteValue(self, key, name):
        if name not in self.values:
            raise FileNotFoundError(name)
        del self.values[name]
