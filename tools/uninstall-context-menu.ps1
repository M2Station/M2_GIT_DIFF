# M2_GIT_DIFF
# Copyright (c) 2026 OA Hsiao
# SPDX-License-Identifier: MIT
#
# This source code is licensed under the MIT License found in the
# LICENSE file in the root directory of this source tree.
# Removes the M2 GIT DIFF Explorer right-click menu installed by
# install-context-menu.ps1. Per-user (HKCU), no admin needed.
#
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File tools\uninstall-context-menu.ps1

$ErrorActionPreference = 'SilentlyContinue'

$keys = @(
    'HKCU:\Software\Classes\Directory\shell\M2GitDiffSelect',
    'HKCU:\Software\Classes\Directory\shell\M2GitDiffCompare',
    'HKCU:\Software\Classes\Directory\Background\shell\M2GitDiffSelect',
    'HKCU:\Software\Classes\Directory\Background\shell\M2GitDiffCompare'
)

foreach ($k in $keys) {
    if (Test-Path -LiteralPath $k) {
        Remove-Item -LiteralPath $k -Recurse -Force
        Write-Host "[移除] $k"
    }
}

# Also clear the remembered left-folder state.
$leftFile = Join-Path $env:LOCALAPPDATA 'M2_GIT_DIFF\left-folder.txt'
if (Test-Path -LiteralPath $leftFile) {
    Remove-Item -LiteralPath $leftFile -Force
}

Write-Host '[完成] 已移除 M2 GIT DIFF 右鍵選單。' -ForegroundColor Green
