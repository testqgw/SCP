$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$logDir = Join-Path $repoRoot "exports\line-movement-snapshots\logs"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logDir "settled-refresh-$timestamp.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Set-Location $repoRoot

& npm.cmd run lines:snapshot:dataset -- @args 2>&1 | Tee-Object -FilePath $logPath
$datasetExitCode = $LASTEXITCODE
& npm.cmd run lines:snapshot:audit -- @args 2>&1 | Tee-Object -FilePath $logPath -Append
$auditExitCode = $LASTEXITCODE

if ($datasetExitCode -ne 0) {
  exit $datasetExitCode
}
exit $auditExitCode

