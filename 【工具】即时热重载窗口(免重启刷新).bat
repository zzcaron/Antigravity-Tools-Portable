@echo off
chcp 65001 >nul
title Antigravity 即时热重载窗口 (免重启刷新)
echo ======================================================
echo    正在向运行中的 Antigravity 窗口发送热重载指令
echo    效果: 相当于在客户端按下 Developer: Reload Window
echo          1 秒内即时刷新汉化、UI 面板与能量胶囊，无需重启客户端
echo ======================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%bin\node\node.exe"

if not exist "%NODE_EXE%" (
    set "NODE_EXE=node"
)

"%NODE_EXE%" "%SCRIPT_DIR%bin\hot-reload.js"

echo.
echo ======================================================
pause
