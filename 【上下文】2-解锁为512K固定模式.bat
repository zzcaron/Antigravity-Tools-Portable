@echo off
chcp 65001 >nul
title 解锁上下文为 512K 固定模式
echo ======================================================
echo    解锁 Antigravity 上下文为 512K 固定模式
echo    模式说明: 将自动压缩阈值从官方 256,000 提升至 512,000
echo ======================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%bin\node\node.exe"

if not exist "%NODE_EXE%" (
    set "NODE_EXE=node"
)

echo [1/3] 正在确保客户端与后台推理内核完全退出...
taskkill /F /T /IM Antigravity.exe >nul 2>&1
taskkill /F /IM language_server.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/3] 正在应用 512K 固定解锁补丁...
"%NODE_EXE%" "%SCRIPT_DIR%packages\viewer\cli.js" unlock --mode fixed --limit 512000
if "%ERRORLEVEL%" neq "0" (
    echo.
    echo [错误] 解锁失败，请检查上方日志。
    goto END
)
"%NODE_EXE%" "%SCRIPT_DIR%bin\sync-pulse-limit.js" 512000 >nul 2>&1

echo.
echo [3/3] 正在启动客户端并同步前端组件...
set "AGY_EXE=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
if not exist "%AGY_EXE%" set "AGY_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
if exist "%AGY_EXE%" (
    start "" "%AGY_EXE%"
)

echo.
echo ======================================================
echo    已成功切换为「512K 固定模式」！
echo    客户端启动后分母将锁定为 512,000。
echo ======================================================

:END
echo.
pause
