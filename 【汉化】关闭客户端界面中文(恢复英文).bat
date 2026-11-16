@echo off
chcp 65001 >nul
title 关闭 Antigravity 客户端界面简体中文 (恢复英文)
echo ======================================================
echo    正在关闭 Antigravity 客户端界面简体中文 (方案 A 纯净版)
echo    功能: 恢复为官方原版英文界面 (支持即时热重载)
echo ======================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%bin\node\node.exe"

if not exist "%NODE_EXE%" (
    set "NODE_EXE=node"
)

echo [1/3] 正在剥离汉化补丁并恢复官方原生英文界面...
"%NODE_EXE%" "%SCRIPT_DIR%bin\patch-chinese.js" --disable
if "%ERRORLEVEL%" neq "0" (
    echo.
    echo [错误] 操作失败，请检查上方日志。
    goto END
)

echo.
"%NODE_EXE%" "%SCRIPT_DIR%packages\pulse\install-context-capsule.js" --check >nul 2>&1
if "%ERRORLEVEL%" equ "0" (
    echo [2/3] 正在巡检并保障 Pulse 能量胶囊挂载...
    "%NODE_EXE%" "%SCRIPT_DIR%packages\pulse\install-context-capsule.js" --ensure
) else (
    echo [2/3] Pulse 能量胶囊未安装，保持纯净状态跳过。
)

echo.
echo [3/3] 正在执行即时热重载或启动客户端...
"%NODE_EXE%" "%SCRIPT_DIR%bin\hot-reload.js"

echo.
echo ======================================================
echo    已成功恢复为官方原生英文界面并即时刷新！
echo ======================================================

:END
echo.
pause
