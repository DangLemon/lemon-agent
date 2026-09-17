import threading
from unittest.mock import MagicMock, patch




def test_format_banner_version_label_on_upstream_main():
    from lemon_cli import banner

    with patch.object(
        banner,
        "get_git_banner_state",
        return_value={"upstream": "b2f477a3", "local": "b2f477a3", "ahead": 0},
    ):
        value = banner.format_banner_version_label()

    assert value.endswith("· upstream b2f477a3")
    assert "local" not in value


def test_get_git_banner_state_reads_origin_and_head(tmp_path):
    from lemon_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)

    results = {
        ("git", "rev-parse", "--short=8", "origin/main"): MagicMock(returncode=0, stdout="b2f477a3\n"),
        ("git", "rev-parse", "--short=8", "HEAD"): MagicMock(returncode=0, stdout="af8aad31\n"),
        ("git", "rev-list", "--count", "origin/main..HEAD"): MagicMock(returncode=0, stdout="3\n"),
    }

    def fake_run(cmd, **kwargs):
        key = tuple(cmd)
        if key not in results:
            raise AssertionError(f"unexpected command: {cmd}")
        return results[key]

    with patch("lemon_cli.banner.subprocess.run", side_effect=fake_run):
        state = banner.get_git_banner_state(repo_dir)

    assert state == {"upstream": "b2f477a3", "local": "af8aad31", "ahead": 3}


def test_git_banner_state_rejects_stale_origin_after_configured_repo_remap(
    tmp_path, monkeypatch
):
    from lemon_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)
    monkeypatch.setenv("LEMON_UPDATE_REPOSITORY", "DangLemon/lemon-agent")

    baked = {"upstream": "bakedsha", "local": "bakedsha", "ahead": 0}
    commands = []

    def fake_run(cmd, **kwargs):
        commands.append(cmd)
        joined = " ".join(str(part) for part in cmd)
        if joined == "git remote get-url origin":
            return MagicMock(
                returncode=0,
                stdout="https://github.com/DangLemon/lemon-agent.git\n",
            )
        if joined == "git remote set-url origin https://github.com/DangLemon/lemon-agent.git":
            return MagicMock(returncode=0, stdout="")
        if joined == "git show-ref --verify --quiet refs/remotes/origin/main":
            return MagicMock(returncode=0, stdout="")
        if joined == "git update-ref -d refs/remotes/origin/main":
            return MagicMock(returncode=0, stdout="")
        if joined == "git rev-parse --short=8 origin/main":
            return MagicMock(returncode=128, stdout="", stderr="stale ref deleted")
        if joined == "git rev-parse --short=8 HEAD":
            return MagicMock(returncode=0, stdout="af8aad31\n")
        raise AssertionError(f"unexpected command: {cmd}")

    with (
        patch("lemon_cli.banner.subprocess.run", side_effect=fake_run),
        patch.object(banner, "_baked_banner_state", return_value=baked),
    ):
        state = banner.get_git_banner_state(repo_dir)

    assert state == baked
    command_text = [" ".join(str(part) for part in command) for command in commands]
    assert "git remote set-url origin https://github.com/DangLemon/lemon-agent.git" in command_text
    assert "git update-ref -d refs/remotes/origin/main" in command_text
    assert command_text.index("git update-ref -d refs/remotes/origin/main") < command_text.index(
        "git remote set-url origin https://github.com/DangLemon/lemon-agent.git"
    )
    assert command_text.index("git remote set-url origin https://github.com/DangLemon/lemon-agent.git") < command_text.index(
        "git rev-parse --short=8 origin/main"
    )


def test_git_banner_state_falls_back_when_stale_origin_invalidation_fails(
    tmp_path, monkeypatch
):
    from lemon_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)
    monkeypatch.setenv("LEMON_UPDATE_REPOSITORY", "DangLemon/lemon-agent")

    baked = {"upstream": "bakedsha", "local": "bakedsha", "ahead": 0}
    commands = []

    def fake_run(cmd, **kwargs):
        commands.append(cmd)
        joined = " ".join(str(part) for part in cmd)
        if joined == "git remote get-url origin":
            return MagicMock(
                returncode=0,
                stdout="https://github.com/DangLemon/lemon-agent.git\n",
            )
        if joined == "git remote set-url origin https://github.com/DangLemon/lemon-agent.git":
            return MagicMock(returncode=0, stdout="")
        if joined == "git show-ref --verify --quiet refs/remotes/origin/main":
            return MagicMock(returncode=0, stdout="")
        if joined == "git update-ref -d refs/remotes/origin/main":
            return MagicMock(returncode=1, stdout="", stderr="locked")
        raise AssertionError(f"unexpected command: {cmd}")

    with (
        patch("lemon_cli.banner.subprocess.run", side_effect=fake_run),
        patch.object(banner, "_baked_banner_state", return_value=baked),
    ):
        state = banner.get_git_banner_state(repo_dir)

    assert state == baked
    command_text = [" ".join(str(part) for part in command) for command in commands]
    assert "git update-ref -d refs/remotes/origin/main" in command_text
    assert "git remote set-url origin https://github.com/DangLemon/lemon-agent.git" not in command_text
    assert "git rev-parse --short=8 origin/main" not in command_text


def test_origin_normalization_blocks_matching_fast_path_until_invalidation_finishes(
    tmp_path, monkeypatch
):
    from lemon_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)
    monkeypatch.setenv("LEMON_UPDATE_REPOSITORY", "DangLemon/lemon-agent")

    current_origin = {"value": "https://github.com/DangLemon/lemon-agent.git"}
    commands = []
    command_lock = threading.Lock()
    set_url_done = threading.Event()
    allow_invalidation = threading.Event()
    invalidation_done = threading.Event()
    remap_result = []
    fast_path_result = []

    def fake_run(cmd, **kwargs):
        joined = " ".join(str(part) for part in cmd)
        with command_lock:
            commands.append((threading.current_thread().name, joined))
        if joined == "git remote get-url origin":
            return MagicMock(returncode=0, stdout=f"{current_origin['value']}\n")
        if joined == "git remote set-url origin https://github.com/DangLemon/lemon-agent.git":
            current_origin["value"] = "https://github.com/DangLemon/lemon-agent.git"
            return MagicMock(returncode=0, stdout="")
        if joined == "git show-ref --verify --quiet refs/remotes/origin/main":
            return MagicMock(returncode=0, stdout="")
        if joined == "git update-ref -d refs/remotes/origin/main":
            set_url_done.set()
            assert allow_invalidation.wait(2), "test timed out waiting to continue invalidation"
            invalidation_done.set()
            return MagicMock(returncode=0, stdout="")
        raise AssertionError(f"unexpected command: {cmd}")

    def run_remap():
        remap_result.append(banner._ensure_local_origin_matches_configured_repository(repo_dir))

    def run_fast_path():
        fast_path_result.append(banner._ensure_local_origin_matches_configured_repository(repo_dir))

    with patch("lemon_cli.banner.subprocess.run", side_effect=fake_run):
        remap_thread = threading.Thread(target=run_remap, name="remap")
        remap_thread.start()
        assert set_url_done.wait(2), "test setup did not reach set-url pause"

        fast_path_thread = threading.Thread(target=run_fast_path, name="fast-path")
        fast_path_thread.start()
        fast_path_thread.join(0.2)
        assert fast_path_thread.is_alive(), (
            "matching-origin fast path returned before stale origin/main was invalidated"
        )

        allow_invalidation.set()
        remap_thread.join(2)
        fast_path_thread.join(2)

    assert remap_result == [True]
    assert fast_path_result == [True]
    assert invalidation_done.is_set()
    update_index = commands.index(("remap", "git update-ref -d refs/remotes/origin/main"))
    fast_path_get_url_index = commands.index(("fast-path", "git remote get-url origin"))
    assert update_index < fast_path_get_url_index


def test_check_via_local_git_ssh_fastpath_ahead_not_behind(tmp_path):
    """SSH fast path must not report an ahead (carried) HEAD as behind.

    A carried local commit means tip SHAs differ, but the fresh upstream tip
    is an ancestor of HEAD — that is "ahead", and reporting it as behind
    nudges the user into `lemon update`, which can wipe the carried work.
    """
    from unittest.mock import MagicMock

    from lemon_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)

    def fake_git_stdout(args, *, cwd, timeout=5):
        if args == ["remote", "get-url", "origin"]:
            return "git@github.com:DangLemon/lemon-agent.git"
        if args == ["rev-parse", "HEAD"]:
            return "b" * 40  # carried commit, differs from upstream tip
        raise AssertionError(f"unexpected git call: {args}")

    with (
        patch.object(banner, "_git_stdout", side_effect=fake_git_stdout),
        patch.object(banner, "_upstream_main_sha", return_value="a" * 40),
        # merge-base --is-ancestor exits 0: upstream tip IS an ancestor of HEAD
        patch.object(banner.subprocess, "run", return_value=MagicMock(returncode=0)),
    ):
        behind = banner._check_via_local_git(repo_dir)

    assert behind == 0


def test_check_via_local_git_ssh_fastpath_genuinely_behind(tmp_path):
    """SSH fast path reports the exact count (compare API) when behind."""
    from unittest.mock import MagicMock

    from lemon_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)

    def fake_git_stdout(args, *, cwd, timeout=5):
        if args == ["remote", "get-url", "origin"]:
            return "git@github.com:DangLemon/lemon-agent.git"
        if args == ["rev-parse", "HEAD"]:
            return "b" * 40
        raise AssertionError(f"unexpected git call: {args}")

    with (
        patch.object(banner, "_git_stdout", side_effect=fake_git_stdout),
        patch.object(banner, "_upstream_main_sha", return_value="a" * 40),
        # merge-base --is-ancestor exits 1: not an ancestor -> genuinely behind
        patch.object(banner.subprocess, "run", return_value=MagicMock(returncode=1)),
        patch.object(banner, "_github_compare_behind", return_value=3),
    ):
        behind = banner._check_via_local_git(repo_dir)

    assert behind == 3


def test_check_via_local_git_ssh_fastpath_offline_keeps_sentinel(tmp_path):
    """Behind + compare API unreachable = honest no-count sentinel, never 1."""
    from unittest.mock import MagicMock

    from lemon_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)

    def fake_git_stdout(args, *, cwd, timeout=5):
        if args == ["remote", "get-url", "origin"]:
            return "git@github.com:DangLemon/lemon-agent.git"
        if args == ["rev-parse", "HEAD"]:
            return "b" * 40
        raise AssertionError(f"unexpected git call: {args}")

    with (
        patch.object(banner, "_git_stdout", side_effect=fake_git_stdout),
        patch.object(banner, "_upstream_main_sha", return_value="a" * 40),
        patch.object(banner.subprocess, "run", return_value=MagicMock(returncode=1)),
        patch.object(banner, "_github_compare_behind", return_value=None),
    ):
        behind = banner._check_via_local_git(repo_dir)

    assert behind == banner.UPDATE_AVAILABLE_NO_COUNT
