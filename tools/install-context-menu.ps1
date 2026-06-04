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
Write-Host 'Usage: right-click the source folder -> Select Folder for M2 GIT DIFF,'
Write-Host '       then right-click the target folder -> Compare in M2 GIT DIFF.'
Write-Host ''
Write-Host 'Remove: powershell -NoProfile -ExecutionPolicy Bypass -File tools\uninstall-context-menu.ps1'
