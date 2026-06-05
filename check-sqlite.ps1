# M2_GIT_DIFF
# Copyright (c) 2026 OA Hsiao
# SPDX-License-Identifier: MIT
#
# This source code is licensed under the MIT License found in the
# LICENSE file in the root directory of this source tree.
# 檢查 better-sqlite3 原生模組是否需要對目前 Electron 版本重新編譯。
#   無參數      : 檢查模式。exit 1 = 需要 rebuild；exit 0 = 不需要 (或無此選用模組)。
#   -Mark       : 標記模式。將目前 Electron 版本寫入標記檔 (rebuild 成功後呼叫)。
param(
    [switch]$Mark
)
$ErrorActionPreference = 'SilentlyContinue'

$bsRoot = Join-Path $PSScriptRoot 'node_modules\better-sqlite3'
$node   = Join-Path $bsRoot 'build\Release\better_sqlite3.node'
$marker = Join-Path $bsRoot '.electron-abi'
$elPkg  = Join-Path $PSScriptRoot 'node_modules\electron\package.json'

# better-sqlite3 是選用相依，未安裝就無事可做。
if (-not (Test-Path $bsRoot)) { exit 0 }

# 取得目前 Electron 版本。
$elVersion = $null
if (Test-Path $elPkg) {
    $elVersion = (Get-Content $elPkg -Raw | ConvertFrom-Json).version
}

if ($Mark) {
    if ($elVersion) { Set-Content -Path $marker -Value $elVersion -NoNewline }
    exit 0
}

# 檢查模式：模組檔不存在 => 需要 rebuild。
if (-not (Test-Path $node)) { exit 1 }

# 無法判斷 Electron 版本 (例如二進位檔遺失) => 不強制 rebuild，交給其他流程處理。
if (-not $elVersion) { exit 0 }

# 標記檔不存在或版本不符 => 需要 rebuild。
$built = if (Test-Path $marker) { (Get-Content $marker -Raw).Trim() } else { '' }
if ($built -ne $elVersion) { exit 1 }

exit 0
