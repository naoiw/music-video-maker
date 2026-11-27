$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$nodeMajor = (Get-Content .node-version -Raw).Trim()
$toolchain = 'stable-x86_64-pc-windows-msvc'

function Refresh-Path {
    $env:Path = @(
        [Environment]::GetEnvironmentVariable('Path', 'Machine')
        [Environment]::GetEnvironmentVariable('Path', 'User')
        $env:Path
        (Join-Path $env:USERPROFILE '.cargo\bin')
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links')
    ) -join ';'
}

function Has-Command([string]$Name) {
    return [bool](Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue)
}

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed (exit $LASTEXITCODE)."
    }
}

function Install-Package([string]$Id, [string[]]$Extra = @()) {
    if (-not (Has-Command 'winget.exe')) {
        throw 'WinGet is missing. Install or update App Installer from Microsoft Store, then rerun setup.'
    }
    Write-Host "Installing $Id ..."
    Invoke-Checked 'winget.exe' (@('install', '--id', $Id, '--exact', '--source', 'winget', '--architecture', 'x64') + $Extra)
    Refresh-Path
}

function Has-CppTools {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { return $false }
    $found = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($LASTEXITCODE -ne 0 -or -not $found) { return $false }
    $kits = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows Kits\Installed Roots' -Name KitsRoot10 -ErrorAction SilentlyContinue).KitsRoot10
    if (-not $kits) { return $false }
    $sdk = Get-ChildItem -LiteralPath (Join-Path $kits 'Include') -Directory -ErrorAction SilentlyContinue |
        Where-Object { (Test-Path (Join-Path $_.FullName 'um\Windows.h')) -and (Test-Path (Join-Path $kits ('Lib\' + $_.Name + '\um\x64\kernel32.lib'))) } |
        Select-Object -First 1
    return [bool]$sdk
}

function Has-WebView2 {
    $id = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($path in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$id", "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$id")) {
        $version = (Get-ItemProperty -LiteralPath $path -Name pv -ErrorAction SilentlyContinue).pv
        if ($version -and $version -ne '0.0.0.0') { return $true }
    }
    return $false
}

try {
    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
        throw 'Run this script on Windows x64 using 64-bit PowerShell.'
    }
    Refresh-Path
    Write-Host 'Music Video Maker - environment setup'
    Write-Host 'Missing dependencies are installed from WinGet. Installer/UAC prompts may appear.'
    if (-not (Has-Command 'node.exe')) {
        # Known Node 26 release; do not install a different major by accident.
        Install-Package 'OpenJS.NodeJS' @('--version', '26.7.0')
    }
    if (-not (Has-Command 'node.exe') -or -not (Has-Command 'npm.cmd')) {
        throw 'Node.js/npm not found on PATH. Sign out or restart Windows and rerun setup.'
    }
    $actual = & node.exe -p 'process.versions.node.split(".")[0]'
    if ($LASTEXITCODE -ne 0 -or $actual -ne $nodeMajor) {
        throw "Node.js $nodeMajor is required. Existing Node.js is not automatically replaced. Select the required version and rerun."
    }
    if (-not (Has-CppTools)) {
        Install-Package 'Microsoft.VisualStudio.2022.BuildTools' @('--override', '--passive --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
        if (-not (Has-CppTools)) {
            throw 'C++ tools/Windows SDK not detected. In Visual Studio Installer, add Desktop development with C++, restart if required, then rerun.'
        }
    }
    if (-not (Has-Command 'rustup.exe')) { Install-Package 'Rustlang.Rustup' }
    if (-not (Has-Command 'rustup.exe')) { throw 'rustup not found. Restart Windows and rerun setup.' }
    & rustup.exe run $toolchain rustc -V
    if ($LASTEXITCODE -ne 0) {
        Invoke-Checked 'rustup.exe' @('toolchain', 'install', $toolchain)
    }
    Invoke-Checked 'rustup.exe' @('run', $toolchain, 'cargo', '-V')
    if (-not (Has-Command 'ffmpeg.exe') -or -not (Has-Command 'ffprobe.exe')) {
        Install-Package 'Gyan.FFmpeg'
    }
    if (-not (Has-Command 'ffmpeg.exe') -or -not (Has-Command 'ffprobe.exe')) {
        throw 'FFmpeg/FFprobe not found on PATH. Restart Windows and rerun setup, or add their bin folder to PATH.'
    }
    Invoke-Checked 'ffmpeg.exe' @('-version')
    Invoke-Checked 'ffprobe.exe' @('-version')
    if (-not (Has-WebView2)) {
        Install-Package 'Microsoft.EdgeWebView2Runtime'
        if (-not (Has-WebView2)) { throw 'WebView2 Runtime not detected. Install Evergreen Runtime manually and rerun.' }
    }
    Write-Host 'Setup complete. Restart Windows if requested, then run build.bat.'
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
