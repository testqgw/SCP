import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-15-priority-headroom-player-market-replace-v1-same-window";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board",
  replayRawAccuracy: 67.61,
  replayQualifiedAccuracy: null,
  replayBlendedAccuracy: 67.48,
  replayCoveragePct: 97.11,
  walkForwardRawAccuracy: 66.04,
  walkForwardQualifiedAccuracy: null,
  walkForwardBlendedAccuracy: 65.93,
  walkForwardCoveragePct: 97,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, the active v20 player-local recovery manifest, and a new priority player-market replacement pack on headroom markets. The promoted priority file is a same-window 2025-10-23 through 2026-04-14 player-market challenger filtered to PTS, REB, PRA, PR, and RA with 24+ samples, 60+ holdout accuracy, and 4-point edges over both projection and final baselines. Verified metrics on the current through-2026-04-14 rows file are 67.61 replay raw, 66.04 walk-forward raw, 58.50 forward 14d raw, and 60.09 forward 30d raw.",
};
