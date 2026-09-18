# Behavioral tests for install.ps1's Windows repository-stage lock handling.
#
# First-run Retry on a blank Windows machine fails when a leftover git.exe /
# Defender scan holds lemon-agent and a single Move-Item throws "being used by
# another process". These helpers must park/replace that directory with retry
# instead of aborting the whole bootstrap.
#
# Functions are extracted through the PowerShell AST so this never runs the
# installer entry point (no clone, PATH, or profile writes).

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$installScript = Join-Path $repoRoot "scripts\install.ps1"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("lemon-repo-lock-test-" + [Guid]::NewGuid().ToString("N"))

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

function Assert-Equal {
    param($Expected, $Actual, [string]$Label)
    if ($Expected -ceq $Actual) {
        Write-Host "PASS: $Label"
    } else {
        Write-Host "FAIL: $Label"
        Write-Host "  expected: [$Expected]"
        Write-Host "  actual:   [$Actual]"
        $script:Failures++
    }
}

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $installScript, [ref]$tokens, [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
    throw "install.ps1 has parse errors: $($parseErrors -join '; ')"
}

function Write-Info { param([string]$Message) }
function Write-Warn { param([string]$Message) }
function Write-Err { param([string]$Message) }

foreach ($name in @(
    "Stop-ProcessesUnderDirectory",
    "Move-DirectoryWithRetry",
    "Remove-DirectoryWithRetry"
)) {
    $fnAst = $ast.FindAll(
        {
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -eq $name
        }, $true
    ) | Select-Object -First 1
    if (-not $fnAst) { throw "$name not found in install.ps1" }
    . ([scriptblock]::Create($fnAst.Extent.Text))
}

$installText = [System.IO.File]::ReadAllText($installScript)
Assert-True ($installText -match 'Could not park \$InstallDir yet; cloning into a sibling') `
    "broken-dir park failure continues into a sibling clone"
Assert-True ($installText -match '(?s)if \(\$NonInteractive\) \{.*?Label = "HTTPS".*?Label = "SSH"') `
    "GUI/NonInteractive clone tries HTTPS before SSH"
Assert-True ($installText -match 'New-IncomingCheckoutPath') `
    "each clone attempt uses a unique incoming directory"
Assert-True ($installText -match '-C \$InstallDir rev-parse --is-inside-work-tree') `
    "repo probe uses git -C instead of Push-Location"

New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
try {
    Write-Host "-- unlocked directory move --"
    $src = Join-Path $testRoot "src-unlocked"
    $dst = Join-Path $testRoot "dst-unlocked"
    New-Item -ItemType Directory -Force -Path $src | Out-Null
    Set-Content -LiteralPath (Join-Path $src "marker.txt") -Value "ok"
    Assert-True (Move-DirectoryWithRetry -Source $src -Destination $dst -Attempts 3 -DelayMs 10) "unlocked move succeeds"
    Assert-True (-not (Test-Path -LiteralPath $src)) "source is gone after move"
    Assert-Equal "ok" (Get-Content -LiteralPath (Join-Path $dst "marker.txt") -Raw).Trim() "destination kept contents"

    Write-Host "-- missing source is a no-op success --"
    Assert-True (Move-DirectoryWithRetry -Source (Join-Path $testRoot "no-such-dir") -Destination $dst) "missing source returns true"

    Write-Host "-- remove missing directory --"
    Assert-True (Remove-DirectoryWithRetry -Path (Join-Path $testRoot "no-such-dir")) "missing remove returns true"

    if ($env:OS -eq "Windows_NT") {
        Write-Host "-- kill a process running from the directory, then move --"
        $held = Join-Path $testRoot "src-held"
        $heldDst = Join-Path $testRoot "dst-held"
        New-Item -ItemType Directory -Force -Path $held | Out-Null
        $holderExe = Join-Path $held "lemon-lock-holder.exe"
        Copy-Item -LiteralPath (Join-Path $env:SystemRoot "System32\timeout.exe") -Destination $holderExe
        $holder = Start-Process -FilePath $holderExe -ArgumentList @("/T", "90", "/NOBREAK") -PassThru -WindowStyle Hidden
        Start-Sleep -Milliseconds 400
        Assert-True (-not $holder.HasExited) "holder process is still running"
        Stop-ProcessesUnderDirectory -Dir $held
        $holder.WaitForExit(5000) | Out-Null
        Assert-True ($holder.HasExited) "holder process was stopped"
        Assert-True (Move-DirectoryWithRetry -Source $held -Destination $heldDst -Attempts 6 -DelayMs 50) "move succeeds after releasing holder"
        Assert-True (Test-Path -LiteralPath (Join-Path $heldDst "lemon-lock-holder.exe")) "parked tree still has the copied binary"
    } else {
        Write-Host "SKIP: Windows-only holder-process coverage on this host"
    }
} finally {
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
