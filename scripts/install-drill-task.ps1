# =============================================================================
# Registers the monthly restore drill in Windows Task Scheduler.
#
#   .\scripts\install-drill-task.ps1
#   .\scripts\install-drill-task.ps1 -DayOfMonth 1 -Time 02:30
#
# The drill restores the newest backup into a scratch database and compares it with
# the live data - so "the backup is fine" is proven every month, not assumed. The
# live database is never touched. Results go to backups\drill.log.
#
# Windows PowerShell 5.1's New-ScheduledTaskTrigger cannot build a monthly trigger,
# so this uses schtasks.exe (which can) together with scripts\run-drill.cmd.
#
# Remove it with:  schtasks /delete /tn "SalesERP-Backup-Drill" /f
# =============================================================================
param(
    [int]$DayOfMonth = 1,
    [string]$Time = "02:30",
    [string]$TaskName = "SalesERP-Backup-Drill"
)

$ErrorActionPreference = "Stop"

$wrapper = Join-Path $PSScriptRoot "run-drill.cmd"
if (-not (Test-Path $wrapper)) { throw "run-drill.cmd not found next to this script" }

# schtasks wants: /tr "\"C:\path with spaces\run-drill.cmd\""
$command = '"' + $wrapper + '"'

& schtasks /create /tn $TaskName /tr $command /sc monthly /d $DayOfMonth /st $Time /f | Out-Null
if ($LASTEXITCODE -ne 0) { throw "schtasks failed with exit code $LASTEXITCODE" }

$query = & schtasks /query /tn $TaskName /fo LIST | Out-String
Write-Host $query.Trim()
Write-Host ""
Write-Host "[drill-task] wrapper:  $wrapper"
Write-Host "[drill-task] log:      $(Join-Path (Split-Path -Parent $PSScriptRoot) 'backups\drill.log')"
Write-Host ""
Write-Host "Run it now with:  schtasks /run /tn `"$TaskName`""
Write-Host "Check the result: Get-Content '$(Join-Path (Split-Path -Parent $PSScriptRoot) 'backups\drill.log')' -Tail 20"
