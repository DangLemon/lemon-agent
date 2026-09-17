from pathlib import Path


def test_windows_native_install_path_docs_match_installer() -> None:
    doc = Path("website/docs/user-guide/windows-native.md").read_text()
    install = Path("scripts/install.ps1").read_text()

    # The launchers live in the managed binary dir OUTSIDE the git checkout
    # (LEMON_HOME\bin, next to the managed uv) — NOT the whole venv\Scripts
    # (which would shadow the user's python, #83797) and NOT a dir inside
    # the checkout (which `lemon update`'s autostash swept off disk).
    assert "%LOCALAPPDATA%\\lemon\\bin" in doc
    assert (
        "Get-Command lemon        # should print "
        "C:\\Users\\<you>\\AppData\\Local\\lemon\\bin\\lemon.cmd"
    ) in doc
    # Installer exposes $LemonHome\bin through repository-aware .cmd wrappers.
    # The executable launchers stay inside venv\Scripts so PATH never exposes
    # that whole directory (and therefore never shadows the user's Python).
    assert '$lemonBin = "$LemonHome\\bin"' in install
    assert 'foreach ($launcher in @("lemon", "lemon-acp"))' in install
    assert '$cmd = Join-Path $Destination "$launcher.cmd"' in install
    assert '$shadowingExe = Join-Path $Destination "$launcher.exe"' in install
    # Guard against regressions to either legacy layout.
    assert '$lemonBin = "$InstallDir\\venv\\Scripts"' not in install
    assert '$lemonBin = "$InstallDir\\bin"' not in install
