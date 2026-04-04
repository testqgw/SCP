# Ultops Redesign - Final State

Read `REDESIGN-HANDOFF-BRIEF.md` first.

## State update

- The redesign migration is complete.
- `/` is the canonical production dashboard route.
- `/new` has been retired as a product surface and now redirects to `/`.
- `SnapshotDashboard` has been removed; `NewDashboard` owns the live board.
- The misleading shell view came from `app/loading.tsx`, not from a broken
  board route.

## Next task

1. Work in normal product iteration mode: polish, data provenance, and new features.
2. Treat the root dashboard as the single source of truth.
3. Verify real browser behavior whenever route-level or product-layer changes ship.

## Do not do

- Do not restart redesign migration work unless live verification shows a
  regression.
- Do not reintroduce `/new` as a second live dashboard surface without a clear need.
- Do not claim completion from raw HTML alone.
- Do not invent market data or unlabeled placeholders.

## Required proof

When done, provide only:

1. changed files
2. commit SHA
3. screenshot of the rendered state you changed
4. confirmation whether route behavior changed or remained canonical at `/`
5. anything still intentionally stubbed
