@echo off
rem Wrapper used by the "SalesERP-Backup-Drill" scheduled task.
rem Keeps the quoting simple and logs the result to backups\drill.log.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-drill.ps1" -BackupDir "%~dp0..\backups"
exit /b %ERRORLEVEL%
