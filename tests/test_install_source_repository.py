"""Installer source-repository behavior for internal Desktop builds."""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import textwrap
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
INSTALL_SH = REPO_ROOT / "scripts" / "install.sh"
INSTALL_PS1 = REPO_ROOT / "scripts" / "install.ps1"
REAL_GIT = shutil.which("git")


def run(cmd: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)


def git(cmd: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> str:
    return run([REAL_GIT or "git", *cmd], cwd=cwd, env=env).stdout.strip()


def origin_url(cwd: Path) -> str:
    return git(["config", "--get", "remote.origin.url"], cwd=cwd)


def create_remote(tmp_path: Path, repository: str, *, marker: str, tag: str | None = None) -> tuple[Path, str]:
    work = tmp_path / "work" / repository.replace("/", "__")
    bare = tmp_path / "remotes" / f"{repository}.git"
    work.mkdir(parents=True)
    bare.parent.mkdir(parents=True)

    git(["init", "-b", "main"], cwd=work)
    git(["config", "user.email", "installer-test@example.com"], cwd=work)
    git(["config", "user.name", "Installer Test"], cwd=work)
    (work / "README.md").write_text(f"{marker}\n", encoding="utf-8")
    git(["add", "README.md"], cwd=work)
    git(["commit", "-m", "initial"], cwd=work)
    if tag:
        git(["tag", tag], cwd=work)
    commit = git(["rev-parse", "HEAD"], cwd=work)
    run([REAL_GIT or "git", "clone", "--bare", str(work), str(bare)])
    return bare, commit


def write_gitconfig(tmp_path: Path, remotes: dict[str, Path]) -> Path:
    config = tmp_path / "gitconfig"
    lines: list[str] = []
    for repository, bare in remotes.items():
        lines.extend(
            [
                f'[url "file://{bare}"]',
                f"    insteadOf = https://github.com/{repository}.git",
                f"    insteadOf = git@github.com:{repository}.git",
            ]
        )
    config.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return config


def installer_env(tmp_path: Path, gitconfig: Path, *, extra_path: Path | None = None) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "GIT_CONFIG_GLOBAL": str(gitconfig),
            "HOME": str(tmp_path / "home"),
            "LEMON_HOME": str(tmp_path / "lemon-home"),
        }
    )
    if extra_path:
        env["PATH"] = f"{extra_path}{os.pathsep}{env['PATH']}"
    return env


def run_repository_stage(
    tmp_path: Path,
    *,
    gitconfig: Path,
    install_dir: Path,
    install_script: Path = INSTALL_SH,
    repository: str | None = None,
    commit: str | None = None,
    tag: str | None = None,
    extra_path: Path | None = None,
    extra_env: dict[str, str] | None = None,
    check: bool = False,
) -> subprocess.CompletedProcess[str]:
    cmd = [
        "bash",
        str(install_script),
        "--stage",
        "repository",
        "--non-interactive",
        "--json",
        "--dir",
        str(install_dir),
        "--lemon-home",
        str(tmp_path / "lemon-home"),
    ]
    if repository:
        cmd.extend(["--repo", repository])
    if commit:
        cmd.extend(["--commit", commit])
    if tag:
        cmd.extend(["--tag", tag])

    env = installer_env(tmp_path, gitconfig, extra_path=extra_path)
    env.update(extra_env or {})
    result = subprocess.run(
        cmd,
        cwd=tmp_path,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if check and result.returncode != 0:
        raise AssertionError(result.stdout)
    return result


def copy_raw_install_sh(tmp_path: Path) -> Path:
    raw_script = tmp_path / "raw-install.sh"
    raw_script.write_text(INSTALL_SH.read_text(encoding="utf-8"), encoding="utf-8")
    raw_script.chmod(raw_script.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return raw_script


def write_fake_windows_uname(tmp_path: Path) -> Path:
    bin_dir = tmp_path / "fake-windows-bin"
    bin_dir.mkdir()
    uname = bin_dir / "uname"
    uname.write_text("#!/bin/sh\nprintf 'MINGW64_NT-10.0\\n'\n", encoding="utf-8")
    uname.chmod(uname.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return bin_dir


def run_raw_install_sh_on_fake_windows(
    tmp_path: Path, *, repository: str | None = None
) -> subprocess.CompletedProcess[str]:
    raw_script = copy_raw_install_sh(tmp_path)
    env = os.environ.copy()
    env.update({"HOME": str(tmp_path / "home")})
    env["PATH"] = f"{write_fake_windows_uname(tmp_path)}{os.pathsep}{env['PATH']}"
    if repository is not None:
        env["LEMON_INSTALL_REPOSITORY"] = repository
    return subprocess.run(
        ["bash", str(raw_script), "--non-interactive"],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def test_install_sh_windows_handoff_uses_lemon_powershell_installer_by_default(
    tmp_path: Path,
) -> None:
    result = run_raw_install_sh_on_fake_windows(tmp_path)

    assert result.returncode == 1
    assert "iex (irm https://raw.githubusercontent.com/DangLemon/lemon-agent/main/scripts/install.ps1)" in result.stdout
    assert "NousResearch/hermes-agent" not in result.stdout


def test_install_sh_windows_handoff_uses_configured_powershell_installer(
    tmp_path: Path,
) -> None:
    result = run_raw_install_sh_on_fake_windows(
        tmp_path, repository="ExampleOrg/internal-agent"
    )

    assert result.returncode == 1
    assert (
        "& ([scriptblock]::Create((irm "
        "https://raw.githubusercontent.com/ExampleOrg/internal-agent/main/scripts/install.ps1))) "
        "-Repository 'ExampleOrg/internal-agent'"
    ) in result.stdout
    assert "https://raw.githubusercontent.com/DangLemon/lemon-agent/main/scripts/install.ps1" not in result.stdout


def test_install_sh_raw_script_defaults_to_lemon_without_network(tmp_path: Path) -> None:
    internal, _ = create_remote(tmp_path, "DangLemon/lemon-agent", marker="internal")
    gitconfig = write_gitconfig(tmp_path, {"DangLemon/lemon-agent": internal})
    install_dir = tmp_path / "install"
    raw_script = copy_raw_install_sh(tmp_path)

    result = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=install_dir,
        install_script=raw_script,
        check=True,
    )

    assert '"ok":true' in result.stdout.replace(" ", "")
    assert (install_dir / "README.md").read_text(encoding="utf-8") == "internal\n"
    assert origin_url(install_dir) == "git@github.com:DangLemon/lemon-agent.git"


def test_install_sh_internal_fresh_clone_defaults_to_lemon_repository(tmp_path: Path) -> None:
    internal, _ = create_remote(tmp_path, "DangLemon/lemon-agent", marker="internal")
    gitconfig = write_gitconfig(tmp_path, {"DangLemon/lemon-agent": internal})
    install_dir = tmp_path / "install"

    result = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=install_dir,
        extra_env={"LEMON_DESKTOP_INTERNAL": "1"},
        check=True,
    )

    assert '"ok":true' in result.stdout.replace(" ", "")
    assert (install_dir / "README.md").read_text(encoding="utf-8") == "internal\n"
    assert origin_url(install_dir) == "git@github.com:DangLemon/lemon-agent.git"


def test_install_sh_checkout_manifest_defaults_to_lemon_repository(tmp_path: Path) -> None:
    internal, _ = create_remote(tmp_path, "DangLemon/lemon-agent", marker="internal")
    gitconfig = write_gitconfig(tmp_path, {"DangLemon/lemon-agent": internal})
    install_dir = tmp_path / "install"

    result = run_repository_stage(tmp_path, gitconfig=gitconfig, install_dir=install_dir, check=True)

    assert '"ok":true' in result.stdout.replace(" ", "")
    assert (install_dir / "README.md").read_text(encoding="utf-8") == "internal\n"
    assert origin_url(install_dir) == "git@github.com:DangLemon/lemon-agent.git"


def test_install_sh_checkout_manifest_reports_lemon_stage_titles(tmp_path: Path) -> None:
    env = os.environ.copy()
    env.update({"HOME": str(tmp_path / "home")})

    result = subprocess.run(
        ["bash", str(INSTALL_SH), "--manifest", "--include-desktop"],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
    )

    manifest = json.loads(result.stdout)
    titles = {stage["name"]: stage["title"] for stage in manifest["stages"]}
    assert titles["repository"] == "Tải Lemon AI"
    assert titles["path"] == "Cài lệnh terminal"
    assert titles["config"] == "Chuẩn bị cấu hình Lemon AI và skills"
    assert titles["setup"] == "Cấu hình API key và cài đặt Lemon AI"
    assert titles["gateway"] == "Cấu hình gateway Lemon AI"
    assert titles["desktop"] == "Build app Lemon AI"
    assert titles["complete"] == "Hoàn tất cài Lemon AI"
    assert [stage["name"] for stage in manifest["stages"]] == [
        "prerequisites",
        "repository",
        "venv",
        "python-deps",
        "node-deps",
        "path",
        "config",
        "setup",
        "gateway",
        "desktop",
        "complete",
    ]


def test_install_sh_raw_manifest_reports_lemon_stage_titles(tmp_path: Path) -> None:
    env = os.environ.copy()
    env.update({"HOME": str(tmp_path / "home")})
    raw_script = copy_raw_install_sh(tmp_path)

    result = subprocess.run(
        ["bash", str(raw_script), "--manifest", "--include-desktop"],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
    )

    manifest = json.loads(result.stdout)
    titles = {stage["name"]: stage["title"] for stage in manifest["stages"]}
    assert titles["repository"] == "Tải Lemon AI"
    assert titles["path"] == "Cài lệnh terminal"
    assert titles["config"] == "Chuẩn bị cấu hình Lemon AI và skills"
    assert titles["setup"] == "Cấu hình API key và cài đặt Lemon AI"
    assert titles["gateway"] == "Cấu hình gateway Lemon AI"
    assert titles["desktop"] == "Build app Lemon AI"
    assert titles["complete"] == "Hoàn tất cài Lemon AI"


def test_install_sh_checkout_manifest_reports_lemon_help_text(tmp_path: Path) -> None:
    env = os.environ.copy()
    env.update({"HOME": str(tmp_path / "home")})

    result = subprocess.run(
        ["bash", str(INSTALL_SH), "--help"],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
    )

    assert result.stdout.startswith("Lemon AI Installer\n")
    assert "When running as root on Linux, Lemon AI installs the code under" in result.stdout
    assert "/usr/local/bin/lemon" in result.stdout
    assert "Hermes Installer" not in result.stdout


def test_install_sh_raw_script_reports_lemon_help_text(tmp_path: Path) -> None:
    env = os.environ.copy()
    env.update({"HOME": str(tmp_path / "home")})
    raw_script = copy_raw_install_sh(tmp_path)

    result = subprocess.run(
        ["bash", str(raw_script), "--help"],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
    )

    assert result.stdout.startswith("Lemon AI Installer\n")
    assert "When running as root on Linux, Lemon AI installs the code under" in result.stdout
    assert "/usr/local/bin/lemon" in result.stdout


def test_install_sh_banner_uses_internal_brand(tmp_path: Path) -> None:
    script = f"""
set -e
MAGENTA=
BOLD=
NC=
INTERNAL_DESKTOP_BUILD=true
INSTALLER_DISPLAY_NAME="Lemon AI Installer"
INSTALLER_DESCRIPTION="Internal AI desktop harness by Lemon Digital."
eval "$(sed -n '/^print_banner()/,/^}}/p' {INSTALL_SH!s})"
print_banner
"""

    result = subprocess.run(["bash", "-c", script], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)

    assert "Lemon AI Installer" in result.stdout
    assert "Internal AI desktop harness by Lemon Digital." in result.stdout
    assert "Hermes Installer" not in result.stdout


def test_install_sh_banner_keeps_raw_lemon_brand(tmp_path: Path) -> None:
    script = f"""
set -e
MAGENTA=
BOLD=
NC=
INTERNAL_DESKTOP_BUILD=false
INSTALLER_DISPLAY_NAME="Lemon AI Installer"
INSTALLER_DESCRIPTION="An open source AI agent by Lemon Digital."
eval "$(sed -n '/^print_banner()/,/^}}/p' {INSTALL_SH!s})"
print_banner
"""

    result = subprocess.run(["bash", "-c", script], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)

    assert "Lemon AI Installer" in result.stdout
    assert "An open source AI agent by Lemon Digital." in result.stdout
    assert "Hermes Installer" not in result.stdout


def test_install_sh_brand_lemon_overrides_checkout_manifest(tmp_path: Path) -> None:
    upstream, _ = create_remote(tmp_path, "DangLemon/lemon-agent", marker="upstream")
    gitconfig = write_gitconfig(tmp_path, {"DangLemon/lemon-agent": upstream})
    install_dir = tmp_path / "install"

    result = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=install_dir,
        extra_env={"LEMON_INSTALLER_BRAND": "lemon"},
        check=True,
    )

    assert '"ok":true' in result.stdout.replace(" ", "")
    assert (install_dir / "README.md").read_text(encoding="utf-8") == "upstream\n"
    assert origin_url(install_dir) == "git@github.com:DangLemon/lemon-agent.git"


def test_install_sh_brand_lemon_overrides_raw_script_default(tmp_path: Path) -> None:
    internal, _ = create_remote(tmp_path, "DangLemon/lemon-agent", marker="internal")
    gitconfig = write_gitconfig(tmp_path, {"DangLemon/lemon-agent": internal})
    install_dir = tmp_path / "install"
    raw_script = copy_raw_install_sh(tmp_path)

    result = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=install_dir,
        install_script=raw_script,
        extra_env={"LEMON_INSTALLER_BRAND": "lemon"},
        check=True,
    )

    assert '"ok":true' in result.stdout.replace(" ", "")
    assert (install_dir / "README.md").read_text(encoding="utf-8") == "internal\n"
    assert origin_url(install_dir) == "git@github.com:DangLemon/lemon-agent.git"








def test_install_sh_checkout_manifest_ignores_inherited_lemon_home(tmp_path: Path) -> None:
    env = os.environ.copy()
    env.update({"HOME": str(tmp_path / "home"), "LEMON_HOME": str(tmp_path / "ambient-home")})

    result = subprocess.run(
        ["bash", str(INSTALL_SH), "--help"],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
    )

    assert f"default (non-root):  {tmp_path / 'home' / '.lemon-ai' / 'lemon-agent'}" in result.stdout
    assert str(tmp_path / "ambient-home") not in result.stdout


def test_install_sh_checkout_manifest_preserves_runtime_override(tmp_path: Path) -> None:
    env = os.environ.copy()
    env.update({"HOME": str(tmp_path / "home"), "LEMON_INSTALL_RUNTIME_DIR_NAME": "custom-runtime"})

    result = subprocess.run(
        ["bash", str(INSTALL_SH), "--help"],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
    )

    assert f"default (non-root):  {tmp_path / 'home' / '.lemon-ai' / 'custom-runtime'}" in result.stdout


def test_install_sh_invalid_explicit_selector_keeps_lemon_fork_defaults(tmp_path: Path) -> None:
    internal, _ = create_remote(tmp_path, "DangLemon/lemon-agent", marker="internal")
    gitconfig = write_gitconfig(tmp_path, {"DangLemon/lemon-agent": internal})
    install_dir = tmp_path / "install"

    result = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=install_dir,
        extra_env={"LEMON_DESKTOP_HARNESS_CONFIG": str(tmp_path / "missing.json")},
        check=True,
    )

    assert '"ok":true' in result.stdout.replace(" ", "")
    assert (install_dir / "README.md").read_text(encoding="utf-8") == "internal\n"
    assert origin_url(install_dir) == "git@github.com:DangLemon/lemon-agent.git"


def test_install_sh_internal_help_reports_only_lemon_default_paths(tmp_path: Path) -> None:
    env = os.environ.copy()
    env.update({"HOME": str(tmp_path / "home"), "LEMON_DESKTOP_INTERNAL": "1"})

    result = subprocess.run(
        ["bash", str(INSTALL_SH), "--help"],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
    )

    assert f"default (non-root):  {tmp_path / 'home' / '.lemon-ai' / 'lemon-agent'}" in result.stdout
    assert "default: DangLemon/lemon-agent" in result.stdout
    assert ".hermes/hermes-agent" not in result.stdout


def test_install_sh_lemon_repo_argument_selects_internal_help_before_parse(tmp_path: Path) -> None:
    env = os.environ.copy()
    env.update({"HOME": str(tmp_path / "home")})

    result = subprocess.run(
        ["bash", str(INSTALL_SH), "--repo", "DangLemon/lemon-agent", "--help"],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
    )

    assert result.stdout.startswith("Lemon AI Installer\n")
    assert f"default (non-root):  {tmp_path / 'home' / '.lemon-ai' / 'lemon-agent'}" in result.stdout
    assert "default: DangLemon/lemon-agent" in result.stdout
    assert ".hermes/hermes-agent" not in result.stdout


def test_install_sh_rejects_traversal_runtime_dir_name(tmp_path: Path) -> None:
    env = os.environ.copy()
    env.update({"HOME": str(tmp_path / "home"), "LEMON_INSTALL_RUNTIME_DIR_NAME": "../lemon-agent"})

    result = subprocess.run(
        ["bash", str(INSTALL_SH), "--help"],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    assert result.returncode != 0
    assert "must be a safe directory name" in result.stdout


def test_install_sh_custom_repo_clone_and_existing_update_use_selected_repo(tmp_path: Path) -> None:
    internal, _ = create_remote(tmp_path, "DangLemon/lemon-agent", marker="internal")
    gitconfig = write_gitconfig(tmp_path, {"DangLemon/lemon-agent": internal})
    install_dir = tmp_path / "install"

    first = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=install_dir,
        repository="DangLemon/lemon-agent",
        check=True,
    )
    second = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=install_dir,
        repository="DangLemon/lemon-agent",
        check=True,
    )

    assert '"ok":true' in first.stdout.replace(" ", "")
    assert '"ok":true' in second.stdout.replace(" ", "")
    assert (install_dir / "README.md").read_text(encoding="utf-8") == "internal\n"
    assert origin_url(install_dir) == "git@github.com:DangLemon/lemon-agent.git"


def write_fake_ssh_fail_tools(tmp_path: Path) -> Path:
    bin_dir = tmp_path / "fake-ssh-fail-bin"
    bin_dir.mkdir()
    git_wrapper = bin_dir / "git"
    git_wrapper.write_text(
        textwrap.dedent(
            f"""
            #!/bin/sh
            if [ "$1" = "clone" ]; then
                for arg in "$@"; do
                    case "$arg" in
                        git@github.com:*) exit 42 ;;
                    esac
                done
            fi
            exec "{REAL_GIT}" "$@"
            """
        ).lstrip(),
        encoding="utf-8",
    )
    sleep_wrapper = bin_dir / "sleep"
    sleep_wrapper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    for executable in (git_wrapper, sleep_wrapper):
        executable.chmod(executable.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return bin_dir


def test_install_sh_https_fallback_keeps_https_origin(tmp_path: Path) -> None:
    internal, _ = create_remote(tmp_path, "DangLemon/lemon-agent", marker="internal")
    gitconfig = write_gitconfig(tmp_path, {"DangLemon/lemon-agent": internal})
    install_dir = tmp_path / "install"
    fake_bin = write_fake_ssh_fail_tools(tmp_path)

    result = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=install_dir,
        repository="DangLemon/lemon-agent",
        extra_path=fake_bin,
        check=True,
    )

    assert '"ok":true' in result.stdout.replace(" ", "")
    assert (install_dir / "README.md").read_text(encoding="utf-8") == "internal\n"
    assert origin_url(install_dir) == "https://github.com/DangLemon/lemon-agent.git"


def test_install_sh_existing_checkout_preserves_matching_ssh_origin(tmp_path: Path) -> None:
    internal, _ = create_remote(tmp_path, "DangLemon/lemon-agent", marker="internal")
    gitconfig = write_gitconfig(tmp_path, {"DangLemon/lemon-agent": internal})
    install_dir = tmp_path / "install"
    env = installer_env(tmp_path, gitconfig)
    run(
        [REAL_GIT or "git", "clone", "git@github.com:DangLemon/lemon-agent.git", str(install_dir)],
        cwd=tmp_path,
        env=env,
    )

    result = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=install_dir,
        repository="DangLemon/lemon-agent",
        check=True,
    )

    assert '"ok":true' in result.stdout.replace(" ", "")
    assert origin_url(install_dir) == "git@github.com:DangLemon/lemon-agent.git"


def test_install_sh_existing_checkout_mismatched_origin_fails_before_update_and_keeps_dirty_edits(tmp_path: Path) -> None:
    other, _ = create_remote(tmp_path, "OtherOrg/lemon-agent", marker="other")
    internal, _ = create_remote(tmp_path, "DangLemon/lemon-agent", marker="internal")
    gitconfig = write_gitconfig(tmp_path, {"OtherOrg/lemon-agent": other, "DangLemon/lemon-agent": internal})
    install_dir = tmp_path / "install"
    env = installer_env(tmp_path, gitconfig)
    run(
        [REAL_GIT or "git", "clone", "https://github.com/OtherOrg/lemon-agent.git", str(install_dir)],
        cwd=tmp_path,
        env=env,
    )
    (install_dir / "local-note.txt").write_text("keep me\n", encoding="utf-8")

    result = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=install_dir,
        repository="DangLemon/lemon-agent",
    )

    assert result.returncode != 0
    assert "does not match selected --repo DangLemon/lemon-agent" in result.stdout
    assert (install_dir / "local-note.txt").read_text(encoding="utf-8") == "keep me\n"
    assert origin_url(install_dir) == "https://github.com/OtherOrg/lemon-agent.git"


def write_fake_clone_fail_tools(tmp_path: Path, archive_zip: Path) -> Path:
    bin_dir = tmp_path / "fake-bin"
    bin_dir.mkdir()
    git_wrapper = bin_dir / "git"
    git_wrapper.write_text(
        textwrap.dedent(
            f"""
            #!/bin/sh
            printf '%s\n' "$*" >> "{tmp_path / 'git.log'}"
            if [ "$1" = "clone" ]; then
                exit 42
            fi
            exec "{REAL_GIT}" "$@"
            """
        ).lstrip(),
        encoding="utf-8",
    )
    curl_wrapper = bin_dir / "curl"
    curl_wrapper.write_text(
        textwrap.dedent(
            f"""
            #!/bin/sh
            printf '%s\n' "$*" >> "{tmp_path / 'curl.log'}"
            out=""
            while [ "$#" -gt 0 ]; do
                if [ "$1" = "-o" ]; then
                    shift
                    out="$1"
                fi
                shift || true
            done
            if [ -z "$out" ]; then
                exit 2
            fi
            cp "{archive_zip}" "$out"
            """
        ).lstrip(),
        encoding="utf-8",
    )
    sleep_wrapper = bin_dir / "sleep"
    sleep_wrapper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    for executable in (git_wrapper, curl_wrapper, sleep_wrapper):
        executable.chmod(executable.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return bin_dir


def make_archive_zip(tmp_path: Path, *, prefix: str = "lemon-agent-main") -> Path:
    archive = tmp_path / "archive.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr(f"{prefix}/README.md", "archive fallback\n")
    return archive


def test_install_sh_archive_fallback_uses_validated_repo_and_commit_precedence(tmp_path: Path) -> None:
    internal, commit = create_remote(tmp_path, "DangLemon/lemon-agent", marker="internal", tag="v1.0.0")
    gitconfig = write_gitconfig(tmp_path, {"DangLemon/lemon-agent": internal})
    archive_zip = make_archive_zip(tmp_path)
    fake_bin = write_fake_clone_fail_tools(tmp_path, archive_zip)
    install_dir = tmp_path / "install"

    result = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=install_dir,
        repository="DangLemon/lemon-agent",
        commit=commit,
        tag="v1.0.0",
        extra_path=fake_bin,
        check=True,
    )

    assert '"ok":true' in result.stdout.replace(" ", "")
    assert "https://github.com/DangLemon/lemon-agent/archive/" + commit + ".zip" in (tmp_path / "curl.log").read_text(encoding="utf-8")
    assert git(["rev-parse", "HEAD"], cwd=install_dir) == commit
    assert origin_url(install_dir) == "https://github.com/DangLemon/lemon-agent.git"


def test_install_sh_rejects_invalid_repo_identity_before_network(tmp_path: Path) -> None:
    gitconfig = write_gitconfig(tmp_path, {})

    result = run_repository_stage(
        tmp_path,
        gitconfig=gitconfig,
        install_dir=tmp_path / "install",
        repository="https://github.com/DangLemon/lemon-agent",
    )

    assert result.returncode != 0
    assert "--repo expects a GitHub owner/repo identity" in result.stdout
