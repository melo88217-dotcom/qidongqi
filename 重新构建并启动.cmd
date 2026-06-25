@echo off
setlocal
cd /d "%~dp0"
title Rebuild Local Project Launcher

echo.
echo [Local Project Launcher] Reinstalling dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo Dependency install failed. Please send this window output to Codex.
  pause
  exit /b 1
)

echo.
echo [Local Project Launcher] Installing Electron runtime...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
call npx install-electron --no
if errorlevel 1 (
  echo.
  echo Electron runtime install failed. Please send this window output to Codex.
  pause
  exit /b 1
)

echo.
echo [Local Project Launcher] Rebuilding app...
call npm run build
if errorlevel 1 (
  echo.
  echo Build failed. Please send this window output to Codex.
  pause
  exit /b 1
)

echo.
echo [Local Project Launcher] Opening visual desktop app...
call npm start
