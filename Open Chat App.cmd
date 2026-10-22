@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Open Chat App.ps1"
if errorlevel 1 pause
