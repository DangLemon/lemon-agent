# Tests for install.ps1's 8.3 short-path normalization.
#
# Run from a PowerShell prompt:
#
#   pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/tests/test-install-ps1-longpath.ps1
#
# Background: when the Windows profile folder's name contains a space
# ("First Last"), a dot ("Stone.ZEN8"), or an accented character, Windows can
# expose %TEMP%, %LOCALAPPDATA% and friends as an 8.3 alias
# (C:\Users\FIRST~1.LAS\...). PowerShell's FileSystem provider chokes on the
# aliased component once it reaches a provider cmdlet (Tee-Object -FilePath),
# aborting the Node/Electron stages and the desktop post-build probe.
# install.ps1 expands those paths up front; this asserts that contract.
#
# HOW THIS RUNS THE CODE: by executing install.ps1 as a real subprocess with a
# crafted environment and reading what it reports back. `-ProtocolVersion` is a
# side-effect-free early exit that sits BELOW the normalization block, so the
# whole block -- including the script-level Add-Type the kernel32 resolver
# needs -- executes exactly as it does during an install. Nothing here parses
# install.ps1's source (AGENTS.md bans source-reading tests: they pass on
# broken code and fail on correct refactors).
#
# HERMETIC ENVIRONMENT: every case sets all profile and identity selector
# variables explicitly.
# GitHub's own Windows runners hand down a genuinely 8.3-aliased TEMP/TMP
# (C:\Users\RUNNER~1\AppData\Local\Temp), so an inherited variable is a live
# instance of the very bug under test and would contaminate any case that
# didn't override it.
#
# Portability: resolver 3 (profile-root substitution) is pure path arithmetic,
# so the substitution assertions run everywhere, including non-Windows CI. The
# kernel32 and COM resolvers only have anything to expand on a real Windows
# volume; on other hosts they no-op and fall through, which is itself the
# graceful-degradation contract asserted below.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$installScript = Join-Path $repoRoot "scripts/install.ps1"
$script:HarnessConfigPaths = @()

if (-not (Test-Path $installScript)) {
    throw "Could not locate install.ps1 at $installScript"
}

$failures = 0
$script:lastRaw = ''

function Assert-Equal {
    param($Expected, $Actual, [Parameter(Mandatory = $true)][string]$Label)
    if ($Expected -ne $Actual) {
        Write-Host "FAIL: $Label" -ForegroundColor Red
        Write-Host "  expected: $Expected"
        Write-Host "  actual:   $Actual"
        if ($script:lastRaw) {
            # The installer's own account of what it did, plus the environment
            # it was handed. Without both, a failure on a host you cannot reach
            # is pure guesswork.
            Write-Host "  installer reported: $script:lastRaw"
            Write-Host "  environment sent:   $script:lastEnv"
        }
        $script:failures++
    } else {
        Write-Host "OK: $Label" -ForegroundColor Green
    }
}

# --- Harness ---------------------------------------------------------------
# The real profile root the installer will substitute in, derived the same way
# install.ps1 derives it so these assertions hold on any host and any account.
$profileDir = [Environment]::GetFolderPath('UserProfile')
$usersDir = Split-Path -Parent $profileDir
$sep = [System.IO.Path]::DirectorySeparatorChar

# Starting guess for the baseline environment; replaced by the probe below with
# whatever root the installer itself resolves.
$script:baseRoot = $profileDir

# A profile alias that cannot resolve: no such folder exists, so kernel32 and
# COM both fail and only the profile-root substitution can handle it.
$shortProfile = Join-Path $usersDir 'FIRST~1.LAS'

function Join-Parts {
    # Join path segments with the platform separator. Literal forward slashes
    # inside a path would make Split-Path's behavior host-dependent, which is
    # noise this suite doesn't need.
    param([string[]]$Parts)
    return ($Parts -join $sep)
}

# Ask install.ps1 what paths it resolves under a given environment.
#
# -ShowResolvedPaths prints a JSON object on STDOUT and exits without touching
# anything, so the whole normalization block -- including the script-level
# Add-Type the kernel32 resolver needs -- has already run by the time it is
# printed. Stdout, deliberately: three separate stderr capture mechanisms
# (ProcessStartInfo.RedirectStandardError, `2>$file`, and a merged `2>&1`
# pipeline) were each verified to come back EMPTY from the installer on a
# windows-latest runner while stdout arrived intact. The installer's human
# diagnostics still go to stderr; the machine-readable contract is on stdout,
# which is the only stream that survives everywhere.
#
# Environment overrides are applied to this process and restored afterwards,
# since that is what the child inherits.
function Invoke-Normalization {
    param(
        [hashtable]$Environment = @{},
        [string[]]$ExtraArgs = @(),
        [string]$ScriptPath = $installScript
    )

    # Start from a long, self-consistent profile so nothing is inherited;
    # callers override only the variables their case is about. $script:baseRoot
    # is the test's best guess until the probe below replaces it with the root
    # the installer actually resolves.
    $root = $script:baseRoot
    $env0 = @{
        TEMP         = (Join-Parts @($root, 'AppData', 'Local', 'Temp'))
        TMP          = (Join-Parts @($root, 'AppData', 'Local', 'Temp'))
        LOCALAPPDATA = (Join-Parts @($root, 'AppData', 'Local'))
        APPDATA      = (Join-Parts @($root, 'AppData', 'Roaming'))
        USERPROFILE  = $root
        LEMON_HOME  = ''
        LEMON_INSTALLER_BRAND = ''
        LEMON_INSTALL_REPOSITORY = ''
        LEMON_INSTALL_RUNTIME_DIR_NAME = ''
        LEMON_DESKTOP_INTERNAL = ''
        LEMON_DESKTOP_HOME_OVERRIDE = ''
        LEMON_DESKTOP_RUNTIME_DIR_NAME = ''
        LEMON_DESKTOP_HARNESS_CONFIG = ''
    }
    foreach ($key in $Environment.Keys) { $env0[$key] = $Environment[$key] }

    $psExe = (Get-Process -Id $PID).Path
    $outFile = [System.IO.Path]::GetTempFileName()
    $errFile = [System.IO.Path]::GetTempFileName()
    $saved = @{}
    foreach ($key in $env0.Keys) { $saved[$key] = [Environment]::GetEnvironmentVariable($key) }

    try {
        foreach ($key in $env0.Keys) { Set-Item -Path "Env:$key" -Value $env0[$key] }
        $callArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath) + $ExtraArgs + @('-ShowResolvedPaths')
        # The call operator, not Start-Process: on Windows Start-Process does
        # not hand the parent's modified environment block to the child, so the
        # installer saw the runner's real TEMP instead of the aliased one this
        # case sets, and every rewrite assertion came back "not rewritten".
        # `&` inherits the environment on every host.
        #
        # stderr is merged into the same file rather than redirected separately:
        # Windows PowerShell 5.1 wraps ANY stderr from a native command in a
        # NativeCommandError record, and a bare `2>$file` still emits that
        # record into this script's error stream, which fails the 5.1 lane even
        # under 'Continue'. Merging with 2>&1 keeps the bytes and produces no
        # error record. The installer's stdout here is a single JSON object and
        # its diagnostics are all `[lemon] `-prefixed, so the two separate
        # cleanly on the way back out.
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = 0
        try {
            & $psExe @callArgs *> $outFile
        } finally {
            $ErrorActionPreference = $prevEAP
        }
        $exitCode = $LASTEXITCODE
        $raw = @(Get-Content -LiteralPath $outFile -ErrorAction SilentlyContinue)
        $stderr = ($raw | Where-Object { $_ -like '`[lemon`]*' }) -join "`n"
        $stdout = ($raw | Where-Object { $_ -notlike '`[lemon`]*' }) -join "`n"
    } finally {
        foreach ($key in $saved.Keys) {
            if ($null -eq $saved[$key]) {
                Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue
            } else {
                Set-Item -Path "Env:$key" -Value $saved[$key]
            }
        }
        Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
    }

    if ($null -eq $stdout) { $stdout = '' }
    $stdout = $stdout.Trim()
    $script:lastRaw = if ($stdout) { $stdout } else { '(child produced no stdout)' }
    $script:lastEnv = ($env0.Keys | Sort-Object | ForEach-Object { "$_=$($env0[$_])" }) -join '; '

    $paths = $null
    if ($stdout) {
        try { $paths = $stdout | ConvertFrom-Json } catch { $paths = $null }
    }

    # normalized is an object keyed by variable name; flatten to a hashtable so
    # callers can ask "was TEMP rewritten, and to what".
    $rewrites = @{}
    if ($paths -and $paths.normalized) {
        foreach ($prop in $paths.normalized.PSObject.Properties) {
            $rewrites[$prop.Name] = "$($prop.Value)"
        }
    }

    return @{
        ExitCode   = $exitCode
        Stdout     = $stdout
        Rewrites   = $rewrites
        Repository = $(if ($paths) { $paths.repository } else { $null })
        RuntimeDirName = $(if ($paths) { $paths.runtime_dir_name } else { $null })
        BootstrapMarker = $(if ($paths) { $paths.bootstrap_marker } else { $null })
        RecoveryUrl = $(if ($paths) { $paths.recovery_url } else { $null })
        InstallDir = $(if ($paths) { $paths.install_dir } else { $null })
        LemonHome = $(if ($paths) { $paths.lemon_home } else { $null })
        LongRoot   = $(if ($paths) { $paths.long_profile_root } else { $null })
    }
}

function New-InternalHarnessConfig {
    param([string]$Name)
    $path = Join-Path ([System.IO.Path]::GetTempPath()) $Name
    @'
{
  "schemaVersion": 1,
  "profile": "internal",
  "ui": {
    "agents": true,
    "cron": true,
    "messaging": true,
    "terminal": true,
    "webhooks": true
  }
}
'@ | Set-Content -LiteralPath $path -Encoding utf8
    $script:HarnessConfigPaths += $path
    return $path
}

function Get-Rewrite {
    # '' rather than $null for an untouched variable, so a failure prints
    # something legible instead of a blank.
    param($Result, [string]$Name)
    if ($Result.Rewrites.ContainsKey($Name)) { return $Result.Rewrites[$Name] }
    return '<not rewritten>'
}

# Ask the installer once, up front, which long root it resolves on this host,
# and assert every expectation against that. Deriving it independently in the
# test would only prove the two derivations agree, not that the fix works --
# and on GitHub's Windows runners they don't agree, because the runner hands
# down a genuinely 8.3-aliased profile.
$probe = Invoke-Normalization @{ USERPROFILE = $shortProfile }
$longRoot = $probe.LongRoot

Write-Host ""
Write-Host "-- the installer resolves a long profile root --"
if ([string]::IsNullOrEmpty($longRoot)) {
    # Nothing below can mean anything without this, so show the child's whole
    # output rather than leaving a bare assertion failure on an unreachable host.
    Write-Host "FAIL: a long profile root is found" -ForegroundColor Red
    Write-Host "  probe exit code: $($probe.ExitCode)"
    Write-Host "  probe stdout:    $($probe.Stdout)"
    Write-Host "  probe env:       $script:lastEnv"
    Write-Host "  probe stdout (raw):"
    foreach ($line in ($script:lastRaw -split "`r?`n")) {
        if ($line.Trim()) { Write-Host "    $line" }
    }
    Write-Host "FAILED: cannot continue without a long profile root" -ForegroundColor Red
    exit 1
}
Write-Host "OK: a long profile root is found ($longRoot)" -ForegroundColor Green
Assert-Equal -Expected $false -Actual ($longRoot -match '~\d') -Label "the resolved root carries no 8.3 alias"
# Every subsequent case's baseline is now the installer's own root, so a
# "nothing to expand" case really has nothing to expand even on a runner whose
# inherited profile is itself aliased.
$script:baseRoot = $longRoot

Write-Host ""
Write-Host "-- normalization is a no-op for ordinary paths --"

# A profile name with a space is NOT itself a short path; nothing to expand.
# Force the public profile here so this normalization assertion stays
# independent of the Lemon manifest present in the fork checkout.
$result = Invoke-Normalization -Environment @{ LEMON_INSTALLER_BRAND = 'lemon' } `
    -ExtraArgs @('-Repository', 'DangLemon/lemon-agent')
Assert-Equal -Expected 0 -Actual $result.ExitCode -Label "long paths: install.ps1 still reaches its early exit"
Assert-Equal -Expected 0 -Actual $result.Rewrites.Count -Label "long paths: nothing rewritten"
Assert-Equal -Expected $false -Actual ($result.InstallDir -match '~\d') -Label "long paths: InstallDir passes through clean"

Write-Host ""
Write-Host "-- checkout Lemon manifest selects Lemon defaults --"

$result = Invoke-Normalization
$expectedLemonHome = "$($longRoot)${sep}AppData${sep}Local" + '\Lemon AI'
$expectedLemonInstallDir = "$expectedLemonHome\lemon-agent"
Assert-Equal -Expected 0 -Actual $result.ExitCode -Label "checkout manifest: install.ps1 still reaches its early exit"
Assert-Equal -Expected "DangLemon/lemon-agent" -Actual $result.Repository -Label "checkout manifest chooses the Lemon repository"
Assert-Equal -Expected "lemon-agent" -Actual $result.RuntimeDirName -Label "checkout manifest chooses the Lemon runtime directory"
Assert-Equal -Expected ".lemon-ai-bootstrap-complete" -Actual $result.BootstrapMarker -Label "checkout manifest chooses the Lemon bootstrap marker"
Assert-Equal -Expected "https://raw.githubusercontent.com/DangLemon/lemon-agent/main/scripts/install.ps1" -Actual $result.RecoveryUrl -Label "checkout manifest chooses the Lemon recovery URL"
Assert-Equal -Expected $expectedLemonHome -Actual $result.LemonHome -Label "checkout manifest chooses the Lemon home"
Assert-Equal -Expected $expectedLemonInstallDir -Actual $result.InstallDir -Label "checkout manifest chooses the Lemon install dir"

$explicitHome = Join-Path $longRoot 'explicit-lemon-home'
$result = Invoke-Normalization -ExtraArgs @('-LemonHome', $explicitHome)
Assert-Equal -Expected $explicitHome -Actual $result.LemonHome -Label "checkout manifest preserves explicit -LemonHome"
Assert-Equal -Expected (Join-Path $explicitHome 'lemon-agent') -Actual $result.InstallDir -Label "checkout manifest derives InstallDir from explicit -LemonHome"

$result = Invoke-Normalization -Environment @{ LEMON_HOME = (Join-Path $longRoot 'ambient-lemon-home') }
Assert-Equal -Expected (Join-Path $longRoot 'ambient-lemon-home') -Actual $result.LemonHome -Label "checkout manifest honors inherited LEMON_HOME"

$result = Invoke-Normalization -Environment @{ LEMON_INSTALL_RUNTIME_DIR_NAME = 'custom-runtime' }
Assert-Equal -Expected 'custom-runtime' -Actual $result.RuntimeDirName -Label "checkout manifest honors LEMON_INSTALL_RUNTIME_DIR_NAME"
Assert-Equal -Expected (Join-Path $expectedLemonHome 'custom-runtime') -Actual $result.InstallDir -Label "checkout manifest derives InstallDir from the inherited runtime alias"

$customLemonHome = Join-Path $longRoot 'custom-lemon-home'
$result = Invoke-Normalization -Environment @{
    LEMON_HOME = $customLemonHome
    LEMON_INSTALL_RUNTIME_DIR_NAME = 'lemon-runtime'
}
Assert-Equal -Expected $customLemonHome -Actual $result.LemonHome -Label "checkout manifest preserves LEMON_HOME"
Assert-Equal -Expected 'lemon-runtime' -Actual $result.RuntimeDirName -Label "checkout manifest preserves LEMON_INSTALL_RUNTIME_DIR_NAME"
Assert-Equal -Expected (Join-Path $customLemonHome 'lemon-runtime') -Actual $result.InstallDir -Label "checkout manifest derives InstallDir from Lemon aliases"

$result = Invoke-Normalization -Environment @{
    LEMON_INSTALL_RUNTIME_DIR_NAME = 'lemon-runtime'
}
Assert-Equal -Expected 'lemon-runtime' -Actual $result.RuntimeDirName -Label "checkout manifest selects the Lemon runtime alias"

$invalidHarness = Join-Path ([System.IO.Path]::GetTempPath()) "missing-harness-selector-$PID.json"
$result = Invoke-Normalization -Environment @{ LEMON_DESKTOP_HARNESS_CONFIG = $invalidHarness }
Assert-Equal -Expected "DangLemon/lemon-agent" -Actual $result.Repository -Label "invalid explicit selector keeps the Lemon repository"
Assert-Equal -Expected "lemon-agent" -Actual $result.RuntimeDirName -Label "invalid explicit selector keeps the Lemon runtime directory"
Assert-Equal -Expected ".lemon-ai-bootstrap-complete" -Actual $result.BootstrapMarker -Label "invalid explicit selector keeps the Lemon bootstrap marker"

$result = Invoke-Normalization -Environment @{ LEMON_INSTALLER_BRAND = 'lemon' }
Assert-Equal -Expected "DangLemon/lemon-agent" -Actual $result.Repository -Label "brand=lemon overrides checkout manifest"
Assert-Equal -Expected "lemon-agent" -Actual $result.RuntimeDirName -Label "brand=lemon keeps the Lemon AI runtime directory"
Assert-Equal -Expected ".lemon-ai-bootstrap-complete" -Actual $result.BootstrapMarker -Label "brand=lemon keeps the Lemon AI bootstrap marker"
Assert-Equal -Expected "https://raw.githubusercontent.com/DangLemon/lemon-agent/main/scripts/install.ps1" -Actual $result.RecoveryUrl -Label "brand=lemon keeps the Lemon AI recovery URL"

$result = Invoke-Normalization -Environment @{ LEMON_INSTALLER_BRAND = 'lemon' } `
    -ExtraArgs @('-Repository', 'ExampleOrg/runtime-agent')
Assert-Equal -Expected "ExampleOrg/runtime-agent" -Actual $result.Repository -Label "explicit custom repository selects the requested repository"
Assert-Equal -Expected "https://raw.githubusercontent.com/ExampleOrg/runtime-agent/main/scripts/install.ps1" -Actual $result.RecoveryUrl -Label "explicit custom repository selects a repository-aware recovery URL"

$result = Invoke-Normalization -Environment @{
    LEMON_INSTALLER_BRAND = 'lemon'
    LEMON_INSTALL_REPOSITORY = 'ExampleOrg/env-agent'
}
Assert-Equal -Expected "ExampleOrg/env-agent" -Actual $result.Repository -Label "environment custom repository selects the requested repository"
Assert-Equal -Expected "https://raw.githubusercontent.com/ExampleOrg/env-agent/main/scripts/install.ps1" -Actual $result.RecoveryUrl -Label "environment custom repository selects a repository-aware recovery URL"

$rawScript = Join-Path ([System.IO.Path]::GetTempPath()) "raw-install-$PID.ps1"
Copy-Item -LiteralPath $installScript -Destination $rawScript -Force
$result = Invoke-Normalization -ScriptPath $rawScript
Assert-Equal -Expected 0 -Actual $result.ExitCode -Label "raw script: install.ps1 still reaches its early exit"
Assert-Equal -Expected "DangLemon/lemon-agent" -Actual $result.Repository -Label "raw script chooses the Lemon repository"
Assert-Equal -Expected "lemon-agent" -Actual $result.RuntimeDirName -Label "raw script chooses the Lemon runtime directory"
Assert-Equal -Expected ".lemon-ai-bootstrap-complete" -Actual $result.BootstrapMarker -Label "raw script chooses the Lemon bootstrap marker"
Assert-Equal -Expected $expectedLemonHome -Actual $result.LemonHome -Label "raw script chooses the Lemon home"

$result = Invoke-Normalization -ScriptPath $rawScript -Environment @{ LEMON_INSTALLER_BRAND = 'lemon' }
Assert-Equal -Expected "DangLemon/lemon-agent" -Actual $result.Repository -Label "brand=lemon overrides raw script default"
Assert-Equal -Expected "lemon-agent" -Actual $result.RuntimeDirName -Label "brand=lemon chooses the Lemon runtime directory"
Assert-Equal -Expected ".lemon-ai-bootstrap-complete" -Actual $result.BootstrapMarker -Label "brand=lemon chooses the Lemon bootstrap marker"
Assert-Equal -Expected "https://raw.githubusercontent.com/DangLemon/lemon-agent/main/scripts/install.ps1" -Actual $result.RecoveryUrl -Label "brand=lemon chooses the Lemon recovery URL"
Assert-Equal -Expected $expectedLemonHome -Actual $result.LemonHome -Label "brand=lemon chooses the Lemon home"
Remove-Item -LiteralPath $rawScript -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "-- Lemon harness selector uses Lemon install defaults --"

$lemonHarness = New-InternalHarnessConfig "lemon-ai-harness-selector-$PID.json"
$result = Invoke-Normalization @{ LEMON_DESKTOP_HARNESS_CONFIG = $lemonHarness }
Assert-Equal -Expected 0 -Actual $result.ExitCode -Label "Lemon selector: install.ps1 still reaches its early exit"
Assert-Equal -Expected "DangLemon/lemon-agent" -Actual $result.Repository -Label "Lemon selector chooses the Lemon repository"
Assert-Equal -Expected "lemon-agent" -Actual $result.RuntimeDirName -Label "Lemon selector chooses the Lemon runtime directory"
Assert-Equal -Expected ".lemon-ai-bootstrap-complete" -Actual $result.BootstrapMarker -Label "Lemon selector chooses the Lemon bootstrap marker"
Assert-Equal -Expected $expectedLemonHome -Actual $result.LemonHome -Label "Lemon selector chooses the Lemon home"
Assert-Equal -Expected $expectedLemonInstallDir -Actual $result.InstallDir -Label "Lemon selector chooses the Lemon install dir"

$legacyHarness = New-InternalHarnessConfig "legacy-harness-selector-$PID.json"
$result = Invoke-Normalization @{ LEMON_DESKTOP_HARNESS_CONFIG = $legacyHarness }
Assert-Equal -Expected 0 -Actual $result.ExitCode -Label "legacy selector: install.ps1 still reaches its early exit"
Assert-Equal -Expected "DangLemon/lemon-agent" -Actual $result.Repository -Label "legacy selector still chooses the Lemon repository"
Assert-Equal -Expected "lemon-agent" -Actual $result.RuntimeDirName -Label "legacy selector still chooses the Lemon runtime directory"
Assert-Equal -Expected ".lemon-ai-bootstrap-complete" -Actual $result.BootstrapMarker -Label "legacy selector still chooses the Lemon bootstrap marker"
Assert-Equal -Expected $expectedLemonHome -Actual $result.LemonHome -Label "legacy selector still chooses the Lemon home"

Write-Host ""
Write-Host "-- an unresolvable profile alias is rebuilt on the long profile root --"

# The reported failure: TEMP under an 8.3 profile alias that no resolver can
# expand (8dot3 disabled, or a stale alias). GH #52842, GH #57526.
$shortTemp = Join-Parts @($shortProfile, 'AppData', 'Local', 'Temp')
$expectedTemp = Join-Parts @($profileDir, 'AppData', 'Local', 'Temp')

$result = Invoke-Normalization @{ TEMP = $shortTemp; TMP = $shortTemp }
Assert-Equal -Expected 0 -Actual $result.ExitCode -Label "short TEMP: install.ps1 still reaches its early exit"
$expectedTemp = "$longRoot${sep}AppData${sep}Local${sep}Temp"
Assert-Equal -Expected $expectedTemp -Actual (Get-Rewrite $result 'TEMP') -Label "short TEMP is rebuilt on the long profile root"
Assert-Equal -Expected $expectedTemp -Actual (Get-Rewrite $result 'TMP')  -Label "short TMP is rebuilt on the long profile root"
Assert-Equal -Expected 2 -Actual $result.Rewrites.Count -Label "short TEMP: only the aliased variables are touched"

# The profile root itself, with no tail to reattach. USERPROFILE is also where
# the installer looks first for a long root, so this exercises the fallback to
# HOMEDRIVE/HOMEPATH and %USERNAME%.
$result = Invoke-Normalization @{ USERPROFILE = $shortProfile }
Assert-Equal -Expected $longRoot -Actual (Get-Rewrite $result 'USERPROFILE') -Label "bare short profile root expands to the long root"

Write-Host ""
Write-Host "-- every profile-rooted variable is covered, not just TEMP --"

# The desktop stage derives InstallDir from %LOCALAPPDATA%; a short root there
# fails the post-build probe after the build already succeeded (GH #52842).
$result = Invoke-Normalization @{
    TEMP         = $shortTemp
    TMP          = $shortTemp
    LOCALAPPDATA = (Join-Parts @($shortProfile, 'AppData', 'Local'))
    APPDATA      = (Join-Parts @($shortProfile, 'AppData', 'Roaming'))
    USERPROFILE  = $shortProfile
    LEMON_INSTALLER_BRAND = 'lemon'
}
foreach ($name in @('TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE')) {
    $value = Get-Rewrite $result $name
    # Assert it was rewritten AND that the result is clean. Checking only for
    # the absence of a tilde passes vacuously on a variable nothing touched.
    Assert-Equal -Expected $true -Actual ($value.StartsWith($longRoot)) -Label "$name is rebuilt on the long profile root"
    Assert-Equal -Expected $false -Actual ($value -match '~\d') -Label "$name no longer carries an 8.3 alias"
}

# ...and the install paths derived from them are re-derived, not left short.
# This is the difference between "the build works" and "the installer stops
# claiming a successful build failed". Composed with literal backslashes
# because that is how install.ps1 itself builds the default Windows path.
$expectedInstallDir = "$($longRoot)${sep}AppData${sep}Local" + '\Lemon AI\lemon-agent'
Assert-Equal -Expected $expectedInstallDir -Actual $result.InstallDir -Label "InstallDir is re-derived from the long LOCALAPPDATA"

Write-Host ""
Write-Host "-- substitution is scoped to the profile folder --"

# We can only prove the long spelling of the profile root itself. A short
# component anywhere else must be left exactly as the caller set it.
$belowProfile = Join-Parts @($profileDir, 'DEEPLY~1', 'Temp')
$result = Invoke-Normalization @{ TEMP = $belowProfile; TMP = $belowProfile }
Assert-Equal -Expected '<not rewritten>' -Actual (Get-Rewrite $result 'TEMP') -Label "a short component below the profile root is left alone"

# A custom TEMP on another volume has no profile root to substitute.
$otherVolume = Join-Parts @("D:", 'SHORT~1', 'Temp')
$result = Invoke-Normalization @{ TEMP = $otherVolume; TMP = $otherVolume }
Assert-Equal -Expected '<not rewritten>' -Actual (Get-Rewrite $result 'TEMP') -Label "short TEMP outside the profile is left alone"

Write-Host ""
Write-Host "-- an explicit -InstallDir is normalized, never replaced --"

$result = Invoke-Normalization -Environment @{ TEMP = $shortTemp; TMP = $shortTemp } `
    -ExtraArgs @('-InstallDir', (Join-Path $shortProfile 'custom-lemon'))
Assert-Equal -Expected (Join-Path $longRoot 'custom-lemon') -Actual $result.InstallDir -Label "explicit -InstallDir keeps the caller's directory, on the long root"

# --- Summary ---------------------------------------------------------------
Write-Host ""
foreach ($path in $script:HarnessConfigPaths) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
}
if ($failures -gt 0) {
    Write-Host "FAILED: $failures assertion(s) failed" -ForegroundColor Red
    exit 1
} else {
    Write-Host "All 8.3 short-path normalization tests passed." -ForegroundColor Green
    exit 0
}
