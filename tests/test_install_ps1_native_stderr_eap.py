"""Regression tests for #48352: Windows PowerShell 5.1 native stderr.

PowerShell 5.1 turns stderr from native commands into ``NativeCommandError``
records when ``$ErrorActionPreference = "Stop"``.  ``scripts/install.ps1`` has a
few git/uv calls where stderr can be normal progress output, so those calls must
run with EAP temporarily relaxed and then inspect ``$LASTEXITCODE``.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
INSTALL_PS1 = REPO_ROOT / "scripts" / "install.ps1"


def _install_ps1() -> str:
    return INSTALL_PS1.read_text(encoding="utf-8")


def _assert_relaxed_call(text: str, command_pattern: str) -> None:
    helper_block_pattern = (
        r"Invoke-NativeWithRelaxedErrorAction\s*\{[^}]*"
        + command_pattern
        + r"[^}]*\}"
    )
    inline_pattern = (
        r"\$ErrorActionPreference\s*=\s*\"Continue\"[\s\S]{0,900}?"
        + command_pattern
    )
    assert re.search(helper_block_pattern, text) or re.search(inline_pattern, text), (
        f"install.ps1 must relax ErrorActionPreference around {command_pattern}"
    )


def test_repository_stage_relieves_eap_for_ssh_and_https_git_clone() -> None:
    text = _install_ps1()
    assert "function Invoke-NativeWithRelaxedErrorAction" in text
    # Fresh clone goes through a sibling-path loop ($cloneUrl / $candidate)
    # so a locked $InstallDir cannot poison Retry. Both SSH and HTTPS feed
    # that one git clone line; wrapping it covers both transports.
    _assert_relaxed_call(
        text,
        r"git -c windows\.appendAtomically=false clone --depth 1 --branch \$Branch \$cloneUrl \$candidate",
    )
    assert re.search(r"Url = \$RepoUrlSsh; Label = \"SSH\"", text), (
        "clone attempts must still include the SSH transport"
    )
    assert re.search(r"Url = \$RepoUrlHttps; Label = \"HTTPS\"", text), (
        "clone attempts must still include the HTTPS transport"
    )


def test_dependency_installs_relax_eap() -> None:
    text = _install_ps1()
    _assert_relaxed_call(text, r"& \$UvCmd sync --extra all --locked")
    _assert_relaxed_call(text, r"& \$UvCmd pip install -e \$tier\.Spec")


@pytest.mark.windows_only
@pytest.mark.parametrize("runtime", ["powershell", "pwsh"])
def test_native_eap_helper_executes_supplied_block(runtime: str) -> None:
    executable = shutil.which(runtime)
    if executable is None:
        pytest.skip(f"{runtime} is not installed")

    program = r"""
$tokens = $null
$parseErrors = $null
$tree = [System.Management.Automation.Language.Parser]::ParseFile(
    $env:INSTALL_PS1_PATH, [ref]$tokens, [ref]$parseErrors
)
if ($parseErrors.Count -ne 0) { throw ($parseErrors | Out-String) }
$functions = @($tree.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Invoke-NativeWithRelaxedErrorAction'
}, $true))
if ($functions.Count -ne 1) { throw "Expected exactly one native EAP helper" }
. ([scriptblock]::Create($functions[0].Extent.Text))

$ErrorActionPreference = 'Stop'
$Script = { $script:baitRan = $true }
$actualRan = $false
$baitRan = $false
$actual = {
    $script:actualRan = $true
    $script:insideEap = [string]$ErrorActionPreference
    & $env:PYTHON_EXECUTABLE -c 'import sys; sys.stderr.buffer.write(b''native stderr\n''); sys.exit(17)'
    $script:exitCodeInside = $LASTEXITCODE
    'block output'
}
$output = @(Invoke-NativeWithRelaxedErrorAction $actual)
$exitCodeOutside = $LASTEXITCODE
$outsideEap = [string]$ErrorActionPreference
$caught = $null
try {
    Invoke-NativeWithRelaxedErrorAction { throw 'expected exception' } | Out-Null
} catch {
    $caught = $_.Exception.Message
}
@{
    actualRan = $actualRan
    baitRan = $baitRan
    insideEap = $insideEap
    outsideEap = $outsideEap
    exitCodeInside = $exitCodeInside
    exitCodeOutside = $exitCodeOutside
    output = ($output -join ',')
    caught = $caught
    outsideAfterException = [string]$ErrorActionPreference
} | ConvertTo-Json -Compress
"""
    env = {
        **os.environ,
        "INSTALL_PS1_PATH": str(INSTALL_PS1),
        "PYTHON_EXECUTABLE": sys.executable,
    }
    result = subprocess.run(
        [executable, "-NoProfile", "-NonInteractive", "-Command", program],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "native stderr" in result.stderr
    observed = json.loads(result.stdout)
    assert observed == {
        "actualRan": True,
        "baitRan": False,
        "insideEap": "Continue",
        "outsideEap": "Stop",
        "exitCodeInside": 17,
        "exitCodeOutside": 17,
        "output": "block output",
        "caught": "expected exception",
        "outsideAfterException": "Stop",
    }


def test_native_eap_helper_requires_mandatory_scriptblock() -> None:
    text = _install_ps1()
    m = re.search(
        r"function Invoke-NativeWithRelaxedErrorAction \{(?P<body>[\s\S]*?)^\}",
        text,
        re.MULTILINE,
    )
    assert m is not None
    assert re.search(
        r"\bparam\(\[Parameter\(Mandatory\s*=\s*\$true\)\]\[scriptblock\]\$Script\)",
        m.group("body"),
    ), "native EAP helper must bind a mandatory scriptblock"


def test_native_eap_helper_always_restores_previous_preference() -> None:
    text = _install_ps1()
    m = re.search(
        r"function Invoke-NativeWithRelaxedErrorAction \{(?P<body>[\s\S]*?)^\}",
        text,
        re.MULTILINE,
    )
    assert m is not None, "expected a shared helper for NativeCommandError-safe calls"
    body = m.group("body")
    assert "$prevEAP = $ErrorActionPreference" in body
    assert '$ErrorActionPreference = "Continue"' in body
    assert "finally" in body
    assert "$ErrorActionPreference = $prevEAP" in body
