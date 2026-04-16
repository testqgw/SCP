import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-16-stale-manifest-prune-v21-honest-holdout";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board Honest Holdout",
  honest14dRawAccuracy: 59.3,
  honest14dBlendedAccuracy: 59.4,
  honest14dCoveragePct: 94.53,
  honest30dRawAccuracy: 60.67,
  honest30dBlendedAccuracy: 60.7,
  honest30dCoveragePct: 94.97,
  latestFoldRawAccuracy: 59.03,
  latestFoldBlendedAccuracy: 59.08,
  latestFoldCoveragePct: 94.49,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, the active v21 stale-manifest prune pack, the promoted priority player-market replacement pack on headroom markets, and residual drag memory. This summary centers the honest recent read: 59.30 raw over the April 1, 2026 through April 14, 2026 holdout, 60.67 raw over the March 16, 2026 through April 14, 2026 holdout, and 59.03 raw on the latest walk-forward fold from April 3, 2026 through April 14, 2026. The full-history honest walk-forward replay for this promoted stack is 66.14 raw and 66.07 blended.",
};
