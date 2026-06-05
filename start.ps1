# M2_GIT_DIFF
# Copyright (c) 2026 OA Hsiao
# SPDX-License-Identifier: MIT
#
# This source code is licensed under the MIT License found in the
# LICENSE file in the root directory of this source tree.
#
# Launcher (NORMAL / production mode). All launch logic lives here in
# PowerShell because cmd.exe cannot reliably parse a long batch file that
# contains multi-byte (e.g. 中文) characters — its UTF-8 buffer handling
# splits lines mid-token. start.cmd is a thin ASCII wrapper around this file.
param(
    [string]$L,
    [string]$R
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -Path $PSScriptRoot

function Write-Step { param([string]$Msg) Write-Host $Msg }

Write-Host '========================================'
Write-Host '  M2_GIT_DIFF - Launcher (NORMAL MODE)'
Write-Host '========================================'
Write-Host ''

# --- 解析命令列參數 -L / -R (自動開啟 repro) ---
if ($L) { $env:REPRO_L = $L; Write-Host "[資訊] 左側 repro: $L" }
if ($R) { $env:REPRO_R = $R; Write-Host "[資訊] 右側 repro: $R" }
if ($L -or $R) { Write-Host '' }

# --- 檢查 Node.js 是否安裝 ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '[錯誤] 找不到 Node.js，請先安裝: https://nodejs.org/'
    Write-Host ''
    Read-Host '按 Enter 結束'
    exit 1
}

# --- 檢查 npm 是否安裝 ---
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host '[錯誤] 找不到 npm，請確認 Node.js 安裝是否完整。'
    Write-Host ''
    Read-Host '按 Enter 結束'
    exit 1
}

Write-Host "[資訊] Node.js 版本: $(node -v)"
Write-Host "[資訊] npm 版本: $(npm -v)"
Write-Host ''

# --- 檢查是否需要安裝相依套件 ---
if (-not (Test-Path 'node_modules')) {
    Write-Host '[安裝] 未偵測到 node_modules，開始安裝必要的 NPM 套件...'
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '[錯誤] npm install 失敗。'
        Read-Host '按 Enter 結束'
        exit 1
    }
    Write-Host '[完成] 套件安裝完成。'
    Write-Host ''
} else {
    Write-Host '[資訊] node_modules 已存在，略過安裝。'
    Write-Host ''
}

# --- 檢查 / 修復 Electron 二進位檔 (網路磁碟常會掉檔) ---
if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) {
    Write-Host '[修復] Electron 二進位檔遺失，執行修復程序...'
    & "$PSScriptRoot\repair-electron.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '[錯誤] Electron 修復失敗。'
        Read-Host '按 Enter 結束'
        exit 1
    }
    Write-Host ''
}

# --- 檢查 / 修復 better-sqlite3 原生模組 (Electron 版本變動會導致 ABI 不符) ---
& "$PSScriptRoot\check-sqlite.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host '[修復] better-sqlite3 與目前 Electron 版本不符，執行重新編譯 (npm run rebuild)...'
    npm run rebuild
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '[警告] better-sqlite3 重新編譯失敗，將退回記憶體快取 (功能正常，僅快取不持久)。'
    } else {
        & "$PSScriptRoot\check-sqlite.ps1" -Mark
        Write-Host '[完成] better-sqlite3 重新編譯完成。'
    }
    Write-Host ''
}

# --- 建置前端 (production，僅在原始碼有變更時才重建 dist/) ---
# 比較 dist\index.html 與所有來源檔的最後修改時間；來源較新或 dist 不存在才重建。
$needBuild = $true
if (Test-Path 'dist\index.html') {
    & "$PSScriptRoot\check-build.ps1"
    if ($LASTEXITCODE -eq 0) { $needBuild = $false }
}

if ($needBuild) {
    Write-Host '[建置] 偵測到原始碼變更，執行 production 建置 (npm run build)...'
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '[錯誤] 建置失敗。'
        Read-Host '按 Enter 結束'
        exit 1
    }
    Write-Host '[完成] 建置完成。'
} else {
    Write-Host '[資訊] dist/ 已是最新，略過建置 (快速啟動)。'
}
Write-Host ''

# --- 觸發程式執行 (production，載入 dist/index.html，無 Vite dev server) ---
Write-Host '[啟動] 開始執行程式 (NORMAL MODE)...'
Write-Host ''
npm run start:prod
exit $LASTEXITCODE
