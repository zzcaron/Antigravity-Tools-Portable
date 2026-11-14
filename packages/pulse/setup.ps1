<#
Antigravity Pulse - one-click setup for Windows.
(Kept ASCII-only on purpose so Windows PowerShell 5.1 reads it correctly without a BOM.)

What it does:
  1. Checks Node.js (18 or newer). If missing, asks, then installs Node.js LTS with winget.
  2. Downloads install-context-capsule.js and context-capsule-payload.js from the latest
     GitHub Release into %USERPROFILE%\.gemini\tools\ (older copies are kept as .bak).
  3. Runs the installer with Node.js. Antigravity restarts by itself after patching
     (pass -Confirm to ask before closing), so save your work first.

Usage (PowerShell):
  .\setup.ps1                     install or update
  .\setup.ps1 -Confirm            ask for confirmation before restarting Antigravity
  .\setup.ps1 -Action check       show whether the hook is installed (< 5ms)
  .\setup.ps1 -Action uninstall   remove the hook, restore backup if present, and clean local Pulse files
  .\setup.ps1 -Action web         only export the browser extension and userscript
  .\setup.ps1 -Offline            use the .js files next to this script instead of downloading
  .\setup.ps1 -Asar <path>        pass a custom Antigravity install path or app.asar
#>
param(
    [ValidateSet('install', 'check', 'uninstall', 'web')]
    [string]$Action = 'install',
    [switch]$Offline,
    [string]$Asar = '',
    [switch]$Confirm,
    [switch]$Clean,
    [switch]$KeepFiles
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Base = 'https://github.com/akelabs/antigravity-pulse/releases/latest/download'
$Files = @('install-context-capsule.js', 'context-capsule-payload.js')
$Dir = Join-Path $HOME '.gemini\tools'
$MinNode = 18

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Get-NodeMajor {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { return 0 }
    $v = (& node --version) -replace '^v', ''
    return [int]($v.Split('.')[0])
}

function Install-ToolFile([string]$Name) {
    $dest = Join-Path $Dir $Name
    $tmp = "$dest.download"
    if ($Offline) {
        $src = Join-Path $PSScriptRoot $Name
        if (-not (Test-Path $src)) { throw "Missing file next to setup.ps1: $src" }
        Copy-Item $src $tmp -Force
    } else {
        Invoke-WebRequest "$Base/$Name" -OutFile $tmp -UseBasicParsing
    }
    if ((Get-Item $tmp).Length -lt 1024) { Remove-Item $tmp -Force; throw "Download looks broken: $Name" }
    if (Test-Path $dest) { Copy-Item $dest "$dest.bak" -Force }
    Move-Item $tmp $dest -Force
    Say "[OK] $dest" 'Green'
}

# 1. Node.js
$major = Get-NodeMajor
if ($major -lt $MinNode) {
    if ($major -gt 0) { Say "Node.js v$major is too old (need $MinNode or newer)." 'Yellow' }
    else { Say 'Node.js was not found.' 'Yellow' }
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Say 'Install Node.js LTS from https://nodejs.org/ and run this script again.' 'Yellow'
        exit 1
    }
    $ans = Read-Host 'Install Node.js LTS with winget now? [Y/n]'
    if ($ans -and $ans -notmatch '^[Yy]') { Say 'Cancelled.'; exit 1 }
    winget install --id OpenJS.NodeJS.LTS -e --source winget
    Refresh-Path
    $major = Get-NodeMajor
    if ($major -lt $MinNode) {
        Say 'Node.js is installed but this window cannot see it yet. Open a new PowerShell window and run this script again.' 'Yellow'
        exit 1
    }
}
Say "[OK] Node.js v$major" 'Green'

# 2. Files (check/uninstall reuse local installer when available; otherwise fetch only installer)
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$installer = Join-Path $Dir 'install-context-capsule.js'
if ($Action -eq 'check' -or $Action -eq 'uninstall') {
    $localBeside = Join-Path $PSScriptRoot 'install-context-capsule.js'
    if (($Offline -and (Test-Path $localBeside)) -or (-not (Test-Path $installer))) {
        Install-ToolFile 'install-context-capsule.js'
    }
} else {
    foreach ($f in $Files) {
        Install-ToolFile $f
    }
}

# 3. Run the installer
if (-not (Test-Path $installer)) { throw "Installer not found: $installer" }
$flags = @(@{ install = @(); check = @('--check'); uninstall = @('--uninstall'); web = @('--web-only') }[$Action])
if ($Action -eq 'uninstall' -and -not $KeepFiles) {
    $flags += '--clean'
} elseif ($Clean) {
    $flags += '--clean'
}
if ($Confirm) {
    $flags += '--confirm'
}
if (-not [string]::IsNullOrWhiteSpace($Asar)) {
    $flags += @('--asar', $Asar)
}
& node $installer @flags
exit $LASTEXITCODE
