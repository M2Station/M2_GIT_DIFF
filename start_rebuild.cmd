@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   M2_GIT_DIFF - Launcher (FORCE REBUILD)
echo ========================================
echo.
echo [資訊] 此啟動器每次都會強制重建 dist/ (跳過時間戳檢查)。
echo.

REM --- 檢查 Node.js 是否安裝 ---
where node >nul 2>nul
if errorlevel 1 (
    echo [錯誤] 找不到 Node.js，請先安裝: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM --- 檢查 npm 是否安裝 ---
where npm >nul 2>nul
if errorlevel 1 (
    echo [錯誤] 找不到 npm，請確認 Node.js 安裝是否完整。
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo [資訊] Node.js 版本: %%v
for /f "delims=" %%v in ('npm -v') do echo [資訊] npm 版本: %%v
echo.

REM --- 檢查是否需要安裝相依套件 ---
if not exist "node_modules" (
    echo [安裝] 未偵測到 node_modules，開始安裝必要的 NPM 套件...
    call npm install
    if errorlevel 1 (
        echo.
        echo [錯誤] npm install 失敗。
        pause
        exit /b 1
    )
    echo [完成] 套件安裝完成。
    echo.
) else (
    echo [資訊] node_modules 已存在，略過安裝。
    echo.
)

REM --- 檢查 / 修復 Electron 二進位檔 (網路磁碟常會掉檔) ---
if not exist "node_modules\electron\dist\electron.exe" (
    echo [修復] Electron 二進位檔遺失，執行修復程序...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0repair-electron.ps1"
    if errorlevel 1 (
        echo.
        echo [錯誤] Electron 修復失敗。
        pause
        exit /b 1
    )
    echo.
)

REM --- 檢查 / 修復 better-sqlite3 原生模組 (Electron 版本變動會導致 ABI 不符) ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-sqlite.ps1"
if errorlevel 1 (
    echo [修復] better-sqlite3 與目前 Electron 版本不符，執行重新編譯 ^(npm run rebuild^)...
    call npm run rebuild
    if errorlevel 1 (
        echo.
        echo [警告] better-sqlite3 重新編譯失敗，將退回記憶體快取 ^(功能正常，僅快取不持久^)。
    ) else (
        powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-sqlite.ps1" -Mark
        echo [完成] better-sqlite3 重新編譯完成。
    )
    echo.
)

REM --- 強制建置前端 (production)，每次都重建，不做時間戳比較 ---
echo [建置] 強制重新建置 (npm run build)...
call npm run build
if errorlevel 1 (
    echo.
    echo [錯誤] 建置失敗。
    pause
    exit /b 1
)
echo [完成] 建置完成。
echo.

REM --- 觸發程式執行 (production，載入 dist/index.html，無 Vite dev server) ---
echo [啟動] 開始執行程式 (FORCE REBUILD MODE)...
echo.
call npm run start:prod

endlocal
