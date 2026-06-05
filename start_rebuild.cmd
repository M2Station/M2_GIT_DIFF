@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM Thin ASCII wrapper. All launch logic lives in start_rebuild.ps1 because cmd.exe
REM cannot reliably parse a long batch file containing multi-byte characters.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_rebuild.ps1" %*
exit /b %ERRORLEVEL%