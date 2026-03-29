import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION = "2026-03-29-resolved-raw-v4-player-local-manifest-v2-promoted";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board",
  replayRawAccuracy: 56.26,
  replayQualifiedAccuracy: null,
  replayBlendedAccuracy: 56.05,
  replayCoveragePct: 76.33,
  walkForwardRawAccuracy: 57.35,
  walkForwardQualifiedAccuracy: null,
  walkForwardBlendedAccuracy: 57.2,
  walkForwardCoveragePct: 76.5,
  note:
    "Board-faithful full-board scoreboard using resolved raw accuracy: player override when present, else universal raw, else baseline, with the promoted PRA raw feature artifact and the merged player-local recovery manifest v2 active. Older universal-only 51.x% walk-forward numbers remain research-only and are not the official board score.",
};
