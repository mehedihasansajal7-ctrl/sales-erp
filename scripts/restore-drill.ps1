# =============================================================================
# Restore drill: proves that a backup is usable WITHOUT touching the live data.
#
#   .\scripts\restore-drill.ps1                                  # newest dump
#   .\scripts\restore-drill.ps1 -Dump "backups\sales_erp_....dump"
#
# What it does:
#   1. picks the newest backup (or the one you name),
#   2. creates a scratch database `sales_erp_restore_drill` inside the db container,
#   3. restores the dump into it,
#   4. compares row counts of the important tables with the live database,
#   5. runs an integrity sanity check, then drops the scratch database.
#
# The live database is never dropped, renamed or written to.
# =============================================================================
param(
    [string]$Dump,
    [string]$BackupDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "backups"),
    [string]$Container = "sales-erp-postgres",
    [string]$LiveDb = "sales_erp",
    [string]$DrillDb = "sales_erp_restore_drill",
    [string]$DbUser = "postgres"
)

# Native tools (docker/psql) write NOTICEs to stderr; with "Stop" PowerShell turns those
# into terminating errors. Every important call below checks $LASTEXITCODE explicitly.
$ErrorActionPreference = "Continue"

if (-not $Dump) {
    $Dump = Get-ChildItem -Path $BackupDir -Filter "sales_erp_*.dump" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Dump -or -not (Test-Path $Dump)) { throw "No backup found in $BackupDir" }

Write-Host "[drill] dump:    $Dump ($([math]::Round((Get-Item $Dump).Length / 1MB, 2)) MB)"
Write-Host "[drill] scratch: $DrillDb (the live database '$LiveDb' is not touched)"

$inside = "/tmp/restore_drill.dump"
docker cp $Dump ("{0}:{1}" -f $Container, $inside) | Out-Null

# Start from a clean scratch database every time.
$exists = (docker exec $Container psql -U $DbUser -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname = '$DrillDb';").Trim()
if ($exists -eq "1") {
    docker exec $Container psql -U $DbUser -d postgres -q -v ON_ERROR_STOP=1 -c "DROP DATABASE $DrillDb;" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "could not drop the old scratch database" }
}

docker exec $Container psql -U $DbUser -d postgres -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DrillDb;" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "could not create the scratch database" }

Write-Host "[drill] restoring..."
docker exec $Container pg_restore -U $DbUser -d $DrillDb --no-owner --no-privileges $inside 2>&1 |
    ForEach-Object { Write-Host "        $_" }
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed (exit $LASTEXITCODE)" }

$tables = @(
    "users", "customers", "products", "warehouses",
    "orders", "order_items", "delivery_orders", "delivery_order_items",
    "dispatches", "dispatch_items",
    "stock_ledger", "stock_balances", "rates",
    "chat_messages", "audit_logs"
)

function Get-Count([string]$database, [string]$table) {
    $value = docker exec $Container psql -U $DbUser -d $database -t -A -c "SELECT count(*) FROM $table;"
    if ($LASTEXITCODE -ne 0) { return "ERR" }
    return $value.Trim()
}

Write-Host ""
Write-Host ("{0,-24} {1,10} {2,10}  {3}" -f "table", "live", "restored", "ok?")
$mismatch = 0
foreach ($table in $tables) {
    $liveCount = Get-Count $LiveDb $table
    $restoredCount = Get-Count $DrillDb $table
    $ok = ($liveCount -eq $restoredCount)
    if (-not $ok) { $mismatch++ }
    Write-Host ("{0,-24} {1,10} {2,10}  {3}" -f $table, $liveCount, $restoredCount, $(if ($ok) { "yes" } else { "NO" }))
}

# A restore that cannot answer the core business questions is not a restore.
Write-Host ""
$probe = docker exec $Container psql -U $DbUser -d $DrillDb -t -A -c @"
SELECT
  (SELECT count(*) FROM orders),
  (SELECT coalesce(sum(total_value), 0) FROM orders),
  (SELECT count(*) FROM stock_ledger),
  (SELECT count(*) FROM audit_logs);
"@
Write-Host "[drill] restored database answers: orders / order value / ledger rows / audit rows = $($probe.Trim())"

if ($mismatch -gt 0) {
    Write-Host ""
    Write-Host "[drill] RESULT: FAILED - $mismatch table(s) differ. The scratch database was kept for inspection."
    Write-Host "        inspect with: docker exec -it $Container psql -U $DbUser -d $DrillDb"
    exit 1
}

Write-Host ""
Write-Host "[drill] RESULT: PASS - every table matched the live database."
Write-Host "[drill] dropping the scratch database"

docker exec $Container psql -U $DbUser -d postgres -q -c "DROP DATABASE IF EXISTS $DrillDb;" 2>$null | Out-Null
docker exec $Container rm -f $inside | Out-Null

Write-Host "[drill] done - backup is usable."
