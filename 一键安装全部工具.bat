@echo off
chcp 65001 >nul
title 一键安装全部 Antigravity 工具
echo ======================================================
echo    一键安装全部工具 (Context Viewer + Pulse 能量胶囊)
echo    安装顺序: 先安装 Context Viewer，后安装 Pulse
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
    echo [提示] 检测到 Antigravity 正在运行，正在关闭以进行整包补丁注入...
    taskkill /F /IM Antigravity.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
)

echo.
echo ======================================================
echo [步骤 1/2] 正在安装 Context Viewer (上下文查看器)...
echo ======================================================
"%NODE_EXE%" "%SCRIPT_DIR%packages\viewer\cli.js" install
if "%ERRORLEVEL%" neq "0" (
    echo.
    echo [错误] Context Viewer 安装失败，中止后续流程。
    goto END
)

echo.
echo ======================================================
echo [步骤 2/2] 正在安装 Pulse (能量胶囊)...
echo ======================================================
cd /d "%SCRIPT_DIR%packages\pulse"
"%NODE_EXE%" "%SCRIPT_DIR%packages\pulse\install-context-capsule.js" --yes
if "%ERRORLEVEL%" neq "0" (
    echo.
    echo [警告] Pulse 安装遇到问题，请检查上方日志。
    goto END
)

echo.
echo [启动与热重载] 正在确保 Antigravity 客户端已启动并刷新界面...
"%NODE_EXE%" "%SCRIPT_DIR%bin\hot-reload.js"

echo.
echo ======================================================
echo    恭喜！全部工具已成功安装完毕！
echo    - 顶部顶栏: Context Viewer (上下文审计、Token热力图、账单等)
echo    - 底部输入框: Pulse (实时 tok/s、容量跑道胶囊、5小时配额倒计时)
echo ======================================================

:END
echo.
pause
