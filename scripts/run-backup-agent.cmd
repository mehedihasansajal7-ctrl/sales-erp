@echo off
rem Starts the ERP backup agent (hidden) in the signed-in session.
start "" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0backup-agent.ps1"