@echo off
setlocal
cd /d "%~dp0"
title DLsite Tool

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo PowerShell was not found. This launcher requires Windows PowerShell.
  echo Please run: python launcher.py
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dlsite-tool.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Launcher failed with exit code %EXIT_CODE%.
) else (
  echo DLsite Tool has exited.
)
pause
exit /b %EXIT_CODE%
