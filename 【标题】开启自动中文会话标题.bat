@echo off
chcp 65001 >nul
title 开启自动中文会话标题
echo ======================================================
echo    正在开启 Antigravity 自动中文会话标题
echo    功能: 让新对话自动生成简短的中文标题 (4~10字)
echo ======================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%bin\node\node.exe"

if not exist "%NODE_EXE%" (
    set "NODE_EXE=node"
)

echo [1/3] 检查客户端运行状态...
tasklist /FI "IMAGENAME eq Antigravity.exe" 2>NUL | find /I /N "Antigravity.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [提示] 检测到 Antigravity 正在运行，正在关闭以更新后端核心...
    taskkill /F /IM Antigravity.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
)

echo [2/3] 正在应用中文标题提示词补丁...
"%NODE_EXE%" "%SCRIPT_DIR%packages\viewer\cli.js" enhance --title on
if "%ERRORLEVEL%" neq "0" (
    echo.
    echo [错误] 开启失败，请检查上方日志。
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
echo    自动中文会话标题已成功开启！
echo ======================================================

:END
echo.
pause
