import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-16-nickeil-bundle-plus-strict-stale-prune-honest-holdout";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board Honest Holdout",
  honest14dRawAccuracy: 59.51,
  honest14dBlendedAccuracy: 59.66,
  honest14dCoveragePct: 94.42,
  honest30dRawAccuracy: 60.93,
  honest30dBlendedAccuracy: 60.99,
  honest30dCoveragePct: 94.88,
  latestFoldRawAccuracy: 59.24,
  latestFoldBlendedAccuracy: 59.35,
  latestFoldCoveragePct: 94.37,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, the active v21 stale-manifest prune pack, the promoted priority player-market replacement pack on headroom markets, residual drag memory, the Nickeil combo-over revival patch, and a strict stale override cleanup bundle drawn from the full-season audit. This summary centers the honest recent read: 59.51 raw over the April 1, 2026 through April 14, 2026 holdout, 60.93 raw over the March 16, 2026 through April 14, 2026 holdout, and 59.24 raw on the latest walk-forward fold from April 3, 2026 through April 14, 2026. The full-history honest walk-forward replay for this promoted stack is 66.28 raw and 66.22 blended.",
};
