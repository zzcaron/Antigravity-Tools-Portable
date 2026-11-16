@echo off
chcp 65001 >nul
title 安装 Antigravity Pulse (能量胶囊)
echo ======================================================
echo    正在安装 Antigravity Pulse (能量胶囊)
echo ======================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%bin\node\node.exe"

if not exist "%NODE_EXE%" (
    set "NODE_EXE=node"
)

echo [提示] 正在执行能量胶囊原子注入（若客户端运行中将自动优雅重启）...
cd /d "%SCRIPT_DIR%packages\pulse"
"%NODE_EXE%" "%SCRIPT_DIR%packages\pulse\install-context-capsule.js" --yes
if "%ERRORLEVEL%" neq "0" (
    echo.
    echo [错误] Pulse 安装失败，请检查上方日志。
    goto END
)
"%NODE_EXE%" "%SCRIPT_DIR%bin\sync-pulse-limit.js" >nul 2>&1

echo.
echo ======================================================
echo    Pulse 能量胶囊安装完成！已在输入框底部 Turbo 旁生效。
echo ======================================================

:END
echo.
pause
