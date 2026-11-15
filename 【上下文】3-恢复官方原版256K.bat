@echo off
chcp 65001 >nul
title 恢复 Antigravity 上下文为官方原版 256K
echo ======================================================
echo    恢复 Antigravity 上下文为官方原版 256K
echo    模式说明: 恢复原始未修改二进制，自动压缩阈值回归 256,000
echo ======================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%bin\node\node.exe"

if not exist "%NODE_EXE%" (
    set "NODE_EXE=node"
)

echo [1/3] 检查客户端与后端内核运行状态...
tasklist /FI "IMAGENAME eq Antigravity.exe" 2>NUL | find /I /N "Antigravity.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [提示] 检测到 Antigravity 正在运行，正在关闭以还原官方二进制...
    taskkill /F /T /IM Antigravity.exe >nul 2>&1
    taskkill /F /IM language_server.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
)

echo [2/3] 正在恢复官方原版二进制...
"%NODE_EXE%" "%SCRIPT_DIR%packages\viewer\cli.js" unlock-restore
if "%ERRORLEVEL%" neq "0" (
    echo.
    echo [错误] 还原失败，请检查上方日志。
    goto END
)

echo.
echo [3/3] 正在启动客户端并同步前端组件...
set "AGY_EXE=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
if not exist "%AGY_EXE%" set "AGY_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
if exist "%AGY_EXE%" (
    start "" "%AGY_EXE%"
)

echo.
echo ======================================================
echo    已成功恢复为官方原版 256K！
echo ======================================================

:END
echo.
pause
