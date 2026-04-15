import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-15-resolved-raw-v24-player-local-manifest-v17-raw-first-minrows-200";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board",
  replayRawAccuracy: 62.0,
  replayQualifiedAccuracy: null,
  replayBlendedAccuracy: 61.73,
  replayCoveragePct: 87.71,
  walkForwardRawAccuracy: 61.06,
  walkForwardQualifiedAccuracy: null,
  walkForwardBlendedAccuracy: 60.77,
  walkForwardCoveragePct: 87.59,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, and the active player-local recovery manifest. This version keeps the Nae'Qwan normalized-name fix, keeps Cole Anthony plus Dejounte Murray as dedicated live overrides, retains the repaired Nickeil Alexander-Walker, Desmond Bane, Moses Moody, John Konchar, and Lauri Markkanen beam mix, keeps the Derik Queen, Pelle Larsson, Davion Mitchell, Cooper Flagg, and Reed Sheppard delta pack, and adds a raw-first expansion pack of 78 higher-sample player-local recoveries with positive full-board net wins and nonnegative 14d/30d net support. Older universal-only 51.x% walk-forward numbers remain research-only and are not the official board score.",
};
