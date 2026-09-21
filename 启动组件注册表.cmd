@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules" (
  pnpm install
  if errorlevel 1 pause & exit /b 1
)
pnpm web
