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
    [string]$BackupDir = "",
    [int]$KeepDays = 14,
    [string]$Container = "sales-erp-postgres",
    [string]$Database = "sales_erp",
    [string]$DbUser = "postgres",
    # Where the dump is copied after it has been verified. Several destinations are
    # allowed. Leave empty for the defaults (the OneDrive folder that syncs this
    # project, plus Google Drive when it is mounted) so the copy leaves the machine
    # as soon as either client syncs. Point it at a USB/network drive with
    # -OffsiteDir "X:\SalesERP-Backups" (a missing drive is skipped, not fatal).
    [string[]]$OffsiteDir = @(),
    # Where the AES key lives. It must NOT sit inside a backup folder: whoever has
    # the key can read the cloud copies, so keep it in a password manager too.
    [string]$KeyFile = ""
)

$ErrorActionPreference = "Stop"

# $PSScriptRoot is not reliable inside param() defaults on Windows PowerShell 5.1.
$ScriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$ProjectRoot = Split-Path -Parent $ScriptRoot
if (-not $BackupDir) { $BackupDir = Join-Path $ProjectRoot "backups" }
if (-not $KeyFile) { $KeyFile = Join-Path $ProjectRoot "backup-key.txt" }

# First thing that happens: prove in the log that the task really started, so a hang
# later can never look like "the script never ran".
try {
    $earlyLog = Join-Path $BackupDir "backup.log"
    Add-Content -Path $earlyLog -Encoding utf8 -Value ("[{0}] START pid={1} host={2} user={3}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $PID, $env:COMPUTERNAME, $env:USERNAME)
} catch {
    # never let the diagnostics break the backup
}

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

# ---------------------------------------------------------------------------
# Encrypt the copy that leaves the machine. The local dump stays plain so a restore
# on this server is a one-liner; the copies in the cloud folders are AES-256-CBC +
# HMAC-SHA256 and useless without backup-key.txt.
# ---------------------------------------------------------------------------
. (Join-Path $PSScriptRoot "backup-crypto.ps1")
$keyInfo = Get-BackupKey -KeyFile $KeyFile
if ($keyInfo.Created) {
    Write-Log "NEW BACKUP KEY created at $KeyFile"
    Write-Log "  copy it into a password manager NOW - without it the off-site copies cannot be restored"
    Write-Host ""
    Write-Host "  BACKUP KEY (shown once): $($keyInfo.Key)"
    Write-Host ""
}

$encrypted = Join-Path $BackupDir ("{0}.enc" -f (Split-Path $target -Leaf))
Protect-BackupFile -Path $target -OutPath $encrypted -Password $keyInfo.Key | Out-Null
Write-Log ("encrypted off-site copy ({0} MB)" -f [math]::Round((Get-Item $encrypted).Length / 1MB, 2))

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
# Off-site copy (OneDrive / Google Drive / USB / network share).
#
# A backup that only exists on the same disk as the database is not a backup. Every
# destination is hash-verified and pruned with the same retention. Several copies are
# made; one failing (a USB stick left at home, a paused cloud client) only logs a
# warning - the backup is marked failed only when NO destination received the file.
# ---------------------------------------------------------------------------
$destinations = @($OffsiteDir | Where-Object { $_ })

if ($destinations.Count -eq 0) {
    $defaults = @(
        "D:\OneDrive\Desktop\SFUWT-Project-Backup-2026-09-27\sales-erp-backups",
        "G:\My Drive\SalesERP-Backups"
    )
    foreach ($candidate in $defaults) {
        if (Test-Path (Split-Path $candidate -Parent)) { $destinations += $candidate }
    }
}

$offsiteOk = 0
foreach ($directory in $destinations) {
    try {
        $parent = Split-Path $directory -Parent
        if (-not (Test-Path $parent)) { throw "drive/folder not available ($parent)" }

        New-Item -ItemType Directory -Force -Path $directory | Out-Null

        # Only the encrypted file leaves the machine.
        $copyPath = Join-Path $directory (Split-Path $encrypted -Leaf)
        Copy-Item -Path $encrypted -Destination $copyPath -Force

        $sourceHash = (Get-FileHash -Path $encrypted -Algorithm SHA256).Hash
        $copyHash = (Get-FileHash -Path $copyPath -Algorithm SHA256).Hash
        if ($sourceHash -ne $copyHash) { throw "hash mismatch after copy" }

        Write-Log "off-site copy ok -> $copyPath (encrypted)"
        $offsiteOk++

        # A plain dump left there by an older version would defeat the encryption.
        $plain = Get-ChildItem -Path $directory -Filter "sales_erp_*.dump" -File
        foreach ($file in $plain) {
            Remove-Item -Force $file.FullName
            Write-Log ("removed an old UNENCRYPTED copy from {0}: {1}" -f $directory, $file.Name)
        }

        $oldCopies = Get-ChildItem -Path $directory -Filter "sales_erp_*.dump.enc" -File |
            Where-Object { $_.LastWriteTime -lt $cutoff }
        foreach ($file in $oldCopies) {
            Remove-Item -Force $file.FullName
            Write-Log ("off-site pruned {0} ({1})" -f $file.Name, $directory)
        }
    } catch {
        Write-Log ("WARNING: off-site copy to {0} failed: {1}" -f $directory, $_.Exception.Message)
    }
}

if ($destinations.Count -eq 0) {
    Write-Log "no off-site directory configured - copy $BackupDir somewhere else yourself."
} elseif ($offsiteOk -eq 0) {
    Write-Log "FAILED: none of the off-site destinations received the backup (local copy is good)."
    exit 2
} else {
    Write-Log ("off-site: {0} of {1} destination(s) updated" -f $offsiteOk, $destinations.Count)
}

if (Test-Path $encrypted) { Remove-Item -Force $encrypted }

$onedrive = Get-Process OneDrive -ErrorAction SilentlyContinue
if (-not $onedrive) {
    Write-Log "WARNING: OneDrive is not running, so its copy has not left the machine yet."
}

Write-Log "remember to keep at least one copy off this machine."