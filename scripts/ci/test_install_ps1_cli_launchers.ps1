# Behavioral test for install.ps1's lemon launcher staging (PR #92092,
# reworked for the managed-binary-dir layout).
#
# Run: powershell.exe -NoProfile -File scripts/ci/test_install_ps1_cli_launchers.ps1
#
# The test lifts the real Install-LemonCommandLaunchers function from the
# PowerShell AST and executes it against a temporary install tree. It never
# reads or changes the user's PATH. The staging destination is passed in by
# the caller (Set-PathVariable passes $LemonHome\bin -- the managed binary
# dir OUTSIDE the git checkout); here it is a sibling temp dir, which also
# proves the function stages wherever it is pointed rather than assuming
# the legacy in-checkout location.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installPs1 = Join-Path (Join-Path $PSScriptRoot '..') 'install.ps1' | Resolve-Path
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $installPs1, [ref]$null, [ref]$null)

$fn = $ast.Find({
    param($n)
    $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $n.Name -eq 'Install-LemonCommandLaunchers'
}, $true)
$relativePathFn = $ast.Find({
    param($n)
    $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $n.Name -eq 'Get-LemonLauncherRelativePath'
}, $true)
$powershellLauncherFn = $ast.Find({
    param($n)
    $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $n.Name -eq 'Write-LemonPowerShellLauncher'
}, $true)
$noVenvFn = $ast.Find({
    param($n)
    $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $n.Name -eq 'Install-LemonNoVenvCommandLauncher'
}, $true)

if (-not $relativePathFn) {
    throw "Get-LemonLauncherRelativePath not found in $installPs1"
}
if (-not $powershellLauncherFn) {
    throw "Write-LemonPowerShellLauncher not found in $installPs1"
}
if (-not $fn) {
    throw "Install-LemonCommandLaunchers not found in $installPs1"
}
if (-not $noVenvFn) {
    throw "Install-LemonNoVenvCommandLauncher not found in $installPs1"
}

Invoke-Expression $relativePathFn.Extent.Text
Invoke-Expression $powershellLauncherFn.Extent.Text
Invoke-Expression $fn.Extent.Text
Invoke-Expression $noVenvFn.Extent.Text

$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$caseRoot = [System.IO.Path]::GetFullPath((Join-Path $tempBase (
    'lemon-cli-launcher-test-' + [guid]::NewGuid().ToString('N')
)))
if (-not $caseRoot.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to create test directory outside the system temp directory: $caseRoot"
}

$script:Failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Name)
    if ($Condition) {
        Write-Host "  PASS  $Name"
    } else {
        Write-Host "  FAIL  $Name"
        $script:Failures++
    }
}

function Assert-BytesEqual {
    param([byte[]]$Expected, [byte[]]$Actual, [string]$Name)
    $same = $Expected.Length -eq $Actual.Length
    if ($same) {
        for ($i = 0; $i -lt $Expected.Length; $i++) {
            if ($Expected[$i] -ne $Actual[$i]) {
                $same = $false
                break
            }
        }
    }
    Assert-True $same $Name
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Name)
    Assert-True ($Expected -ceq $Actual) $Name
}

function Assert-ThrowsLike {
    param([scriptblock]$Script, [string]$Pattern, [string]$Name)
    $threw = $false
    try {
        & $Script
    } catch {
        $threw = $_.Exception.Message -like $Pattern
    }
    Assert-True $threw $Name
}

try {
    $installRoot = Join-Path $caseRoot 'lemon-agent'
    $binDir = Join-Path $caseRoot 'bin'
    New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

    # Fail-before-PATH-mutation: a missing required source must throw and
    # must not leave an empty destination for the caller to put on PATH.
    $missingThrew = $false
    try {
        Install-LemonCommandLaunchers -Root $installRoot -Destination $binDir -Repository 'DangLemon/lemon-agent' | Out-Null
    } catch {
        $missingThrew = $_.Exception.Message -like '*required launcher not found*'
    }
    Assert-True $missingThrew 'missing lemon.exe fails the launcher stage'
    Assert-True (-not (Test-Path -LiteralPath $binDir)) `
        'failure does not create an empty PATH directory'

    $scriptsDir = Join-Path $installRoot 'venv\Scripts'
    New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null
    $lemonV1 = [byte[]](77, 90, 1)
    $lemonV2 = [byte[]](77, 90, 2)
    $acp = [byte[]](77, 90, 3)
    [System.IO.File]::WriteAllBytes((Join-Path $scriptsDir 'lemon.exe'), $lemonV1)
    Set-Content -Path (Join-Path $installRoot 'venv\pyvenv.cfg') `
        -Value "home = X" -Encoding Ascii

    $staged = Install-LemonCommandLaunchers -Root $installRoot -Destination $binDir -Repository 'DangLemon/lemon-agent'
    Assert-True ($staged -eq $binDir) 'returns the destination it staged into'
    Assert-True (Test-Path -LiteralPath (Join-Path $binDir 'lemon.cmd')) `
        'normal venv: repository-aware cmd wrapper lands in the destination'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $binDir 'lemon.exe'))) `
        'normal venv: no global exe copy is staged'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $binDir 'lemon-acp.cmd'))) `
        'optional ACP launcher may be absent'

    [System.IO.File]::WriteAllBytes((Join-Path $scriptsDir 'lemon.exe'), $lemonV2)
    [System.IO.File]::WriteAllBytes((Join-Path $scriptsDir 'lemon-acp.exe'), $acp)
    Install-LemonCommandLaunchers -Root $installRoot -Destination $binDir -Repository 'DangLemon/lemon-agent' | Out-Null
    $refreshedCmdBody = [System.IO.File]::ReadAllText((Join-Path $binDir 'lemon.cmd'))
    Assert-True ($refreshedCmdBody.Contains('"%~dp0..\lemon-agent\venv\Scripts\lemon.exe" %*') -and $refreshedCmdBody.Contains('LEMON_UPDATE_REPOSITORY=DangLemon/lemon-agent')) `
        'installer refreshes the repository-aware Lemon AI CLI wrapper'
    $acpCmdBody = [System.IO.File]::ReadAllText((Join-Path $binDir 'lemon-acp.cmd'))
    Assert-True ($acpCmdBody.Contains('"%~dp0..\lemon-agent\venv\Scripts\lemon-acp.exe" %*') -and $acpCmdBody.Contains('LEMON_UPDATE_REPOSITORY=DangLemon/lemon-agent')) `
        'installer stages the optional ACP wrapper when present'

    # Relocatable venv: uses the same wrapper form; delegating to the in-venv
    # executable avoids uv trampoline failures and keeps the update source scoped.
    Set-Content -Path (Join-Path $installRoot 'venv\pyvenv.cfg') `
        -Value "home = X`r`nrelocatable = true" -Encoding Ascii
    Install-LemonCommandLaunchers -Root $installRoot -Destination $binDir -Repository 'DangLemon/lemon-agent' | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $binDir 'lemon.cmd')) `
        'relocatable venv: .cmd wrapper staged'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $binDir 'lemon.exe'))) `
        'relocatable venv: stale exe copy removed'
    $cmdBody = [System.IO.File]::ReadAllText((Join-Path $binDir 'lemon.cmd'))
    Assert-True ($cmdBody.Contains('"%~dp0..\lemon-agent\venv\Scripts\lemon.exe" %*') -and $cmdBody.Contains('LEMON_UPDATE_REPOSITORY=DangLemon/lemon-agent')) `
        'wrapper invokes the in-venv exe, pins the update repository, and forwards args'

    $publicBinDir = Join-Path $caseRoot 'public-bin'
    Install-LemonCommandLaunchers -Root $installRoot -Destination $publicBinDir -Repository 'DangLemon/lemon-agent' | Out-Null
    $publicBody = [System.IO.File]::ReadAllText((Join-Path $publicBinDir 'lemon.cmd'))
    Assert-True ($publicBody.Contains('LEMON_UPDATE_REPOSITORY=DangLemon/lemon-agent')) `
        'second installation keeps an independent public repository identity'
    Assert-True ($cmdBody.Contains('LEMON_UPDATE_REPOSITORY=DangLemon/lemon-agent')) `
        'first installation keeps its Lemon repository identity'

    $noVenvBinDir = Join-Path $caseRoot 'no-venv-bin'
    $pythonExe = Join-Path $caseRoot 'python.exe'
    [System.IO.File]::WriteAllBytes($pythonExe, [byte[]](77, 90, 4))
    Set-Content -Path (Join-Path $installRoot 'lemon') -Value '# launcher' -Encoding Ascii
    Install-LemonNoVenvCommandLauncher -Root $installRoot -Destination $noVenvBinDir `
        -Repository 'DangLemon/lemon-agent' -PythonExe $pythonExe | Out-Null
    $noVenvBody = [System.IO.File]::ReadAllText((Join-Path $noVenvBinDir 'lemon.cmd'))
    Assert-True ($noVenvBody.Contains('LEMON_UPDATE_REPOSITORY=DangLemon/lemon-agent')) `
        '-NoVenv wrapper embeds the selected repository'
    Assert-True ($noVenvBody.Contains('"%~dp0..\python.exe"') -and $noVenvBody.Contains('"%~dp0..\lemon-agent\lemon"')) `
        '-NoVenv wrapper invokes the selected Python and checkout launcher'

    $shadowBinDir = Join-Path $caseRoot 'shadow-bin'
    New-Item -ItemType Directory -Force -Path $shadowBinDir | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $shadowBinDir 'lemon.exe'), [byte[]](77, 90, 9))
    function Remove-Item {
        [CmdletBinding()]
        param(
            [string[]]$LiteralPath,
            [string[]]$Path,
            [switch]$Force,
            [Parameter(ValueFromRemainingArguments=$true)]
            [object[]]$Remaining
        )
        if ($LiteralPath -and [string]$LiteralPath[0] -and [string]$LiteralPath[0].EndsWith('\lemon.exe', [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "simulated launcher lock"
        }
        if ($LiteralPath) {
            Microsoft.PowerShell.Management\Remove-Item -LiteralPath $LiteralPath -Force:$Force @Remaining
        } elseif ($Path) {
            Microsoft.PowerShell.Management\Remove-Item -Path $Path -Force:$Force @Remaining
        } else {
            Microsoft.PowerShell.Management\Remove-Item @Remaining
        }
    }
    try {
        Assert-ThrowsLike {
            Install-LemonCommandLaunchers -Root $installRoot -Destination $shadowBinDir -Repository 'DangLemon/lemon-agent' | Out-Null
        } '*stale launcher blocks PATH resolution*' 'stale lemon.exe removal failure fails closed'
    } finally {
        Microsoft.PowerShell.Management\Remove-Item -LiteralPath Function:\Remove-Item -Force -ErrorAction SilentlyContinue
    }

    $crossDrive = Get-LemonLauncherRelativePath `
        -LauncherDirectory 'C:\Users\Dang\AppData\Local\Lemon AI\bin' `
        -Source 'D:\Lemon AI\lemon-agent\venv\Scripts\lemon.exe'
    Assert-Equal '' $crossDrive 'different drive roots select the Unicode-safe PowerShell companion'

    $crossHost = Get-LemonLauncherRelativePath `
        -LauncherDirectory '\\server-a\share\Lemon AI\bin' `
        -Source '\\server-b\share\Lemon AI\lemon-agent\venv\Scripts\lemon.exe'
    Assert-Equal '' $crossHost 'different UNC hosts select the Unicode-safe PowerShell companion'

    $probeSource = Join-Path $scriptsDir 'lemon.exe'
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $probeSource -Force
    Add-Type -TypeDefinition @'
using System;
public static class LauncherProbe {
    public static int Main(string[] args) {
        Console.WriteLine(Environment.GetEnvironmentVariable("LEMON_UPDATE_REPOSITORY"));
        Console.WriteLine(string.Join("|", args));
        return 23;
    }
}
'@ -OutputAssembly $probeSource -OutputType ConsoleApplication
    Install-LemonCommandLaunchers -Root $installRoot -Destination $binDir -Repository 'DangLemon/lemon-agent' | Out-Null
    $probeOutput = @(& (Join-Path $binDir 'lemon.cmd') 'alpha' 'beta gamma')
    $probeExit = $LASTEXITCODE
    Assert-Equal 23 $probeExit 'generated launcher propagates child exit status'
    Assert-True ($probeOutput -contains 'DangLemon/lemon-agent') `
        'generated launcher exports the selected repository to the child'
    Assert-True ($probeOutput -contains 'alpha|beta gamma') `
        'generated launcher forwards arguments to the child'

    $unicodeInstallRoot = Join-Path $caseRoot 'Lémon Agent'
    $unicodeScripts = Join-Path $unicodeInstallRoot 'venv\Scripts'
    $unicodeBin = Join-Path $caseRoot 'unicode-bin'
    New-Item -ItemType Directory -Force -Path $unicodeScripts | Out-Null
    $unicodeProbe = Join-Path $unicodeScripts 'lemon.exe'
    Add-Type -TypeDefinition @'
using System;
public static class UnicodeLauncherProbe {
    public static int Main(string[] args) {
        Console.WriteLine(Environment.GetEnvironmentVariable("LEMON_UPDATE_REPOSITORY"));
        Console.WriteLine(string.Join("|", args));
        return 29;
    }
}
'@ -OutputAssembly $unicodeProbe -OutputType ConsoleApplication
    Install-LemonCommandLaunchers -Root $unicodeInstallRoot -Destination $unicodeBin -Repository 'DangLemon/lemon-agent' | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $unicodeBin 'lemon-launcher.ps1')) `
        'Unicode source paths use a PowerShell companion instead of batch bytes'
    $unicodeOutput = @(& (Join-Path $unicodeBin 'lemon.cmd') 'một' 'hai ba')
    Assert-Equal 29 $LASTEXITCODE 'Unicode companion propagates child exit status'
    Assert-True ($unicodeOutput -contains 'DangLemon/lemon-agent') `
        'Unicode companion preserves the update repository'
    Assert-True ($unicodeOutput -contains 'một|hai ba') `
        'Unicode companion forwards non-ASCII arguments'
} finally {
    if (Test-Path -LiteralPath $caseRoot) {
        $resolvedCase = [System.IO.Path]::GetFullPath($caseRoot)
        if (-not $resolvedCase.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove test directory outside the system temp directory: $resolvedCase"
        }
        Microsoft.PowerShell.Management\Remove-Item -LiteralPath $resolvedCase -Recurse -Force
    }
}

if ($script:Failures -gt 0) {
    Write-Host ""
    Write-Host "$script:Failures assertion(s) failed"
    exit 1
}

Write-Host ""
Write-Host "all assertions passed"
