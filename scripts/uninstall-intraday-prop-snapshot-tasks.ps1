$ErrorActionPreference = "Stop"

$taskNames = @(
  "NBA Prop Intraday Line Snapshot",
  "NBA Prop Intraday Line Dataset"
)

foreach ($taskName in $taskNames) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task: $taskName"
  } else {
    Write-Host "Scheduled task not found: $taskName"
  }
}

