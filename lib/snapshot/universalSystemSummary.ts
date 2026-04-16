import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-16-leftover-completion-honest-holdout";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board Honest Holdout",
  honest14dRawAccuracy: 59.85,
  honest14dBlendedAccuracy: 60.02,
  honest14dCoveragePct: 94.72,
  honest30dRawAccuracy: 61.17,
  honest30dBlendedAccuracy: 61.24,
  honest30dCoveragePct: 95.17,
  latestFoldRawAccuracy: 59.61,
  latestFoldBlendedAccuracy: 59.74,
  latestFoldCoveragePct: 94.63,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, the active v21 stale-manifest prune pack, the promoted priority player-market replacement pack on headroom markets, residual drag memory, the Nickeil combo-over revival patch, the strict stale override cleanup bundle drawn from the full-season audit, the Klay-derived THREES over-recovery pack for seven targeted shooter cells, the Donte-derived strict stale-cell prune expansion across stable negative player-market pockets, and the Donovan-derived leftover-market completion pack across four targeted uncovered sinkholes. This summary centers the honest recent read: 59.85 raw over the April 1, 2026 through April 14, 2026 holdout, 61.17 raw over the March 16, 2026 through April 14, 2026 holdout, and 59.61 raw on the latest walk-forward fold from April 3, 2026 through April 14, 2026. The full-history honest walk-forward replay for this promoted stack is 66.48 raw and 66.42 blended.",
};
