import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-15-resolved-raw-v25-player-local-manifest-v20-fullboard-maxnet-minrows-1";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board",
  replayRawAccuracy: 64.94,
  replayQualifiedAccuracy: null,
  replayBlendedAccuracy: 64.8,
  replayCoveragePct: 96.97,
  walkForwardRawAccuracy: 63.3,
  walkForwardQualifiedAccuracy: null,
  walkForwardBlendedAccuracy: 63.18,
  walkForwardCoveragePct: 96.86,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, and the active player-local recovery manifest. This version preserves the earlier repaired five-player beam mix and delta-pack winners, then promotes a full-board max-net player-local manifest through v20: a broad full-history expansion, per-player max-net candidate reselection, and a low-sample positive tail add-on. Verified metrics on the current through-2026-04-14 rows file are 64.94 replay raw, 63.30 walk-forward raw, 55.03 forward 14d raw, and 56.92 forward 30d raw. A follow-up audit against the v20 control found no remaining positive residual player-local additions, so this exhausts the current player-local manifest headroom.",
};
