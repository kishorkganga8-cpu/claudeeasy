@echo off
setlocal
cd /d "%~dp0"
if exist "node.exe" (set "NODE=%~dp0node.exe") else (set "NODE=node")
"%NODE%" "%~dp0cli.js" %*
if errorlevel 1 pause
