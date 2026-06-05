# M2_GIT_DIFF
# Copyright (c) 2026 OA Hsiao
# SPDX-License-Identifier: MIT
#
# This source code is licensed under the MIT License found in the
# LICENSE file in the root directory of this source tree.
# Installs the M2 GIT DIFF Explorer right-click menu (per-user, no admin needed).
#
# Adds two verbs to the folder context menu, mirroring Beyond Compare:
#   • "Select Folder for M2 GIT DIFF"  — remembers the folder as the left side
#   • "Compare in M2 GIT DIFF"         — opens M2 GIT DIFF with the remembered
#                                        folder as -L and the clicked one as -R
#
# Registered under HKCU so it needs no administrator rights. Entries are added to
# both `Directory` (right-clicking a folder) and `Directory\Background` (right-
# clicking inside a folder's empty area).
#
# Run:    powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-context-menu.ps1
# Remove: powershell -NoProfile -ExecutionPolicy Bypass -File tools\uninstall-context-menu.ps1

$ErrorActionPreference = 'Stop'

$launcher = Join-Path $PSScriptRoot 'm2gitdiff-launcher.ps1'
if (-not (Test-Path -LiteralPath $launcher)) {
    Write-Error "找不到 launcher：$launcher"
    exit 1
}

# Use the project icon (public/icon.ico) for the menu entries; fall back to the
# PowerShell exe icon if the .ico is missing.
$psExe = (Get-Command powershell.exe).Source
$iconFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'public\icon.ico'
$menuIcon = if (Test-Path -LiteralPath $iconFile) { $iconFile } else { "$psExe,0" }

# Registry roots that hold the folder context-menu verbs.
$shellRoots = @(
    'HKCU:\Software\Classes\Directory\shell',
    'HKCU:\Software\Classes\Directory\Background\shell'
)
# Matches any M2 GIT DIFF verb by its menu label (e.g. "Compare in M2 GIT DIFF")
# or by a command that references our launcher, tolerating spaces/underscores.
$verbPattern = 'M2[ _]?GIT[ _]?DIFF'

# Find every previously registered M2 GIT DIFF verb. Returns the matching
# registry key objects so a re-install can remove stale/duplicate entries left
# by an older version, a renamed key, or a command still pointing at a moved
# launcher path — not just the four keys this script currently writes.
function Get-M2Verbs {
    $found = @()
    foreach ($root in $shellRoots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($item in (Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
            $label = (Get-ItemProperty -LiteralPath $item.PSPath -Name '(default)' -ErrorAction SilentlyContinue).'(default)'
            $cmd = (Get-ItemProperty -LiteralPath (Join-Path $item.PSPath 'command') -Name '(default)' -ErrorAction SilentlyContinue).'(default)'
            if (($label -match $verbPattern) -or ($cmd -match $verbPattern) -or ($cmd -match 'm2gitdiff-launcher')) {
                $found += $item
            }
        }
    }
    return $found
}

# Remove all M2 GIT DIFF verbs found above. Returns the number removed.
function Remove-M2Verbs {
    $targets = @(Get-M2Verbs)
    foreach ($item in $targets) {
        Remove-Item -LiteralPath $item.PSPath -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "[移除] $($item.Name)"
    }
    return $targets.Count
}

function New-Verb {
    param(
        [string]$ShellRoot,   # registry path to ...\shell
        [string]$Key,         # verb key name
        [string]$Label,       # menu text
        [string]$Action,      # select | compare
        [string]$PathToken    # %V (Directory) or %V (Background) -> folder path
    )
    $verbKey = Join-Path $ShellRoot $Key
    New-Item -Path $verbKey -Force | Out-Null
    Set-ItemProperty -Path $verbKey -Name '(default)' -Value $Label
    Set-ItemProperty -Path $verbKey -Name 'Icon' -Value $menuIcon
    # Make Explorer invoke the verb once per selected folder so a multi-selection
    # (two folders -> Compare) reaches the launcher, which collects both paths.
    Set-ItemProperty -Path $verbKey -Name 'MultiSelectModel' -Value 'Document'

    $cmdKey = Join-Path $verbKey 'command'
    New-Item -Path $cmdKey -Force | Out-Null
    $q = [char]34   # double-quote, avoids backtick-escaping issues in PS 5.1
    $cmd = $q + $psExe + $q +
        ' -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ' +
        $q + $launcher + $q + ' ' + $Action + ' ' + $q + $PathToken + $q
    Set-ItemProperty -Path $cmdKey -Name '(default)' -Value $cmd
}

# Clean re-install: remove any previously registered M2 GIT DIFF verbs first so
# stale or duplicate entries (old version, renamed key, moved launcher path)
# can't linger, then verify the registry is actually clear before re-adding.
$before = @(Get-M2Verbs).Count
if ($before -gt 0) {
    Write-Host "[清除] 偵測到 $before 個舊的 M2 GIT DIFF 右鍵項目，移除中..."
    [void](Remove-M2Verbs)
} else {
    Write-Host '[清除] 未偵測到舊的 M2 GIT DIFF 右鍵項目。'
}
$leftover = @(Get-M2Verbs)
if ($leftover.Count -gt 0) {
    Write-Warning "仍有 $($leftover.Count) 個舊項目未能移除："
    $leftover | ForEach-Object { Write-Warning "  - $($_.Name)" }
    Write-Error '無法確認舊的右鍵選單已完全移除，中止安裝。請手動檢查上列註冊鍵。'
    exit 1
}
Write-Host '[確認] 舊的右鍵選單已完全移除。' -ForegroundColor Green
Write-Host ''

# Folder (right-click on a folder) — clicked path is %V
$dirShell = 'HKCU:\Software\Classes\Directory\shell'
New-Verb -ShellRoot $dirShell -Key 'M2GitDiffSelect'  -Label 'Select Folder for M2 GIT DIFF' -Action 'select'  -PathToken '%V'
New-Verb -ShellRoot $dirShell -Key 'M2GitDiffCompare' -Label 'Compare in M2 GIT DIFF'        -Action 'compare' -PathToken '%V'

# Folder background (right-click inside a folder) — current path is %V
$bgShell = 'HKCU:\Software\Classes\Directory\Background\shell'
New-Verb -ShellRoot $bgShell -Key 'M2GitDiffSelect'  -Label 'Select Folder for M2 GIT DIFF' -Action 'select'  -PathToken '%V'
New-Verb -ShellRoot $bgShell -Key 'M2GitDiffCompare' -Label 'Compare in M2 GIT DIFF'        -Action 'compare' -PathToken '%V'

Write-Host '[done] Installed context-menu verbs:' -ForegroundColor Green
Write-Host '       - Select Folder for M2 GIT DIFF'
Write-Host '       - Compare in M2 GIT DIFF'
Write-Host ''

# Verify the four expected verbs are now present and their command points at the
# current launcher, so a successful exit truly means the menu is registered.
$expected = @(
    "$dirShell\M2GitDiffSelect",
    "$dirShell\M2GitDiffCompare",
    "$bgShell\M2GitDiffSelect",
    "$bgShell\M2GitDiffCompare"
)
$missing = @($expected | Where-Object { -not (Test-Path -LiteralPath "$_\command") })
if ($missing.Count -gt 0) {
    Write-Warning '以下預期的右鍵項目未成功建立：'
    $missing | ForEach-Object { Write-Warning "  - $_" }
    Write-Error '安裝未完整完成。'
    exit 1
}
Write-Host '[確認] 新的右鍵選單已成功註冊。' -ForegroundColor Green
Write-Host ''
Write-Host 'Usage: right-click the source folder -> Select Folder for M2 GIT DIFF,'
Write-Host '       then right-click the target folder -> Compare in M2 GIT DIFF.'
Write-Host ''
Write-Host 'Remove: powershell -NoProfile -ExecutionPolicy Bypass -File tools\uninstall-context-menu.ps1'
