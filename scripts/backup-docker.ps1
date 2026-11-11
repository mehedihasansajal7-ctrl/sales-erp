# =============================================================================
# Nightly PostgreSQL backup for the docker-compose deployment (Windows host).
#
#   .\scripts\backup-docker.ps1
#   .\scripts\backup-docker.ps1 -BackupDir D:\Backups\SalesERP -KeepDays 30
#
# Runs pg_dump *inside* the database container (nothing to install on the host),
# verifies the archive with pg_restore --list, then moves it into place. A partial
# or unreadable dump is deleted and the script fails, so a broken backup can never
# look like a good one.
#
# Install the schedule once with:  .\scripts\install-backup-task.ps1
# Restore drill / restore:         .\scripts\restore-drill.ps1
# =============================================================================
param(
    [string]$BackupDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "backups"),
    [int]$KeepDays = 14,
    [string]$Container = "sales-erp-postgres",
    [string]$Database = "sales_erp",
    [string]$DbUser = "postgres",
    # Where the dump is copied after it has been verified. Defaults to the OneDrive
    # folder that already syncs this project, so the copy leaves the machine as soon
    # as OneDrive syncs. Point it at a USB/network drive with -OffsiteDir "X:\...".
    # Pass -OffsiteDir "" to skip the off-site copy.
    [string]$OffsiteDir = ""
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
    Write-Host $line
    $logFile = Join-Path $BackupDir "backup.log"
    if (Test-Path $BackupDir) { Add-Content -Path $logFile -Value $line -Encoding utf8 }
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

# The container must be running - a stopped database is a failed backup, not a skip.
$running = (docker inspect -f "{{.State.Running}}" $Container 2>$null)
if ($LASTEXITCODE -ne 0 -or $running -ne "true") {
    Write-Log "FAILED: database container $Container is not running"
    exit 1
}

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$target = Join-Path $BackupDir ("sales_erp_{0}.dump" -f $stamp)
$inside = "/tmp/sales_erp_$stamp.dump"
$verify = "/tmp/sales_erp_$stamp.verify.dump"

Write-Log "dumping $Database to $target"

docker exec $Container pg_dump -U $DbUser -d $Database --format=custom --no-owner --no-privileges --file=$inside
if ($LASTEXITCODE -ne 0) {
    Write-Log "FAILED: pg_dump returned $LASTEXITCODE"
    docker exec $Container rm -f $inside 2>$null
    exit 1
}

docker cp ("{0}:{1}" -f $Container, $inside) $target
docker exec $Container rm -f $inside | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $target)) {
    Write-Log "FAILED: could not copy the dump out of the container"
    exit 1
}

# A partial file must never look like a backup: verify the archive before keeping it.
docker cp $target ("{0}:{1}" -f $Container, $verify)
docker exec $Container pg_restore --list $verify > $null
$verifyExit = $LASTEXITCODE
docker exec $Container rm -f $verify | Out-Null

if ($verifyExit -ne 0) {
    Remove-Item -Force $target
    Write-Log "FAILED: dump could not be verified with pg_restore --list - removed"
    exit 1
}

$sizeMb = [math]::Round((Get-Item $target).Length / 1MB, 2)
Write-Log ("ok ({0} MB)" -f $sizeMb)

$cutoff = (Get-Date).AddDays(-$KeepDays)
$old = Get-ChildItem -Path $BackupDir -Filter "sales_erp_*.dump" -File |
    Where-Object { $_.LastWriteTime -lt $cutoff }
foreach ($file in $old) {
    Remove-Item -Force $file.FullName
    Write-Log ("pruned {0}" -f $file.Name)
}

Write-Log "newest backups:"
Get-ChildItem -Path $BackupDir -Filter "sales_erp_*.dump" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 5 |
    ForEach-Object { Write-Log ("  {0}  {1} MB" -f $_.Name, [math]::Round($_.Length / 1MB, 2)) }

# ---------------------------------------------------------------------------
# Off-site copy (OneDrive / USB / network share). A backup that only exists on the
# same disk as the database is not a backup: this copy is hash-verified, and it is
# pruned with the same retention as the local one. A failed copy makes the task
# show a non-zero result instead of failing silently.
# ---------------------------------------------------------------------------
if (-not $OffsiteDir) {
    $candidate = "D:\OneDrive\Desktop\SFUWT-Project-Backup-2026-09-27\sales-erp-backups"
    if (Test-Path (Split-Path $candidate -Parent)) { $OffsiteDir = $candidate }
}

if ($OffsiteDir) {
    try {
        New-Item -ItemType Directory -Force -Path $OffsiteDir | Out-Null
        $destination = Join-Path $OffsiteDir (Split-Path $target -Leaf)
        Copy-Item -Path $target -Destination $destination -Force

        $sourceHash = (Get-FileHash -Path $target -Algorithm SHA256).Hash
        $copyHash = (Get-FileHash -Path $destination -Algorithm SHA256).Hash
        if ($sourceHash -ne $copyHash) { throw "hash mismatch after copy" }

        Write-Log "off-site copy ok -> $destination"

        $oldCopies = Get-ChildItem -Path $OffsiteDir -Filter "sales_erp_*.dump" -File |
            Where-Object { $_.LastWriteTime -lt $cutoff }
        foreach ($file in $oldCopies) {
            Remove-Item -Force $file.FullName
            Write-Log ("off-site pruned {0}" -f $file.Name)
        }

        $onedrive = Get-Process OneDrive -ErrorAction SilentlyContinue
        if (-not $onedrive) {
            Write-Log "WARNING: OneDrive is not running, so the copy has not left the machine yet."
        }
    } catch {
        Write-Log ("OFF-SITE COPY FAILED: {0} (local backup is still good)" -f $_.Exception.Message)
        exit 2
    }
} else {
    Write-Log "no off-site directory configured - copy $BackupDir somewhere else yourself."
}

Write-Log "remember to keep at least one copy off this machine."
