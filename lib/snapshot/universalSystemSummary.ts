import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-16-donte-strict-stale-cell-prune-honest-holdout";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board Honest Holdout",
  honest14dRawAccuracy: 59.82,
  honest14dBlendedAccuracy: 59.98,
  honest14dCoveragePct: 94.62,
  honest30dRawAccuracy: 61.16,
  honest30dBlendedAccuracy: 61.23,
  honest30dCoveragePct: 95.06,
  latestFoldRawAccuracy: 59.57,
  latestFoldBlendedAccuracy: 59.7,
  latestFoldCoveragePct: 94.54,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, the active v21 stale-manifest prune pack, the promoted priority player-market replacement pack on headroom markets, residual drag memory, the Nickeil combo-over revival patch, the strict stale override cleanup bundle drawn from the full-season audit, the Klay-derived THREES over-recovery pack for seven targeted shooter cells, and the Donte-derived strict stale-cell prune expansion across stable negative player-market pockets. This summary centers the honest recent read: 59.82 raw over the April 1, 2026 through April 14, 2026 holdout, 61.16 raw over the March 16, 2026 through April 14, 2026 holdout, and 59.57 raw on the latest walk-forward fold from April 3, 2026 through April 14, 2026. The full-history honest walk-forward replay for this promoted stack is 66.47 raw and 66.41 blended.",
};
