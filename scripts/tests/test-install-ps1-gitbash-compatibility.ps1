# Unit tests for install.ps1's Git Bash compatibility and Mandatory-ASLR
# guidance helpers. The installer itself is never executed: functions are
# extracted through the PowerShell AST to avoid downloads, PATH changes, or
# user-environment writes.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$installScript = Join-Path $repoRoot "scripts\install.ps1"

$failures = 0
function Assert-Equal {
    param($Expected, $Actual, [string]$Label)
    if ($Expected -ne $Actual) {
        Write-Host "FAIL: $Label" -ForegroundColor Red
        Write-Host "  expected: $Expected"
        Write-Host "  actual:   $Actual"
        $script:failures++
    } else {
        Write-Host "OK: $Label" -ForegroundColor Green
    }
}
function Assert-True {
    param($Condition, [string]$Label)
    if (-not $Condition) {
        Write-Host "FAIL: $Label" -ForegroundColor Red
        $script:failures++
    } else {
        Write-Host "OK: $Label" -ForegroundColor Green
    }
}
function Wait-ForPath {
    param([string]$Path, [int]$TimeoutMilliseconds = 5000)
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path -LiteralPath $Path)) {
        if ($stopwatch.ElapsedMilliseconds -ge $TimeoutMilliseconds) { return $false }
        Start-Sleep -Milliseconds 50
    }
    return $true
}

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $installScript, [ref]$tokens, [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
    throw "install.ps1 has parse errors: $($parseErrors -join '; ')"
}

foreach ($name in @(
    "Test-GitBashCompatibility",
    "Test-MandatoryAslrEnabled",
    "Get-GitRootFromBashPath",
    "New-GitBashAslrFailureReason",
    "Wait-PortableGitExtraction",
    "Stage-Git"
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

Write-Host ""
Write-Host "-- Git root resolution --"
Assert-Equal "C:\Program Files\Git" `
    (Get-GitRootFromBashPath "C:\Program Files\Git\bin\bash.exe") `
    "PortableGit/full Git bin layout"
Assert-Equal "C:\Program Files\Git" `
    (Get-GitRootFromBashPath "C:\Program Files\Git\usr\bin\bash.exe") `
    "usr/bin layout"

Write-Host ""
Write-Host "-- Mandatory ASLR detection --"
function Get-ProcessMitigation {
    param([switch]$System)
    [pscustomobject]@{ Aslr = [pscustomobject]@{ ForceRelocateImages = "ON" } }
}
Assert-Equal $true (Test-MandatoryAslrEnabled) "ForceRelocateImages ON is detected"
function Get-ProcessMitigation {
    param([switch]$System)
    [pscustomobject]@{ Aslr = [pscustomobject]@{ ForceRelocateImages = "NOTSET" } }
}
Assert-Equal $false (Test-MandatoryAslrEnabled) "ForceRelocateImages NOTSET is not diagnosed"

Write-Host ""
Write-Host "-- Actionable remediation --"
$reason = New-GitBashAslrFailureReason "C:\Program Files\Git\bin\bash.exe"
Assert-True ($reason -match "Mandatory ASLR") "reason identifies Mandatory ASLR"
Assert-True ($reason -match "Reinstalling Git will not change") "reason rejects ineffective reinstall"
Assert-True ($reason -match [regex]::Escape("C:\Program Files\Git")) "reason uses selected Git root"
Assert-True ($reason -match "Set-ProcessMitigation") "reason includes targeted mitigation command"

Write-Host ""
Write-Host "-- External-program probe --"
$gitCommand = Get-Command git -ErrorAction SilentlyContinue
$gitBash = $null
if ($gitCommand -and $gitCommand.Source) {
    $gitRoot = Split-Path (Split-Path $gitCommand.Source -Parent) -Parent
    foreach ($candidate in @("$gitRoot\bin\bash.exe", "$gitRoot\usr\bin\bash.exe")) {
        if (Test-Path -LiteralPath $candidate) { $gitBash = $candidate; break }
    }
}
if ($gitBash) {
    Assert-Equal $true (Test-GitBashCompatibility $gitBash) `
        "installed Git Bash launches external MSYS programs"
} else {
    Write-Host "SKIP: no Git Bash found next to git.exe" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "-- PortableGit extraction --"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("lemon git extraction " + [guid]::NewGuid())
$rootProcess = $null
$childProcess = $null
try {
    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    $powershellExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName

    $exitScript = Join-Path $tempRoot "exit.ps1"
    Set-Content -LiteralPath $exitScript -Value "exit 7" -Encoding UTF8
    $exitProcess = Start-Process -FilePath $powershellExe `
        -ArgumentList "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "`"$exitScript`"" `
        -NoNewWindow -PassThru
    $exitError = $null
    try {
        Wait-PortableGitExtraction -Process $exitProcess -TimeoutMilliseconds 5000
    } catch {
        $exitError = $_.Exception.Message
    } finally {
        $exitProcess.Dispose()
    }
    Assert-Equal "PortableGit extraction failed (exit code 7)" $exitError `
        "nonzero extractor exit remains distinct from timeout"

    $childPidPath = Join-Path $tempRoot "child.pid"
    $childReadyPath = Join-Path $tempRoot "child.ready"
    $rootReadyPath = Join-Path $tempRoot "root.ready"
    $childScript = Join-Path $tempRoot "child.ps1"
    $rootScript = Join-Path $tempRoot "root.ps1"
    Set-Content -LiteralPath $childScript -Encoding UTF8 -Value @'
param([string]$PidPath, [string]$ReadyPath)
Set-Content -LiteralPath $PidPath -Value $PID
Set-Content -LiteralPath $ReadyPath -Value "ready"
while ($true) { Start-Sleep -Seconds 1 }
'@
    Set-Content -LiteralPath $rootScript -Encoding UTF8 -Value @'
param(
    [string]$PowerShellExe,
    [string]$ChildScript,
    [string]$ChildPidPath,
    [string]$ChildReadyPath,
    [string]$RootReadyPath
)
$childArguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$ChildScript`" `"$ChildPidPath`" `"$ChildReadyPath`""
$child = Start-Process -FilePath $PowerShellExe `
    -ArgumentList $childArguments -NoNewWindow -PassThru
Set-Content -LiteralPath $RootReadyPath -Value $child.Id
while ($true) { Start-Sleep -Seconds 1 }
'@

    $rootArguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$rootScript`" `"$powershellExe`" `"$childScript`" `"$childPidPath`" `"$childReadyPath`" `"$rootReadyPath`""
    $rootProcess = Start-Process -FilePath $powershellExe `
        -ArgumentList $rootArguments -NoNewWindow -PassThru
    Assert-True (Wait-ForPath -Path $rootReadyPath) "extractor fixture starts root process"
    Assert-True (Wait-ForPath -Path $childReadyPath) "extractor fixture starts child process"
    if (Test-Path -LiteralPath $childPidPath) {
        $childProcess = Get-Process -Id ([int](Get-Content -LiteralPath $childPidPath)) -ErrorAction Stop
    }

    $timeoutError = $null
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Wait-PortableGitExtraction -Process $rootProcess -TimeoutMilliseconds 1000
    } catch [System.TimeoutException] {
        $timeoutError = $_.Exception.Message
    }
    $stopwatch.Stop()

    Assert-True ($timeoutError -match "timed out after 1 second") `
        "extractor reports its bounded timeout"
    Assert-True ($timeoutError -match "process tree was terminated") `
        "extractor reports process-tree cleanup"
    Assert-True ($stopwatch.ElapsedMilliseconds -lt 15000) `
        "extractor timeout returns within cleanup budget"
    $rootProcess.Refresh()
    if ($childProcess) { $childProcess.Refresh() }
    Assert-True $rootProcess.HasExited "extractor root is terminated"
    Assert-True ($childProcess -and $childProcess.HasExited) "extractor child is terminated"
} finally {
    foreach ($process in @($childProcess, $rootProcess)) {
        if ($process) {
            try { if (-not $process.HasExited) { $process.Kill() } } catch { }
            $process.Dispose()
        }
    }
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "-- Stage failure propagation --"
function Install-Git { return $false }
$script:GitInstallFailureReason = "specific Git Bash failure"
$stageError = $null
try { Stage-Git } catch { $stageError = $_.Exception.Message }
Assert-Equal "specific Git Bash failure" $stageError "Git stage preserves actionable reason"

Write-Host ""
if ($failures -gt 0) {
    Write-Host "FAILED: $failures assertion(s) failed" -ForegroundColor Red
    exit 1
}
Write-Host "All Git Bash compatibility tests passed." -ForegroundColor Green
exit 0
