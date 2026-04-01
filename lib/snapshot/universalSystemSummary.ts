import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION = "2026-04-01-resolved-raw-v21-player-local-manifest-v13-plus-ja-plus-nae-plus-cole-plus-dejounte";

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
    "Board-faithful full-board scoreboard using resolved raw accuracy: player override when present, else universal raw, else baseline, with the promoted PRA raw feature artifact, the Joel/Javon/Ja/Nae'Qwan/Cole/Dejounte/Devin/Aaron/Sabonis/Taurean/Tristan/Marcus/Kyle dedicated overrides, and the additive player-local recovery manifest v13 active. This version keeps the Nae'Qwan normalized-name fix, keeps Cole Anthony plus Dejounte Murray as dedicated live overrides, and promotes the generalized Cole/Dej guard-role family lift after a clean full, 14d, and 30d live-stack replay. Older universal-only 51.x% walk-forward numbers remain research-only and are not the official board score.",
};
