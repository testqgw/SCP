import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-16-priority-headroom-player-market-replace-v1-honest-holdout";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board Honest Holdout",
  honest14dRawAccuracy: 57.08,
  honest14dBlendedAccuracy: 57.07,
  honest14dCoveragePct: 96.36,
  honest30dRawAccuracy: 58.95,
  honest30dBlendedAccuracy: 58.86,
  honest30dCoveragePct: 96.74,
  latestFoldRawAccuracy: 58.27,
  latestFoldBlendedAccuracy: 58.21,
  latestFoldCoveragePct: 96.07,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, the active v20 player-local recovery manifest, and the promoted priority player-market replacement pack on headroom markets. This summary now centers the honest recent read instead of same-window replay: 57.08 raw over the April 1, 2026 through April 14, 2026 holdout, 58.95 raw over the March 16, 2026 through April 14, 2026 holdout, and 58.27 raw on the latest walk-forward fold from April 3, 2026 through April 14, 2026. The older 67.61 replay raw and 66.04 full-history walk-forward numbers are still valid research context, but they are intentionally not the lead accuracy claim here.",
};
