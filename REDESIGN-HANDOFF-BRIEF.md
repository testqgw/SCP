# Ultops Redesign Handoff Brief

> **Status: `/new` validated live - redesigned dashboard rendering in production**
> **Current state: `/` and `/new` both point at the redesigned `NewDashboard` implementation**
> **Next decision: keep `/new` as a staging alias or retire it now that the root route is mirrored**

This in-repo brief supersedes the older workspace-level redesign notes that were
written during the product-completion phase.

## Confirmed state

- `https://ultops.com/new` is live and renders the completed redesigned dashboard.
- The featured pick card, product nav, density upgrades, and tab switching are live.
- The earlier "loading shell" confusion came from the global `app/loading.tsx`
  streaming fallback, not a broken `/new` route.
- `/` now uses the same route implementation as `/new`, so the redesign is no
  longer isolated to a staging-only path.

## What changed

- The redesigned board is the active experience, not a local-only prototype.
- Root and staging routes share one implementation, which removes route drift.
- The loading state has been reframed to read like an intentional live-board
  stream instead of a suspicious blank shell.

## Remaining product decisions

- Decide whether `/new` remains useful as a staging alias or should be retired.
- Keep future work inside product polish and data quality, not route wiring.
- Only claim live completion after verifying the rendered browser state, not
  just raw HTML or server-stream fallbacks.

## Key files

| File | Role |
|------|------|
| `app/_snapshot-page.tsx` | Shared server-rendered board entry used by `/` and `/new` |
| `app/page.tsx` | Root route re-export |
| `app/new/page.tsx` | Staging route re-export |
| `app/loading.tsx` | Global streaming/loading experience |
| `components/snapshot/NewDashboard.tsx` | Main redesigned product surface |

## Guardrails

- Stay out of routing/debugging loops unless production verification proves a
  real regression.
- Keep live vs derived vs placeholder labeling honest.
- Do not re-theme from scratch; refine the current product layer.
- Prove changes with browser screenshots and route-level verification.
