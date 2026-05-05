param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TaskName = "ULTOPS Final V1 Daily Publish",
  [string]$Time = "18:35",
  [string]$Branch = ""
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $RepoRoot "scripts\run-final-v1-daily-publish.ps1"
if (-not (Test-Path $scriptPath)) {
  throw "Could not find publish script: $scriptPath"
}

if (-not $Branch) {
  Push-Location $RepoRoot
  try {
    $Branch = (& git branch --show-current).Trim()
  } finally {
    Pop-Location
  }
}
if (-not $Branch) {
  throw "Could not determine git branch."
}

$logDir = Join-Path $RepoRoot "output"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir "final-v1-daily-publish.out.log"
$stderr = Join-Path $logDir "final-v1-daily-publish.err.log"

$quotedScript = '"' + $scriptPath + '"'
$quotedRepo = '"' + $RepoRoot + '"'
$arguments = "-NoProfile -ExecutionPolicy Bypass -File $quotedScript -RepoRoot $quotedRepo -Branch `"$Branch`" *> `"$stdout`" 2> `"$stderr`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Generates the exact Final Player Prop Model V1 slate artifact, commits it, pushes to GitHub, waits for Vercel preview, and promotes it to ultops.com." `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Schedule: daily at $Time local time"
Write-Host "Branch: $Branch"
Write-Host "Logs:"
Write-Host "  $stdout"
Write-Host "  $stderr"
