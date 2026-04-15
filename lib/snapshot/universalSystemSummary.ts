import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-15-resolved-raw-v22-player-local-manifest-v15-five-player-61-no-down-repair";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board",
  replayRawAccuracy: 60.1,
  replayQualifiedAccuracy: null,
  replayBlendedAccuracy: 59.36,
  replayCoveragePct: 74.2,
  walkForwardRawAccuracy: 60.62,
  walkForwardQualifiedAccuracy: null,
  walkForwardBlendedAccuracy: 60.2,
  walkForwardCoveragePct: 74.32,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, and the active player-local recovery manifest. This version keeps the Nae'Qwan normalized-name fix, keeps Cole Anthony plus Dejounte Murray as dedicated live overrides, and upgrades the Nickeil Alexander-Walker, Desmond Bane, Moses Moody, John Konchar, and Lauri Markkanen manifest entries to the repaired 61-plus no-down beam mix. Older universal-only 51.x% walk-forward numbers remain research-only and are not the official board score.",
};
