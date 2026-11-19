# =============================================================================
# Decrypt a backup downloaded from OneDrive / Google Drive.
#
#   .\scripts\decrypt-backup.ps1 -Encrypted "C:\Downloads\sales_erp_....dump.enc"
#   .\scripts\decrypt-backup.ps1 -Encrypted ... -Out "D:\restore\sales_erp.dump"
#
# The key file is D:\sales-erp\backup-key.txt unless you point -KeyFile elsewhere.
# Without that key the encrypted copies cannot be restored - keep it in a password
# manager, not next to the backups.
#
# Then restore normally:
#   docker exec -i sales-erp-postgres pg_restore -U postgres -d sales_erp_restore --no-owner < sales_erp.dump
# =============================================================================
param(
    [Parameter(Mandatory)][string]$Encrypted,
    [string]$Out,
    [string]$KeyFile = ""
)

$ErrorActionPreference = "Stop"

# $PSScriptRoot is not reliable inside param() defaults on Windows PowerShell 5.1.
$ScriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $KeyFile) { $KeyFile = Join-Path (Split-Path -Parent $ScriptRoot) "backup-key.txt" }

. (Join-Path $ScriptRoot "backup-crypto.ps1")

if (-not (Test-Path $Encrypted)) { throw "Encrypted backup not found: $Encrypted" }
if (-not (Test-Path $KeyFile)) { throw "Key file not found: $KeyFile" }

if (-not $Out) {
    $Out = $Encrypted -replace '\.enc$', ''
    if ($Out -eq $Encrypted) { $Out = "$Encrypted.dump" }
}

$key = (Get-Content -Path $KeyFile -Raw).Trim()

Write-Host "[decrypt] $Encrypted"
Write-Host "[decrypt] key: $KeyFile"
Unprotect-BackupFile -Path $Encrypted -OutPath $Out -Password $key | Out-Null

$sizeMb = [math]::Round((Get-Item $Out).Length / 1MB, 2)
Write-Host "[decrypt] ok -> $Out ($sizeMb MB)"
Write-Host ""
Write-Host "Restore it with:  .\scripts\restore-docker.sh <dump>   (Linux)"
Write-Host "                  docker exec -i sales-erp-postgres pg_restore -U postgres -d <db> --no-owner < $Out"
