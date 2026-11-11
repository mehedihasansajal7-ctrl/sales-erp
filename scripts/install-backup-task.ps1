# =============================================================================
# Registers the nightly backup in Windows Task Scheduler.
#
#   .\scripts\install-backup-task.ps1
#   .\scripts\install-backup-task.ps1 -Time 02:30 -BackupDir D:\Backups\SalesERP
#
# The task runs as the current user, only when the machine is on, and catches up
# after a missed run (StartWhenAvailable) - a laptop that was asleep at 01:15 still
# gets its backup when it wakes up.
#
# Remove it again with:  Unregister-ScheduledTask -TaskName "SalesERP-DB-Backup"
# =============================================================================
param(
    [string]$Time = "01:15",
    [string]$TaskName = "SalesERP-DB-Backup",
    [string]$BackupDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "backups")
)

$ErrorActionPreference = "Stop"

$script = Join-Path $PSScriptRoot "backup-docker.ps1"
if (-not (Test-Path $script)) { throw "backup-docker.ps1 not found next to this script" }

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -BackupDir `"$BackupDir`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Nightly PostgreSQL backup of the Sales & Delivery ERP (pg_dump inside the db container)." `
    -Force | Out-Null

$info = Get-ScheduledTask -TaskName $TaskName
$next = (Get-ScheduledTaskInfo -TaskName $TaskName).NextRunTime

Write-Host "[task] registered: $($info.TaskName)"
Write-Host "[task] state:      $($info.State)"
Write-Host "[task] schedule:   daily at $Time (next: $next)"
Write-Host "[task] runs:       $script"
Write-Host "[task] store:      $BackupDir"
Write-Host ""
Write-Host "Test it now with:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Check the result:  Get-Content '$BackupDir\backup.log' -Tail 20"
