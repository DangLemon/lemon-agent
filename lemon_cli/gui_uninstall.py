"""Lemon AI (Chat GUI) uninstaller: removes only GUI state — built Electron artifacts, the packaged
app, and the desktop's own ``userData`` — never agent source, venv, config, sessions or .env."""

import base64
import binascii
import os
import shutil
import subprocess
import sys
from pathlib import Path
from uuid import UUID

from lemon_constants import get_lemon_home

from lemon_cli.colors import Colors, color


def _logger(mark: str, col: str):
    return lambda msg: print(f"{color(mark, col)} {msg}")


log_info, log_success = _logger("→", Colors.CYAN), _logger("✓", Colors.GREEN)
log_warn = _logger("⚠", Colors.YELLOW)

CSIDL_PROGRAMS = 0x0002
CSIDL_DESKTOPDIRECTORY = 0x0010
_KNOWN_FOLDER_IDS = {
    CSIDL_PROGRAMS: "A77F5D77-2E2B-44C3-A6A2-ABA601054A51",
    CSIDL_DESKTOPDIRECTORY: "B4BFCC3A-DB2C-424C-B029-7FE99A87C641",
}


def _env_dir(var: str, fallback: Path) -> Path:
    """``Path($var)`` when the env var is set, else *fallback*."""
    return Path(value) if (value := os.environ.get(var)) else fallback


def _internal_desktop_build() -> bool:
    from lemon_cli.desktop_identity import internal_desktop_build

    return internal_desktop_build()


def _legacy_desktop_cleanup_enabled() -> bool:
    """Return true only when a caller explicitly requests legacy cleanup.

    Lemon AI and the legacy Hermes desktop can coexist on one machine.  An
    uninstall must therefore be scoped to Lemon by default; deleting
    the old product is an explicit migration action rather than an implicit
    side effect of removing Lemon.
    """
    return os.environ.get("LEMON_DESKTOP_LEGACY_MIGRATION", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _desktop_product_names() -> "list[str]":
    return ["Lemon AI", "Hermes"] if _legacy_desktop_cleanup_enabled() else ["Lemon AI"]


def _runtime_root_names() -> "list[str]":
    return ["lemon-agent", "hermes-agent"] if _legacy_desktop_cleanup_enabled() else ["lemon-agent"]


def _desktop_userdata_path(product_name: str) -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / product_name
    if sys.platform == "win32":
        return _env_dir("APPDATA", home / "AppData" / "Roaming") / product_name
    return _env_dir("XDG_CONFIG_HOME", home / ".config") / product_name


def desktop_userdata_dir() -> Path:
    """Primary Electron ``app.getPath('userData')`` for the active desktop product."""
    return _desktop_userdata_path(_desktop_product_names()[0])


def desktop_userdata_dirs() -> "list[Path]":
    """Electron userData dirs owned by the active product.

    Legacy Hermes data is included only when explicit migration cleanup is
    enabled; normal Lemon uninstall stays scoped to Lemon AI.
    """
    return [_desktop_userdata_path(name) for name in _desktop_product_names()]


def source_built_gui_artifacts(lemon_home: Path) -> "list[Path]":
    """GUI build artifacts produced by ``lemon desktop`` inside the active runtime checkout.

    The Python agent runs from source + venv and never needs the Electron build
    output or node_modules (the workspace-root node_modules only carries
    Electron, ~200MB). Internal Lemon AI builds remove Lemon artifacts first and
    include legacy Hermes GUI artifacts only during an explicit migration.
    """
    artifacts: list[Path] = [lemon_home / "desktop-build-stamp.json"]
    for root_name in _runtime_root_names():
        agent_root = lemon_home / root_name
        desktop_dir = agent_root / "apps" / "desktop"
        artifacts.extend([
            desktop_dir / "dist",
            desktop_dir / "release",
            desktop_dir / "node_modules",
            agent_root / "node_modules",
        ])
    return artifacts


def packaged_gui_app_paths() -> "list[Path]":
    """Standard install locations of the packaged desktop distributable for the current OS. Every candidate
    is returned; the caller filters to those that exist. Never globs system-wide — only the well-known
    electron-builder output locations for the Lemon AI/Hermes desktop product."""
    home = Path.home()
    names = _desktop_product_names()
    if sys.platform == "darwin":
        return [
            path
            for name in names
            for path in (
                Path("/Applications") / f"{name}.app",
                home / "Applications" / f"{name}.app",
            )
        ]
    if sys.platform == "win32":
        local_base = _env_dir("LOCALAPPDATA", home / "AppData" / "Local")
        # NSIS per-user install (perMachine=false), an older/alternate layout, NSIS per-machine (needs admin).
        program_files = os.environ.get("ProgramFiles")
        paths = [path for name in names for path in (local_base / "Programs" / name,)]
        if _legacy_desktop_cleanup_enabled() and (local_base / "hermes-desktop").exists():
            paths.append(local_base / "hermes-desktop")
        if program_files:
            paths.extend(Path(program_files) / name for name in names)
        return paths
    # Linux: an AppImage lives wherever the user put it and deb/rpm files belong to the package manager
    # (see the hint in ``uninstall_gui``), so only the desktop entry + hicolor icons are cleaned here.
    from lemon_cli.linux_desktop_entry import desktop_entry_path

    data_base = _env_dir("XDG_DATA_HOME", home / ".local" / "share")
    icons = data_base / "icons" / "hicolor"
    # Remove the active entry.  Older installers wrote ``Hermes.desktop`` with
    # a capital H; include those spellings only for an explicit migration so a
    # Lemon uninstall cannot remove an independent Hermes installation.
    entry_names = [desktop_entry_path().name]
    if _legacy_desktop_cleanup_enabled():
        entry_names.extend(("hermes.desktop", "Hermes.desktop"))
    entry_paths = list(
        dict.fromkeys(data_base / "applications" / name for name in entry_names)
    )
    icon_names = ["lemon-ai.png"] if _internal_desktop_build() else ["lemon.png"]
    if _legacy_desktop_cleanup_enabled():
        icon_names.append("hermes.png")
    icon_paths = [
        icons / size / "apps" / icon_name
        for size in (
            "scalable",
            "24x24",
            "32x32",
            "48x48",
            "256x256",
            "512x512",
            "1024x1024",
        )
        for icon_name in icon_names
    ]
    return [*entry_paths, *icon_paths]


def _windows_known_folder_path(csidl: int, fallback: Path) -> Path:
    if sys.platform != "win32":
        return fallback

    folder_id_text = _KNOWN_FOLDER_IDS.get(csidl)
    if not folder_id_text:
        return fallback

    allocated_path = None
    try:
        import ctypes
        from ctypes import wintypes

        class Guid(ctypes.Structure):
            _fields_ = [
                ("data1", wintypes.DWORD),
                ("data2", wintypes.WORD),
                ("data3", wintypes.WORD),
                ("data4", wintypes.BYTE * 8),
            ]

        folder_id = Guid.from_buffer_copy(UUID(folder_id_text).bytes_le)
        path_ptr = ctypes.c_wchar_p()
        shell32 = ctypes.windll.shell32
        shell32.SHGetKnownFolderPath.argtypes = [
            ctypes.POINTER(Guid),
            wintypes.DWORD,
            wintypes.HANDLE,
            ctypes.POINTER(ctypes.c_wchar_p),
        ]
        shell32.SHGetKnownFolderPath.restype = ctypes.c_long
        result = shell32.SHGetKnownFolderPath(
            ctypes.byref(folder_id), 0, None, ctypes.byref(path_ptr)
        )
        allocated_path = ctypes.cast(path_ptr, ctypes.c_void_p)
        resolved = Path(path_ptr.value) if result == 0 and path_ptr.value else fallback
    except Exception:
        return fallback
    finally:
        if allocated_path and allocated_path.value:
            try:
                ole32 = ctypes.windll.ole32
                ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
                ole32.CoTaskMemFree(allocated_path)
            except Exception:
                pass

    return resolved


def _read_windows_shortcut_target(path: Path) -> "str | None":
    if sys.platform != "win32":
        return None

    script = r'''
[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
$p=$env:LEMON_AI_SHORTCUT_PATH
if ([string]::IsNullOrWhiteSpace($p)) { exit 1 }
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
    public static string ReadTarget(string shortcutPath)
    {
        IShellLinkW link = (IShellLinkW)new ShellLink();
        ((IPersistFile)link).Load(shortcutPath, 0);
        var buffer = new StringBuilder(32768);
        link.GetPath(buffer, buffer.Capacity, IntPtr.Zero, 0);
        return buffer.ToString();
    }
}
"@
Add-Type -TypeDefinition $source
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([ShellLinkCom]::ReadTarget($p))))
'''
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    env = {**os.environ, "LEMON_AI_SHORTCUT_PATH": str(path)}

    try:
        result = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                encoded,
            ],
            capture_output=True,
            check=False,
            encoding="utf-8",
            env=env,
            timeout=5,
        )
    except Exception:
        return None

    if result.returncode != 0:
        return None

    encoded_target = result.stdout.strip()
    if not encoded_target:
        return None
    try:
        target = base64.b64decode(encoded_target, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return None
    return target or None


def _path_is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _windows_shortcut_install_roots(lemon_home: Path) -> "list[Path]":
    return [
        *packaged_gui_app_paths(),
        *[
            lemon_home / root_name / "apps" / "desktop" / "release"
            for root_name in _runtime_root_names()
        ],
    ]


def _windows_shortcut_owned(path: Path, lemon_home: Path) -> bool:
    if path.name.casefold() not in {
        f"{name}.lnk".casefold() for name in _desktop_product_names()
    }:
        return False

    target = _read_windows_shortcut_target(path)
    if not target:
        return False

    target_path = Path(target)
    return any(
        _path_is_relative_to(target_path, root)
        for root in _windows_shortcut_install_roots(lemon_home)
    )


def windows_shortcut_paths(lemon_home: "Path | None" = None) -> "list[Path]":
    """Return shortcuts owned by the active desktop product on Windows.

    The PowerShell installer creates one link in the user's Start Menu
    ``Programs`` folder and one on the user's Desktop. A same-name shortcut is
    removable only when its TargetPath points inside the active install roots.
    """
    if sys.platform != "win32":
        return []

    home = lemon_home if lemon_home is not None else get_lemon_home()
    appdata = _env_dir("APPDATA", Path.home() / "AppData" / "Roaming")
    desktop = _windows_known_folder_path(
        CSIDL_DESKTOPDIRECTORY,
        _env_dir("USERPROFILE", Path.home()) / "Desktop",
    )
    programs = _windows_known_folder_path(
        CSIDL_PROGRAMS,
        appdata / "Microsoft" / "Windows" / "Start Menu" / "Programs",
    )

    return [
        path
        for name in _desktop_product_names()
        for path in (programs / f"{name}.lnk", desktop / f"{name}.lnk")
        if path.exists() and _windows_shortcut_owned(path, home)
    ]


def agent_is_installed(lemon_home: Path) -> bool:
    """True when a usable Python agent install exists under LEMON_HOME (gates the desktop UI's options).
    Package source or a venv alone is enough — a source checkout without a venv is still "the agent is here"."""
    return any(
        (lemon_home / root / sub).is_dir()
        for root in _runtime_root_names()
        for sub in ("lemon_cli", "venv", ".venv")
    )


def gui_is_installed(lemon_home: Path) -> bool:
    """Return True when any desktop GUI artifact exists (built or packaged)."""
    return any(
        p.exists()
        for p in (
            *source_built_gui_artifacts(lemon_home),
            *packaged_gui_app_paths(),
            *desktop_userdata_dirs(),
        )
    )


def gui_install_summary(lemon_home: "Path | None" = None) -> dict:
    """JSON-serializable snapshot of what's installed, for the desktop UI to render via IPC."""
    home: Path = lemon_home if lemon_home is not None else get_lemon_home()
    userdata = desktop_userdata_dir()
    return {
        "lemon_home": str(home),
        "agent_installed": agent_is_installed(home),
        "gui_installed": gui_is_installed(home),
        "source_built_artifacts": [
            str(p) for p in source_built_gui_artifacts(home) if p.exists()
        ],
        "packaged_app_paths": [str(p) for p in packaged_gui_app_paths() if p.exists()],
        "userdata_dir": str(userdata),
        "userdata_exists": userdata.exists(),
        "platform": sys.platform,
    }


def _remove_path(path: Path) -> bool:
    """Remove a file or directory tree. Returns True when something was removed."""
    try:
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)
        else:
            return False
        return True
    except Exception as e:
        log_warn(f"Could not remove {path}: {e}")
        return False


def uninstall_gui(
    lemon_home: "Path | None" = None, *, remove_userdata: bool = True
) -> "list[Path]":
    """Remove the desktop GUI's artifacts, leaving the agent + user data intact."""
    home: Path = lemon_home if lemon_home is not None else get_lemon_home()
    removed: list[Path] = []

    def _remove_existing(paths) -> bool:
        """Remove every existing path; True when at least one existed."""
        found = False
        for path in (p for p in paths if p.exists()):
            found = True
            if _remove_path(path):
                log_success(f"Removed {path}")
                removed.append(path)
        return found

    log_info("Removing built GUI artifacts (renderer, release, node_modules)...")
    _remove_existing(source_built_gui_artifacts(home))
    log_info("Removing installed desktop app...")
    if not _remove_existing(packaged_gui_app_paths()):
        log_info("No packaged desktop app found in standard locations")
    if sys.platform == "win32":
        log_info("Removing desktop shortcuts...")
        if not _remove_existing(windows_shortcut_paths(home)):
            log_info("No desktop shortcuts found in standard locations")
    if remove_userdata:
        userdatas = [path for path in desktop_userdata_dirs() if path.exists()]
        if userdatas:
            log_info("Removing desktop app data (Electron userData)...")
            _remove_existing(userdatas)
    if not removed:
        log_info("No desktop GUI artifacts found to remove")
    if sys.platform.startswith("linux"):
        # The desktop entry was removed above but the menu caches still list it; reindex so Lemon AI
        # disappears from the launcher.
        try:
            from lemon_cli.linux_desktop_entry import refresh_desktop_databases

            app_dirs = {
                path.parent for path in removed if path.parent.name == "applications"
            }
            for app_dir in sorted(app_dirs):
                for tool in refresh_desktop_databases(app_dir):
                    log_success(f"Refreshed the application menu cache ({tool})")
        except Exception as e:
            log_warn(f"Could not refresh the application menu cache: {e}")
        package_name = "lemon-ai" if _internal_desktop_build() else "lemon"
        log_info(
            "If you installed the desktop via a .deb / .rpm package, remove it with your package manager "
            f"(e.g. 'sudo apt remove {package_name}' or 'sudo dnf remove {package_name}'). AppImage builds are a single "
            "file you can delete from wherever you saved it."
        )
    return removed
