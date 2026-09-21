@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Please open this project in AIOA once to prepare it.
  pause
  exit /b 1
)
if not exist "node_modules\tsx\dist\cli.mjs" (
  echo Project dependencies are missing. Please open this project in AIOA once to prepare it.
  pause
  exit /b 1
)
node "node_modules\tsx\dist\cli.mjs" "src\web\server.ts" %*
