# =============================================================================
# Backup agent - runs inside the signed-in desktop session.
#
# Why not Task Scheduler: on this machine `docker.exe` blocks forever when it is
# started by a scheduled task (the Docker Desktop pipe is not reachable from that
# token), while it works normally from the user's session. The agent therefore runs
# from the Startup folder, exactly like a normal user process.
#
#   scripts\SalesERP-Backup-Agent.cmd   (Startup folder)  -> this script, hidden
#   .\scripts\backup-agent.ps1 -Once    (run one check now, for testing)
#
# Every 30 minutes it checks:
#   * is the newest local dump older than 20 hours?  -> run backup-docker.ps1
#   * is it a new month and no drill log entry yet?  -> run restore-drill.ps1
#
# Everything is logged to backups\agent.log.
# =============================================================================
param(
    [int]$CheckEveryMinutes = 30,
    [int]$MaxAgeHours = 20,
    [string]$BackupDir = "",
    [switch]$Once
)

$ErrorActionPreference = "Continue"

$ScriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$ProjectRoot = Split-Path -Parent $ScriptRoot
if (-not $BackupDir) { $BackupDir = Join-Path $ProjectRoot "backups" }
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$agentLog = Join-Path $BackupDir "agent.log"
$backupScript = Join-Path $ScriptRoot "backup-docker.ps1"
$drillScript = Join-Path $ScriptRoot "restore-drill.ps1"
$drillMarker = Join-Path $BackupDir ".last-drill"

function Write-AgentLog([string]$message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
    Add-Content -Path $agentLog -Value $line -Encoding utf8
}

# One agent per machine: a second copy exits immediately.
$mutex = New-Object System.Threading.Mutex($false, "Global\SalesERP-Backup-Agent")
if (-not $mutex.WaitOne(0)) {
    Write-AgentLog "another agent is already running - exiting"
    exit 0
}

function Invoke-DailyBackup {
    $newest = Get-ChildItem -Path $BackupDir -Filter "sales_erp_*.dump" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    $ageHours = if ($newest) { ((Get-Date) - $newest.LastWriteTime).TotalHours } else { 9999 }
    if ($newest -and $ageHours -lt $MaxAgeHours) {
        Write-AgentLog ("backup check: newest dump is {0:N1} h old - nothing to do" -f $ageHours)
        return
    }

    Write-AgentLog ("backup check: newest dump is {0:N1} h old - running backup" -f $ageHours)
    # The agent runs inside the user session, so docker.exe behaves normally here.
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $backupScript -BackupDir $BackupDir
    $code = $LASTEXITCODE
    Write-AgentLog ("backup finished with exit code {0}" -f $code)
}

function Invoke-MonthlyDrill {
    $now = Get-Date
    $lastRun = $null
    if (Test-Path $drillMarker) {
        $raw = (Get-Content $drillMarker -Raw).Trim()
        if ($raw) { $lastRun = [datetime]::Parse($raw) }
    }

    if ($lastRun -and $lastRun.Year -eq $now.Year -and $lastRun.Month -eq $now.Month) {
        return
    }

    Write-AgentLog "drill check: running the monthly restore drill"
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $drillScript -BackupDir $BackupDir
    $code = $LASTEXITCODE

    if ($code -eq 0) {
        Set-Content -Path $drillMarker -Value (Get-Date -Format "o") -Encoding utf8
        Write-AgentLog "drill check: PASS"
    } else {
        Write-AgentLog ("drill check: FAILED (exit {0}) - see drill.log" -f $code)
    }
}

Write-AgentLog "agent started (check every $CheckEveryMinutes min, backup max age ${MaxAgeHours}h)"

do {
    try {
        Invoke-DailyBackup
        Invoke-MonthlyDrill
    } catch {
        Write-AgentLog ("agent error: {0}" -f $_.Exception.Message)
    }

    if ($Once) { break }
    Start-Sleep -Seconds ($CheckEveryMinutes * 60)
} while ($true)

$mutex.ReleaseMutex()
$mutex.Dispose()
Write-AgentLog "agent stopped"
