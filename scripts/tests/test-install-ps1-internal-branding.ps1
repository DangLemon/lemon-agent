# Behavioral tests for install.ps1's internal Lemon AI identity decisions.
#
# Run on Windows PowerShell 5.1 or PowerShell 7:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/test-install-ps1-internal-branding.ps1
#
# The harness runs the real config-templates stage against a fresh temporary
# profile, then exercises the shipped shortcut writer against temporary profile
# folders. It never touches the invoking user's home, shortcuts, or PATH.

param(
    [string]$DesktopBuildRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installPs1 = Join-Path (Join-Path $PSScriptRoot '..') 'install.ps1' | Resolve-Path
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $installPs1, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
    throw "install.ps1 has PowerShell parse errors: $($parseErrors -join '; ')"
}

$functionNames = @(
    'Get-InstallerBrandIdentity',
    'Get-DefaultSoulContent',
    'Get-InstallerDiagnosticLines',
    'Get-DesktopExecutableCandidates',
    'Get-DesktopShortcutIdentity',
    'Test-ShortcutOwnsTarget',
    'New-DesktopShortcuts'
)

foreach ($name in $functionNames) {
    $fn = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq $name
    }, $true)
    if (-not $fn) {
        throw "$name not found in $installPs1"
    }
    Invoke-Expression $fn.Extent.Text
}


$script:Failures = 0

$smokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("lemon-ai-branding-" + [guid]::NewGuid().ToString('N'))
$smokeHome = Join-Path $smokeRoot 'home'
$smokeInstall = Join-Path $smokeRoot 'install'
$smokePrograms = Join-Path $smokeRoot 'programs'
$smokeDesktop = Join-Path $smokeRoot 'desktop'

try {
    New-Item -ItemType Directory -Force -Path $smokeHome, $smokeInstall, $smokePrograms, $smokeDesktop | Out-Null
    Set-Content -LiteralPath (Join-Path $smokeInstall ([string]::Concat('.', 'env.example'))) -Value 'OPENAI_API_KEY=' -NoNewline
    Set-Content -LiteralPath (Join-Path $smokeInstall 'cli-config.yaml.example') -Value 'profiles: {}' -NoNewline
} catch {
    throw "Could not prepare the isolated installer smoke profile: $($_.Exception.Message)"
}

function Assert-True {
    param([bool]$Condition, [string]$Name)
    if ($Condition) {
        Write-Host "  PASS  $Name"
    } else {
        Write-Host "  FAIL  $Name"
        $script:Failures++
    }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Name)
    Assert-True ($Expected -ceq $Actual) $Name
    if ($Expected -cne $Actual) {
        Write-Host "        expected: [$Expected]"
        Write-Host "        actual:   [$Actual]"
    }
}

function Assert-ThrowsLike {
    param([scriptblock]$Script, [string]$Pattern, [string]$Name)
    $matched = $false
    try {
        & $Script
    } catch {
        $matched = $_.Exception.Message -like $Pattern
    }
    Assert-True $matched $Name
}

# Test-ShortcutOwnsTarget only needs path normalization as a seam here. Its
# production resolver is covered by test-install-ps1-longpath.ps1.
function ConvertTo-LongPath {
    param([string]$Path)
    return $Path
}

function Write-Success {
    param([string]$Message)
}

function Write-Warn {
    param([string]$Message)
}

Write-Host 'install.ps1 internal branding identity'

$lemon = Get-InstallerBrandIdentity -InternalBuild $true
Assert-Equal 'Lemon AI' $lemon.AgentName 'internal agent name is Lemon AI'
Assert-Equal 'Lemon Digital' $lemon.CompanyName 'internal company name is Lemon Digital'
$lemonSoul = Get-DefaultSoulContent -AgentName $lemon.AgentName -CompanyName $lemon.CompanyName
Assert-True ($lemonSoul.StartsWith('You are Lemon AI, built by Lemon Digital.')) `
    'internal SOUL seed starts with Lemon AI and Lemon Digital'
Assert-True (-not $lemonSoul.Contains('Hermes')) 'internal SOUL seed excludes Hermes'
Assert-True (-not $lemonSoul.Contains('Nous Research')) 'internal SOUL seed excludes Nous Research'
$lemonDiagnostics = @(Get-InstallerDiagnosticLines `
    -InternalBuild $true `
    -LemonHome 'C:\Users\tester\AppData\Local\Lemon AI' `
    -InstallDir 'C:\Users\tester\AppData\Local\Lemon AI\lemon-agent' `
    -RuntimeDirName 'lemon-agent' `
    -CliArgs 'desktop')
Assert-True ($lemonDiagnostics -contains 'Lemon AI home: C:\Users\tester\AppData\Local\Lemon AI') `
    'internal diagnostics label Lemon AI home'
Assert-True ($lemonDiagnostics -contains 'Lemon AI install root: C:\Users\tester\AppData\Local\Lemon AI\lemon-agent') `
    'internal diagnostics label Lemon AI install root'
Assert-True ($lemonDiagnostics -contains 'Lemon AI runtime dir: lemon-agent') `
    'internal diagnostics label Lemon runtime directory'
Assert-True ($lemonDiagnostics -contains 'Lemon AI CLI command: lemon desktop') `
    'internal diagnostics keep lemon as the technical CLI command'

$public = Get-InstallerBrandIdentity -InternalBuild $false
Assert-Equal 'Lemon AI' $public.AgentName 'ordinary agent name remains Lemon AI'
Assert-Equal 'Lemon Digital' $public.CompanyName 'ordinary company is Lemon Digital'
$publicSoul = Get-DefaultSoulContent -AgentName $public.AgentName -CompanyName $public.CompanyName
Assert-True ($publicSoul.StartsWith('You are Lemon AI, built by Lemon Digital.')) `
    'ordinary SOUL seed keeps the public Lemon AI identity'


$desktopRoot = 'C:\fixture\apps\desktop'
$internalCandidates = @(Get-DesktopExecutableCandidates -DesktopDir $desktopRoot -InternalBuild $true)
Assert-Equal 2 $internalCandidates.Count 'internal build probes both architecture output directories'
Assert-True (@($internalCandidates | Where-Object { [System.IO.Path]::GetFileName($_) -ne 'Lemon AI.exe' }).Count -eq 0) `
    'internal build accepts only Lemon AI.exe'
Assert-True (@($internalCandidates | Where-Object { $_ -like '*Hermes.exe' }).Count -eq 0) `
    'internal build has no Hermes.exe success fallback'

$publicCandidates = @(Get-DesktopExecutableCandidates -DesktopDir $desktopRoot -InternalBuild $false)
Assert-Equal 2 $publicCandidates.Count 'ordinary build probes both architecture output directories'
Assert-True (@($publicCandidates | Where-Object { [System.IO.Path]::GetFileName($_) -ne 'Lemon AI.exe' }).Count -eq 0) `
    'ordinary build keeps Lemon AI.exe'

$lemonExe = Join-Path (Join-Path $desktopRoot 'win-unpacked') 'Lemon AI.exe'
$lemonShortcut = Get-DesktopShortcutIdentity -TargetExe $lemonExe -InternalBuild $true
Assert-Equal 'Lemon AI.lnk' $lemonShortcut.LinkName 'internal shortcut is Lemon AI.lnk'
Assert-Equal 'Lemon AI' $lemonShortcut.Description 'internal shortcut description is Lemon AI'
$legacyHermesExe = Join-Path (Join-Path $desktopRoot 'win-unpacked') 'Hermes.exe'
Assert-ThrowsLike {
    Get-DesktopShortcutIdentity -TargetExe $legacyHermesExe -InternalBuild $true | Out-Null
} '*requires Lemon AI.exe*' 'internal shortcut rejects a legacy Hermes.exe target'

$publicShortcut = Get-DesktopShortcutIdentity -TargetExe $lemonExe -InternalBuild $false
Assert-Equal 'Lemon AI.lnk' $publicShortcut.LinkName 'ordinary shortcut remains Lemon AI.lnk'
Assert-Equal 'Lemon AI' $publicShortcut.Description 'ordinary shortcut description remains Lemon AI'

# Legacy Hermes.exe is accepted only by the migration ownership check, which lets
# a Lemon install remove an old owned shortcut after creating Lemon AI.lnk.
$InternalDesktopBuild = $true
$legacyHermesExe = Join-Path (Join-Path $desktopRoot 'win-unpacked') 'Hermes.exe'
$legacyShortcut = [pscustomobject]@{ TargetPath = $legacyHermesExe }
$workDir = Split-Path -Parent $lemonExe
Assert-True (Test-ShortcutOwnsTarget `
    -Shortcut $legacyShortcut -TargetExe $lemonExe -WorkDir $workDir) `
    'internal migration recognizes an owned legacy Hermes.exe shortcut'
$foreignLegacy = [pscustomobject]@{
    TargetPath = Join-Path (Join-Path $desktopRoot 'other-install') 'Hermes.exe'
}
Assert-True (-not (Test-ShortcutOwnsTarget `
    -Shortcut $foreignLegacy -TargetExe $lemonExe -WorkDir $workDir)) `
    'internal migration leaves a foreign Hermes.exe shortcut untouched'

Write-Host ''
Write-Host 'isolated config-templates stage and shortcut smoke'


$cmdCapture = Join-Path $smokeRoot 'install-cmd-args.txt'
$cmdStub = Join-Path $smokeRoot 'powershell.cmd'
Set-Content -LiteralPath $cmdStub -Encoding Ascii -Value @(
    '@echo off'
    'echo %* > "%CMD_INSTALL_CAPTURE%"'
    'exit /b 0'
)
$oldPath = $env:PATH
$oldRepo = $env:LEMON_INSTALL_REPOSITORY
$oldCapture = $env:CMD_INSTALL_CAPTURE
try {
    $env:PATH = "$smokeRoot;$oldPath"
    $env:LEMON_INSTALL_REPOSITORY = 'DangLemon/lemon-agent'
    $env:CMD_INSTALL_CAPTURE = $cmdCapture
    & cmd.exe /d /c (Join-Path $PSScriptRoot '..\install.cmd') | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'shipped install.cmd executes successfully with the PowerShell stub'
    $capturedCmdArgs = Get-Content -LiteralPath $cmdCapture -Raw
    Assert-True ($capturedCmdArgs.Contains("`$installerArgs = @{ Repository = `$repo }")) `
        'shipped install.cmd uses named Repository splatting'
    Assert-True ($capturedCmdArgs.Contains('DangLemon/lemon-agent')) `
        'shipped install.cmd carries the selected Lemon repository'
} finally {
    $env:PATH = $oldPath
    $env:LEMON_INSTALL_REPOSITORY = $oldRepo
    $env:CMD_INSTALL_CAPTURE = $oldCapture
}
$env:LEMON_INSTALLER_BRAND = 'lemon'
$powerShellExe = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh.exe' } else { 'powershell.exe' }
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $stageOutput = @(& $powerShellExe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $installPs1 `
        -Stage 'config-templates' `
        -NonInteractive `
        -Json `
        -LemonHome $smokeHome `
        -InstallDir $smokeInstall 2>&1)
    $stageExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
Assert-Equal 0 $stageExit 'config-templates stage exits successfully for a clean profile'

$stageFrame = $stageOutput |
    Where-Object { $_ -is [string] -and $_.TrimStart().StartsWith('{') } |
    Select-Object -Last 1
if ($stageFrame) {
    try {
        $parsedStage = $stageFrame | ConvertFrom-Json
        Assert-True ([bool]$parsedStage.ok) 'config-templates stage reports ok=true'
        Assert-Equal 'config-templates' $parsedStage.stage 'config-templates stage reports its stable name'
    } catch {
        Assert-True $false 'config-templates stage emits valid JSON'
    }
} else {
    Assert-True $false 'config-templates stage emits a JSON result frame'
}

$smokeSoulPath = Join-Path $smokeHome 'SOUL.md'
Assert-True (Test-Path -LiteralPath $smokeSoulPath -PathType Leaf) 'clean profile receives SOUL.md from the real stage'
if (Test-Path -LiteralPath $smokeSoulPath -PathType Leaf) {
    $smokeSoul = Get-Content -LiteralPath $smokeSoulPath -Raw
    Assert-True ($smokeSoul.Contains('You are Lemon AI, built by Lemon Digital.')) `
        'clean profile SOUL.md uses Lemon AI and Lemon Digital'
    Assert-True (-not $smokeSoul.Contains('Lemon AI')) 'clean profile SOUL.md has no Lemon AI identity'
    Assert-True (-not $smokeSoul.Contains('Nous Research')) 'clean profile SOUL.md has no Nous Research identity'
}

$smokeAppDir = if ([string]::IsNullOrWhiteSpace($DesktopBuildRoot)) {
    Join-Path $smokeInstall 'apps\desktop\release\win-unpacked'
} else {
    (Resolve-Path -LiteralPath $DesktopBuildRoot -ErrorAction Stop).ProviderPath
}
$smokeLemonExe = Join-Path $smokeAppDir 'Lemon AI.exe'
$smokeLemonExe = Join-Path $smokeAppDir 'Lemon AI.exe'
if ([string]::IsNullOrWhiteSpace($DesktopBuildRoot)) {
    New-Item -ItemType Directory -Force -Path (Join-Path $smokeAppDir 'resources') | Out-Null
    New-Item -ItemType File -Force -Path $smokeLemonExe, (Join-Path $smokeAppDir 'resources\icon.ico') | Out-Null
} else {
    Assert-True (Test-Path -LiteralPath $smokeLemonExe -PathType Leaf) 'built desktop output contains Lemon AI.exe'
    Assert-True (-not (Test-Path -LiteralPath $smokeLemonExe -PathType Leaf)) 'built internal output has no Lemon AI.exe'
}

$shell = New-Object -ComObject WScript.Shell
$legacyPath = Join-Path $smokePrograms 'Lemon AI.lnk'
$legacyShortcutSmoke = $shell.CreateShortcut($legacyPath)
$legacyShortcutSmoke.TargetPath = $smokeLemonExe
$legacyShortcutSmoke.WorkingDirectory = $smokeAppDir
$legacyShortcutSmoke.Save()

$foreignPath = Join-Path $smokeDesktop 'Lemon AI.lnk'
$foreignShortcutSmoke = $shell.CreateShortcut($foreignPath)
$foreignShortcutSmoke.TargetPath = Join-Path $smokeRoot 'foreign\Lemon AI.exe'
$foreignShortcutSmoke.Save()

$InternalDesktopBuild = $true
New-DesktopShortcuts `
    -TargetExe $smokeLemonExe `
    -ProgramsFolder $smokePrograms `
    -DesktopFolder $smokeDesktop

foreach ($shortcutPath in @(
    (Join-Path $smokePrograms 'Lemon AI.lnk'),
    (Join-Path $smokeDesktop 'Lemon AI.lnk')
)) {
    Assert-True (Test-Path -LiteralPath $shortcutPath -PathType Leaf) `
        "clean profile creates $(Split-Path -Leaf $shortcutPath)"
    if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
        $shortcut = $shell.CreateShortcut($shortcutPath)
        Assert-Equal $smokeLemonExe $shortcut.TargetPath `
            "$(Split-Path -Leaf $shortcutPath) targets Lemon AI.exe"
        Assert-Equal 'Lemon AI' $shortcut.Description `
            "$(Split-Path -Leaf $shortcutPath) has Lemon AI description"
    }
}
Assert-True (-not (Test-Path -LiteralPath $legacyPath -PathType Leaf)) `
    'clean profile removes an owned legacy Lemon AI shortcut'
Assert-True (Test-Path -LiteralPath $foreignPath -PathType Leaf) `
    'clean profile keeps a foreign Lemon AI shortcut'

if ($script:Failures -gt 0) {
    try {
        Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
    } catch {}
    Write-Host ''
    Write-Host "$script:Failures assertion(s) failed"
    exit 1
}

Write-Host ''
Write-Host 'all assertions passed'

try {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
} catch {}
