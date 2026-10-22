@echo off
setlocal
cd /d "%~dp0"
if exist "node.exe" (set "NODE=%~dp0node.exe") else (set "NODE=node")
start "Claude Key Connect Gateway" /min cmd /k ""%NODE%" "%~dp0server.js""
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3848/"
echo Claude Key Connect opened at http://127.0.0.1:3848/
echo Keep the gateway window running while using Claude Code.
pause
