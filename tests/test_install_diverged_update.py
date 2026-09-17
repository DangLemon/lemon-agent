"""Regression: installer/bootstrap must fail closed on diverged managed clones.

When ``~/.lemon-ai/lemon-agent`` has local-only commits (or diverged history),
``git pull --ff-only`` fails with exit 128 and bootstrap aborts at the
repository stage. The installer must not hide that by resetting over the
checkout; local commits and restored worktree edits must remain inspectable.

Fixes the bootstrap failure seen in #53257 and desktop update paths that run
``install.ps1`` / ``install.sh`` non-interactively.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
INSTALL_SH = REPO_ROOT / "scripts" / "install.sh"
INSTALL_PS1 = REPO_ROOT / "scripts" / "install.ps1"


def _extract_install_sh_update_block() -> str:
    text = INSTALL_SH.read_text()
    match = re.search(
        r"(?P<block>git checkout \"\$BRANCH\".*?fi\n\n            if \[ -n \"\$autostash_ref\" \])",
        text,
        re.DOTALL,
    )
    assert match is not None, "managed-install update block not found in install.sh"
    return match["block"]


def _extract_install_ps1_branch_update_block() -> str:
    text = INSTALL_PS1.read_text()
    match = re.search(
        r"(?P<block>git -c windows\.appendAtomically=false checkout \$Branch.*?elseif \(\$Tag\))",
        text,
        re.DOTALL,
    )
    assert match is not None, "branch update block not found in install.ps1"
    return match["block"]


def test_install_sh_fails_closed_when_ff_only_pull_fails() -> None:
    block = _extract_install_sh_update_block()

    assert 'git pull --ff-only origin "$BRANCH"' in block
    assert 'git reset --hard "origin/$BRANCH"' not in block
    assert "Fast-forward update from origin/$BRANCH was not possible" in block
    assert "No destructive reset was performed" in block
    assert 'update_failed="yes"' in block

    pull_idx = block.find('git pull --ff-only origin "$BRANCH"')
    failure_idx = block.find('update_failed="yes"')
    assert pull_idx != -1 and failure_idx != -1
    assert pull_idx < failure_idx, "ff-only pull must be attempted before safe refusal"


def test_install_ps1_fails_closed_when_ff_only_pull_fails() -> None:
    block = _extract_install_ps1_branch_update_block()

    assert "pull --ff-only origin $Branch" in block
    assert 'reset --hard "origin/$Branch"' not in block
    assert "Fast-forward update from origin/$Branch was not possible" in block
    assert "No destructive reset was performed" in block
    assert "$updateFailed = $true" in block

    pull_idx = block.find("pull --ff-only origin $Branch")
    failure_idx = block.find("$updateFailed = $true")
    assert pull_idx != -1 and failure_idx != -1
    assert pull_idx < failure_idx, "ff-only pull must be attempted before safe refusal"
