$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$logDir = Join-Path $repoRoot "exports\line-movement-snapshots\logs"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logDir "snapshot-$timestamp.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Set-Location $repoRoot

& npm.cmd run lines:snapshot:live -- @args 2>&1 | Tee-Object -FilePath $logPath
exit $LASTEXITCODE

