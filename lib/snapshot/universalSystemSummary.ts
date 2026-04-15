import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-15-resolved-raw-v23-player-local-manifest-v16-delta-pack";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board",
  replayRawAccuracy: 59.85,
  replayQualifiedAccuracy: null,
  replayBlendedAccuracy: 59.52,
  replayCoveragePct: 77.42,
  walkForwardRawAccuracy: 59.18,
  walkForwardQualifiedAccuracy: null,
  walkForwardBlendedAccuracy: 58.77,
  walkForwardCoveragePct: 77.27,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, and the active player-local recovery manifest. This version keeps the Nae'Qwan normalized-name fix, keeps Cole Anthony plus Dejounte Murray as dedicated live overrides, retains the repaired Nickeil Alexander-Walker, Desmond Bane, Moses Moody, John Konchar, and Lauri Markkanen beam mix, and adds the target-miss delta pack for Derik Queen, Pelle Larsson, Davion Mitchell, Cooper Flagg, and Reed Sheppard. Older universal-only 51.x% walk-forward numbers remain research-only and are not the official board score.",
};
