@echo off
chcp 65001 >nul
title 卸载 Antigravity Pulse (能量胶囊)
echo ======================================================
echo    正在卸载 Antigravity Pulse (能量胶囊)
echo ======================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%bin\node\node.exe"

if not exist "%NODE_EXE%" (
    set "NODE_EXE=node"
)

echo [提示] 正在精确剥离能量胶囊补丁并清理残留...
cd /d "%SCRIPT_DIR%packages\pulse"
"%NODE_EXE%" "%SCRIPT_DIR%packages\pulse\install-context-capsule.js" --uninstall --clean --yes
if "%ERRORLEVEL%" neq "0" (
    echo.
    echo [错误] Pulse 卸载失败，请检查上方日志。
    goto END
)

echo.
echo ======================================================
echo    Pulse 能量胶囊已成功卸载！
echo ======================================================

:END
echo.
pause
