@echo off
REM Wrapper bấm-đúp cho start_local.ps1 (truyền cờ: start_local.cmd -Fresh)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_local.ps1" %*
pause
