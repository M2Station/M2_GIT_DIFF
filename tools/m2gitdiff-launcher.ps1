# M2_GIT_DIFF
# Copyright (c) 2026 OA Hsiao
# SPDX-License-Identifier: MIT
#
# This source code is licensed under the MIT License found in the
# LICENSE file in the root directory of this source tree.
# M2 GIT DIFF — Explorer context-menu launcher
#
# Implements the Beyond Compare style two-step folder compare:
#   1) "Select Folder for M2 GIT DIFF"  -> remembers the folder (left side)
#   2) "Compare in M2 GIT DIFF"         -> launches the app with the remembered
#                                          folder as -L and the clicked one as -R
#
# The remembered path is stored in a small state file under %LOCALAPPDATA% so it
# survives between the two right-clicks. Invoked by the registry verbs created by
# install-context-menu.ps1.
#
# Usage (normally called from the registry, not by hand):
#   powershell -NoProfile -ExecutionPolicy Bypass -File m2gitdiff-launcher.ps1 select  "C:\path\to\folder"
#   powershell -NoProfile -ExecutionPolicy Bypass -File m2gitdiff-launcher.ps1 compare "C:\path\to\folder"

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('select', 'compare')]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$Path,

    # Path to the installed M2_GIT_DIFF.exe. Supplied by the NSIS installer's
    # registry entries so packaged installs launch the built app directly. When
    # empty (dev/source mode) we fall back to start.cmd + `npm run dev`.
    [Parameter(Mandatory = $false)]
    [string]$Exe
)

$ErrorActionPreference = 'Stop'

# Repo root = parent of this tools\ folder; start.cmd lives there.
$repoRoot = Split-Path -Parent $PSScriptRoot
$startCmd = Join-Path $repoRoot 'start.cmd'

# Per-user state dir for the remembered "left" folder.
$stateDir = Join-Path $env:LOCALAPPDATA 'M2_GIT_DIFF'
$leftFile = Join-Path $stateDir 'left-folder.txt'

function Show-Info($text, $title = 'M2 GIT DIFF') {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    [System.Windows.Forms.MessageBox]::Show($text, $title) | Out-Null
}

function Start-Compare($left, $right) {
    # Installed mode: launch the packaged exe directly with -L/-R.
    if ($Exe -and (Test-Path -LiteralPath $Exe)) {
        Start-Process -FilePath $Exe -ArgumentList @('-L', $left, '-R', $right)
        return
    }
    # Dev/source mode: start.cmd opens its own console and runs `npm run dev`.
    if (-not (Test-Path -LiteralPath $startCmd)) {
        Show-Info "找不到 start.cmd：`n$startCmd`n`n請確認 tools 資料夾仍在專案內。"
        exit 1
    }
    # Launch the app in dev mode with both repos pre-loaded.
    Start-Process -FilePath $startCmd -ArgumentList @('-L', $left, '-R', $right) -WorkingDirectory $repoRoot
}

# Normalize: if a file was clicked, fall back to its containing directory.
if (Test-Path -LiteralPath $Path -PathType Leaf) {
    $Path = Split-Path -Parent $Path
}
$Path = (Resolve-Path -LiteralPath $Path).Path

if ($Action -eq 'select') {
    if (-not (Test-Path -LiteralPath $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }
    Set-Content -LiteralPath $leftFile -Value $Path -Encoding UTF8
    exit 0
}

# --- compare ---
# Two ways to reach here:
#   (A) Classic two-step: a left folder was remembered via "select" earlier.
#   (B) Multi-select: the user selected 2+ folders and clicked "compare". Windows
#       Explorer invokes this script once per selected folder in quick succession,
#       so we collect the paths in a shared pending file and let the first
#       ("leader") invocation launch the app once both sides are gathered.

$pendingFile = Join-Path $stateDir 'compare-pending.txt'
$lockFile    = Join-Path $stateDir 'compare-leader.lock'

# Expire a stale remembered "left" folder. Without this, a single-folder compare
# would silently pair with a folder selected long ago (or left over from an
# abandoned "select"), which looks like a malfunction. TTL is configurable via
# M2GITDIFF_SELECT_TTL_MIN (minutes, default 5).
if (Test-Path -LiteralPath $leftFile) {
    $ttlMin = 5
    if ($env:M2GITDIFF_SELECT_TTL_MIN -and ($env:M2GITDIFF_SELECT_TTL_MIN -as [int])) {
        $ttlMin = [int]$env:M2GITDIFF_SELECT_TTL_MIN
    }
    $selectAge = (Get-Date) - (Get-Item -LiteralPath $leftFile).LastWriteTime
    if ($selectAge.TotalMinutes -ge $ttlMin) {
        Remove-Item -LiteralPath $leftFile -ErrorAction SilentlyContinue
    }
}

# (A) Classic two-step takes priority when a left folder was remembered.
if (Test-Path -LiteralPath $leftFile) {
    $left = (Get-Content -LiteralPath $leftFile -Raw).Trim()
    $right = $Path

    if ([string]::IsNullOrWhiteSpace($left) -or -not (Test-Path -LiteralPath $left)) {
        Show-Info "記住的左側資料夾已失效，請重新選擇。"
        Remove-Item -LiteralPath $leftFile -ErrorAction SilentlyContinue
        exit 1
    }

    Start-Compare $left $right

    # Clear the remembered left so the next compare starts fresh.
    Remove-Item -LiteralPath $leftFile -ErrorAction SilentlyContinue
    exit 0
}

# (B) Multi-select: collect the paths from each per-folder invocation.
if (-not (Test-Path -LiteralPath $stateDir)) {
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}

# Collection window: Explorer invokes this script once per selected folder. The
# first invocation waits briefly for siblings, then launches. Keep the default
# short so a normal single-folder compare does not feel like a hang; widen via
# M2GITDIFF_COLLECT_MS if multi-select on a slow/network folder needs more time.
# Configurable via M2GITDIFF_COLLECT_MS (milliseconds, default 350).
$collectMs = 350
if ($env:M2GITDIFF_COLLECT_MS -and ($env:M2GITDIFF_COLLECT_MS -as [int])) {
    $collectMs = [int]$env:M2GITDIFF_COLLECT_MS
}
# A leader's lock counts as stale only once it is older than the collection
# window plus a safety margin, so an overlapping fresh selection is not reset
# mid-collect even when the window is widened.
$staleLockSec = [Math]::Max(5, [int]($collectMs / 1000) + 3)

$mutex = New-Object System.Threading.Mutex($false, 'M2GitDiffCompareCollect')
[void]$mutex.WaitOne()
$isLeader = $false
try {
    # Reset a stale collection left over by a previous (crashed) run.
    if (Test-Path -LiteralPath $lockFile) {
        $age = (Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime
        if ($age.TotalSeconds -ge $staleLockSec) {
            Remove-Item -LiteralPath $lockFile, $pendingFile -ErrorAction SilentlyContinue
        }
    }

    Add-Content -LiteralPath $pendingFile -Value $Path -Encoding UTF8

    if (-not (Test-Path -LiteralPath $lockFile)) {
        Set-Content -LiteralPath $lockFile -Value $PID -Encoding ASCII
        $isLeader = $true
    }
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}

# Non-leader invocations have done their job (appended their path) and exit.
if (-not $isLeader) {
    exit 0
}

# Leader: wait for sibling invocations to append their paths, then read.
Start-Sleep -Milliseconds $collectMs

$mutex = New-Object System.Threading.Mutex($false, 'M2GitDiffCompareCollect')
[void]$mutex.WaitOne()
try {
    $paths = @(Get-Content -LiteralPath $pendingFile -ErrorAction SilentlyContinue |
               ForEach-Object { $_.Trim() } |
               Where-Object { $_ } |
               Select-Object -Unique)
    Remove-Item -LiteralPath $pendingFile, $lockFile -ErrorAction SilentlyContinue
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}

if ($paths.Count -eq 0) {
    Show-Info "請一次選取兩個資料夾再選擇『Compare in M2 GIT DIFF』；`n或先在來源資料夾按右鍵選擇『Select Folder for M2 GIT DIFF』，再到目標資料夾選擇『Compare in M2 GIT DIFF』。"
    exit 1
}

# Single folder selected: load the same directory into both the left and right
# sides so the user can immediately compare branches/commits within one repo.
if ($paths.Count -eq 1) {
    Start-Compare $paths[0] $paths[0]
    exit 0
}

Start-Compare $paths[0] $paths[1]
exit 0
