@echo off
chcp 65001 >nul
title 查看 Antigravity 上下文解锁状态
echo ======================================================
echo       查看 Antigravity 上下文限制与解锁状态
echo ======================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%bin\node\node.exe"

if not exist "%NODE_EXE%" (
    set "NODE_EXE=node"
)

"%NODE_EXE%" "%SCRIPT_DIR%packages\viewer\cli.js" unlock-status

echo.
echo ======================================================
pause
