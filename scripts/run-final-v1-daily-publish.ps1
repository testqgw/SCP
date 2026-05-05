param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$Branch = "",
  [string]$BoardUrl = "https://ultops.com/api/snapshot/board?refresh=1&rebuild=1",
  [switch]$SkipGit,
  [switch]$SkipVercel,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$stamp] $Message"
}

function Invoke-Logged {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )
  Write-Step ("> " + $FilePath + " " + ($Arguments -join " "))
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

function Get-JsonFromVercelList {
  $raw = (& cmd.exe /d /c "vercel.cmd ls --yes --format json 2>&1" | Out-String)
  $jsonStart = $raw.IndexOf("{")
  if ($jsonStart -lt 0) {
    throw "Could not parse Vercel deployment list."
  }
  return ($raw.Substring($jsonStart) | ConvertFrom-Json)
}

function Wait-ForPreviewDeployment {
  param(
    [string]$CommitSha,
    [int]$TimeoutSeconds = 600
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $list = Get-JsonFromVercelList
    $deployment = $list.deployments |
      Where-Object {
        $_.meta.githubCommitSha -eq $CommitSha -and
        $_.target -ne "production" -and
        $_.state -in @("READY", "BUILDING", "QUEUED")
      } |
      Sort-Object createdAt -Descending |
      Select-Object -First 1

    if ($deployment -and $deployment.state -eq "READY") {
      return "https://$($deployment.url)"
    }

    if ($deployment) {
      Write-Step "Waiting for Vercel preview $($deployment.url) ($($deployment.state))..."
    } else {
      Write-Step "Waiting for Vercel preview for commit $CommitSha..."
    }
    Start-Sleep -Seconds 15
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for Vercel preview deployment for $CommitSha."
}

Set-Location $RepoRoot

$logDir = Join-Path $RepoRoot "output"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$lockPath = Join-Path $logDir "final-v1-daily-publish.lock"
if (Test-Path $lockPath) {
  $lockAge = (Get-Date) - (Get-Item $lockPath).LastWriteTime
  if ($lockAge.TotalHours -lt 3) {
    throw "Final V1 publish lock already exists at $lockPath"
  }
  Remove-Item -Force $lockPath
}
New-Item -ItemType File -Force -Path $lockPath | Out-Null

try {
  Write-Step "Starting Final V1 daily publish in $RepoRoot"

  $branchToUse = $Branch
  if (-not $branchToUse) {
    $branchToUse = (& git branch --show-current).Trim()
  }
  if (-not $branchToUse) {
    throw "Could not determine git branch."
  }

  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $scoredBoardUrl = "$BoardUrl&t=$timestamp"

  Invoke-Logged "python" @(
    "scripts/export-top-player-200-current-slate-scores.py",
    "--board-url",
    $scoredBoardUrl,
    "--out",
    "exports/top-player-200-sample-current-slate-scores.json"
  )

  Invoke-Logged "npx.cmd" @(
    "tsx",
    "--env-file=.env.local",
    "--env-file=.env",
    "scripts/export-final-player-prop-model-v1.ts"
  )

  $scoreArtifact = Get-Content -Raw -Path "exports/top-player-200-sample-current-slate-scores.json" | ConvertFrom-Json
  $dateEt = [string]$scoreArtifact.dateEt
  if (-not $dateEt) {
    throw "Current score artifact did not include dateEt."
  }

  $artifactBase = "exports/final-player-prop-model-v1/final-player-prop-model-v1-$dateEt"
  $artifactFiles = @(
    "exports/top-player-200-sample-current-slate-scores.json",
    "$artifactBase.json",
    "$artifactBase.md",
    "$artifactBase.csv",
    "$artifactBase.board.csv"
  )

  foreach ($file in $artifactFiles) {
    if (-not (Test-Path $file)) {
      throw "Expected artifact was not generated: $file"
    }
  }

  if (-not $SkipGit) {
    $gitAddArgs = @("add", "--") + $artifactFiles
    Invoke-Logged "git" $gitAddArgs
    & git diff --cached --quiet
    $hasStagedChanges = $LASTEXITCODE -ne 0

    if ($hasStagedChanges) {
      Invoke-Logged "git" @("commit", "-m", "Update Final V1 slate artifact $dateEt")
    } else {
      Write-Step "No Final V1 artifact changes to commit."
    }

    $commitSha = (& git rev-parse HEAD).Trim()

    if (-not $NoPush) {
      Invoke-Logged "git" @("push", "-u", "origin", $branchToUse)
    }

    if (-not $SkipVercel -and -not $NoPush) {
      $previewUrl = Wait-ForPreviewDeployment -CommitSha $commitSha
      Invoke-Logged "vercel.cmd" @("promote", $previewUrl, "--yes")
      Write-Step "Promoted $previewUrl to production."
    }
  }

  Write-Step "Final V1 daily publish complete for $dateEt."
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $lockPath
}
