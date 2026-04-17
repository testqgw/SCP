import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-16-fox-raw-recovery-bundle-honest-holdout";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board Honest Holdout",
  honest14dRawAccuracy: 59.98,
  honest14dBlendedAccuracy: 60.14,
  honest14dCoveragePct: 94.79,
  honest30dRawAccuracy: 61.29,
  honest30dBlendedAccuracy: 61.35,
  honest30dCoveragePct: 95.24,
  latestFoldRawAccuracy: 59.73,
  latestFoldBlendedAccuracy: 59.85,
  latestFoldCoveragePct: 94.71,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, the active v21 stale-manifest prune pack, the promoted priority player-market replacement pack on headroom markets, residual drag memory, the Nickeil combo-over revival patch, the strict stale override cleanup bundle drawn from the full-season audit, the Klay-derived THREES over-recovery pack for seven targeted shooter cells, the Donte-derived strict stale-cell prune expansion across stable negative player-market pockets, the Donovan-derived leftover-market completion pack across four targeted uncovered sinkholes, the Donovan-led player-override projection-correction pack across eight targeted stale override cells, a safe Donte DiVincenzo PRA route to final, and the Fox raw-recovery bundle that restores AST to liveRaw, RA to projection, and PA to UNDER. This summary centers the honest recent read: 59.98 raw over the April 1, 2026 through April 14, 2026 holdout, 61.29 raw over the March 16, 2026 through April 14, 2026 holdout, and 59.73 raw on the latest walk-forward fold from April 3, 2026 through April 14, 2026. The full-history honest walk-forward replay for this promoted stack is 66.53 raw and 66.46 blended.",
};
