@echo off
rem Antigravity Pulse - double-click to install or update
rem Other actions: setup.cmd -Action check | -Action uninstall | -Action web
if "%~1"=="" if exist "%~dp0install-context-capsule.js" if exist "%~dp0context-capsule-payload.js" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Offline
    goto :done
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
:done
pause
