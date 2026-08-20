@echo off
setlocal
cd /d "%~dp0"
title Local Project Launcher

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Local Project Launcher] Node.js was not found.
  echo Install Node.js LTS first, then run this file again.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo [Local Project Launcher] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency install failed. Please send this window output to Codex.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
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
)

if not exist "dist\index.html" (
  echo.
  echo [Local Project Launcher] Building visual page...
  call npm run build
  if errorlevel 1 (
    echo.
    echo Build failed. Please send this window output to Codex.
    pause
    exit /b 1
  )
)

if not exist "dist-electron\main\main.js" (
  echo.
  echo [Local Project Launcher] Building desktop entry...
  call npm run build:electron
  if errorlevel 1 (
    echo.
    echo Build failed. Please send this window output to Codex.
    pause
    exit /b 1
  )
)

echo.
echo [Local Project Launcher] Opening visual desktop app...
call npm start

if errorlevel 1 (
  echo.
  echo App failed to start. Please send this window output to Codex.
  pause
  exit /b 1
)
