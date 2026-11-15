@echo off
chcp 65001 >nul
title 安装 Context Viewer (上下文查看器)
echo ======================================================
echo    正在安装 Antigravity Context Viewer (上下文查看器)
echo ======================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%bin\node\node.exe"

if not exist "%NODE_EXE%" (
    set "NODE_EXE=node"
)

echo [1/3] 正在确保客户端完全退出以完成补丁注入...
taskkill /F /T /IM Antigravity.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/3] 正在注入 Context Viewer 组件...
"%NODE_EXE%" "%SCRIPT_DIR%packages\viewer\cli.js" install
if "%ERRORLEVEL%" neq "0" (
    echo.
    echo [错误] Context Viewer 安装失败，请检查上方日志。
    goto END
)

echo.
echo [3/3] 正在启动 Antigravity 客户端...
set "AGY_EXE=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
if not exist "%AGY_EXE%" set "AGY_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
if exist "%AGY_EXE%" (
    start "" "%AGY_EXE%"
)

echo.
echo ======================================================
echo    Context Viewer 安装完成！已在顶栏生效。
echo ======================================================

:END
echo.
pause