import type { SnapshotUniversalSystemSummary } from "@/lib/types/snapshot";

export const UNIVERSAL_SYSTEM_SUMMARY_VERSION =
  "2026-04-23-all-market-holdout50-overlay-v1";

export const UNIVERSAL_SYSTEM_SUMMARY: SnapshotUniversalSystemSummary = {
  label: "Live Quality Board Honest Holdout",
  honest14dRawAccuracy: 69.41,
  honest14dBlendedAccuracy: 69.49,
  honest14dCoveragePct: 96.58,
  honest30dRawAccuracy: 69.67,
  honest30dBlendedAccuracy: 69.71,
  honest30dCoveragePct: 96.81,
  latestFoldRawAccuracy: 69.29,
  latestFoldBlendedAccuracy: 69.34,
  latestFoldCoveragePct: 96.53,
  note:
    "Board-faithful live scoreboard using resolved raw accuracy, player overrides, universal fallback, the active v21 stale-manifest prune pack, the promoted loose priority player-market replacement pack on headroom markets, the promoted all-market holdout50 priority overlay, residual drag memory, the Nickeil combo-over revival patch, the strict stale override cleanup bundle drawn from the full-season audit, the Klay-derived THREES over-recovery pack for seven targeted shooter cells, the Donte-derived strict stale-cell prune expansion across stable negative player-market pockets, the Donovan-derived leftover-market completion pack across four targeted uncovered sinkholes, the Donovan-led player-override projection-correction pack across eight targeted stale override cells, the Fox raw-recovery bundle that restores AST to liveRaw, RA to projection, and PA to UNDER, the promoted Donte DiVincenzo depth-3 split router, and the Donovan Clingan exact line-map bundle that upgrades PA, PRA, and RA while releasing the stale Donovan PR baseline veto from residual drag memory so the stronger Donovan PR manifest can take over. This summary centers the honest recent read: 69.41 raw over the April 1, 2026 through April 14, 2026 holdout, 69.67 raw over the March 16, 2026 through April 14, 2026 holdout, and 69.29 raw on the latest walk-forward fold from April 3, 2026 through April 14, 2026. The full-history honest walk-forward replay for this promoted stack is 72.67 raw and 72.64 blended.",
};
