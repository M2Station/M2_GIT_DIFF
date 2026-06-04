# M2_GIT_DIFF
# Copyright (c) 2026 OA Hsiao
# SPDX-License-Identifier: MIT
#
# This source code is licensed under the MIT License found in the
# LICENSE file in the root directory of this source tree.
# 判斷 dist/ 是否為最新。
# exit 0 = dist 已是最新（可略過建置）；exit 1 = 需要重建。
$ErrorActionPreference = 'SilentlyContinue'
Set-Location -Path $PSScriptRoot

$dist = Join-Path $PSScriptRoot 'dist/index.html'
if (-not (Test-Path $dist)) { exit 1 }

$distTime = (Get-Item $dist).LastWriteTimeUtc

$sources = @('src', 'index.html', 'vite.config.js', 'package.json')
$newest = Get-ChildItem -Recurse -File -Path $sources -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

if ($newest -and $newest.LastWriteTimeUtc -le $distTime) { exit 0 } else { exit 1 }
