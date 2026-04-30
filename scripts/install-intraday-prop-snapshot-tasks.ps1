$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$snapshotScript = Join-Path $repoRoot "scripts\run-intraday-prop-snapshot-job.ps1"
$datasetScript = Join-Path $repoRoot "scripts\run-intraday-settled-refresh-job.ps1"

$snapshotTaskName = "NBA Prop Intraday Line Snapshot"
$datasetTaskName = "NBA Prop Intraday Line Dataset"

$snapshotAction = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$snapshotScript`""
$snapshotTrigger = New-ScheduledTaskTrigger -Daily -At 11:00AM
$snapshotTrigger.Repetition.Interval = "PT30M"
$snapshotTrigger.Repetition.Duration = "PT13H"
$snapshotTrigger.Repetition.StopAtDurationEnd = $true

$datasetAction = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$datasetScript`""
$datasetTrigger = New-ScheduledTaskTrigger -Daily -At 3:30AM

Register-ScheduledTask `
  -TaskName $snapshotTaskName `
  -Action $snapshotAction `
  -Trigger $snapshotTrigger `
  -Description "Capture NBA player prop line snapshots every 30 minutes for intraday movement modeling." `
  -Force | Out-Null

Register-ScheduledTask `
  -TaskName $datasetTaskName `
  -Action $datasetAction `
  -Trigger $datasetTrigger `
  -Description "Refresh the intraday prop line movement dataset after games settle." `
  -Force | Out-Null

Write-Host "Installed scheduled tasks:"
Write-Host " - $snapshotTaskName"
Write-Host " - $datasetTaskName"

