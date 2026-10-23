# Behavioral regression test for repository refs passed through -Branch.
#
# Release build stamps carry the GitHub tag in the branch field. The installer
# must recognize that a fetched ref with no origin/<name> branch is a tag and
# check out FETCH_HEAD detached instead of failing with "pathspec ... did not
# match".
#
# This loads install.ps1 normally in dot-source mode, then supplies a fake git
# command. No network, checkout, or user state is touched.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$installScript = Join-Path $repoRoot "scripts\install.ps1"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("lemon-tag-checkout-test-" + [Guid]::NewGuid().ToString("N"))

$script:Failures = 0
function Assert-True {
    param($Condition, [string]$Label)
    if ($Condition) {
        Write-Host "PASS: $Label"
    } else {
        Write-Host "FAIL: $Label"
        $script:Failures++
    }
}

$testHome = Join-Path $testRoot "home"
$installDir = Join-Path $testRoot "install"
New-Item -ItemType Directory -Force -Path $testHome, $installDir | Out-Null

try {
    . $installScript -LemonHome $testHome -InstallDir $installDir -Repository "DangLemon/lemon-agent"

    $script:GitCalls = @()
    function global:git {
        $script:GitCalls += ,@($args)
        if (($args -contains "rev-parse") -and ($args -contains "FETCH_HEAD")) {
            $global:LASTEXITCODE = 0
            return "0123456789abcdef0123456789abcdef01234567"
        }
        if ($args -contains "refs/remotes/origin/lemon-v0.17.15") {
            $global:LASTEXITCODE = 1
            return
        }
        if ($args -contains "checkout") {
            $global:LASTEXITCODE = 0
            return
        }
        $global:LASTEXITCODE = 0
    }

    $usedBranchPull = Checkout-FetchedBranchOrRef -Ref "lemon-v0.17.15"

    Assert-True (-not $usedBranchPull) "tag-shaped fetched ref is not treated as a branch"
    $checkoutCall = $script:GitCalls | Where-Object { $_ -contains "checkout" } | Select-Object -First 1
    Assert-True ($null -ne $checkoutCall) "fetched ref is checked out"
    Assert-True (($checkoutCall -contains "--detach") -and ($checkoutCall -contains "FETCH_HEAD")) `
        "fetched ref is checked out detached from FETCH_HEAD"
} finally {
    Remove-Item Function:\git -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($script:Failures -gt 0) {
    Write-Host "FAILED: $($script:Failures) assertion(s)"
    exit 1
}
Write-Host "ALL PASSED"
exit 0
