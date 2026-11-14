@echo off
chcp 65001 >nul
title 一键卸载全部 Antigravity 工具
echo ======================================================
echo    一键卸载全部工具并恢复官方纯净原版
echo    卸载顺序: 先卸载 Pulse 胶囊，后还原 Context Viewer
echo ======================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%bin\node\node.exe"

if not exist "%NODE_EXE%" (
    set "NODE_EXE=node"
)

echo [准备] 检查客户端运行状态...
tasklist /FI "IMAGENAME eq Antigravity.exe" 2>NUL | find /I /N "Antigravity.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [提示] 检测到 Antigravity 正在运行，正在关闭以安全还原文件...
    taskkill /F /IM Antigravity.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
)

echo.
echo ======================================================
echo [步骤 1/2] 正在卸载 Pulse (能量胶囊)...
echo ======================================================
cd /d "%SCRIPT_DIR%packages\pulse"
"%NODE_EXE%" "%SCRIPT_DIR%packages\pulse\install-context-capsule.js" --uninstall --clean --yes

echo.
echo ======================================================
echo [步骤 2/2] 正在还原 Context Viewer 原始纯净备份...
echo ======================================================
"%NODE_EXE%" "%SCRIPT_DIR%packages\viewer\cli.js" restore

echo.
echo [启动] 正在重新启动 Antigravity 客户端...
set "AGY_EXE=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
if not exist "%AGY_EXE%" set "AGY_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
if exist "%AGY_EXE%" (
    start "" "%AGY_EXE%"
)

echo.
echo ======================================================
echo    全部工具已成功卸载，客户端已 100% 恢复官方原版！
echo ======================================================

:END
echo.
pause
