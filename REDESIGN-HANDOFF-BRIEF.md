# Ultops Redesign Handoff Brief

> **Status: redesign migration complete**
> **Canonical route: `/` renders the redesigned Snapshot dashboard in production**
> **Retired route: `/new` now returns a permanent `308` redirect to `/`**

This in-repo brief supersedes the older workspace-level redesign notes that were
written during the product-completion and alias-soak phases.

## Confirmed state

- `https://ultops.com/` is the live canonical dashboard route.
- `https://ultops.com/new` now redirects permanently to `https://ultops.com/`.
- The featured pick card, product nav, density upgrades, and tab switching are live.
- The earlier "loading shell" confusion came from the global `app/loading.tsx`
  streaming fallback, not a broken board route.
- Legacy `SnapshotDashboard` code has been removed from the app.

## What changed

- The redesigned board is the active experience, not a local-only prototype.
- Root is now the only live dashboard surface.
- `/new` remains only as a compatibility redirect, which removes duplicate-route drift.
- The loading state has been reframed to read like an intentional live-board
  stream instead of a suspicious blank shell.
- Legacy dashboard code and stale Sonar references tied to it have been removed.

## Remaining work

- Keep future work inside product polish, data quality, and feature iteration.
- Treat the redesign migration as closed unless a real regression reopens it.
- Only claim live completion after verifying the rendered browser state, not
  just raw HTML or server-stream fallbacks.

## Key files

| File | Role |
|------|------|
| `app/_snapshot-page.tsx` | Shared server-rendered board entry for the live root dashboard |
| `app/page.tsx` | Canonical root route |
| `next.config.js` | Permanent redirect from `/new` to `/` |
| `app/loading.tsx` | Global streaming/loading experience |
| `components/snapshot/NewDashboard.tsx` | Main redesigned product surface |

## Guardrails

- Stay out of migration/routing loops unless production verification proves a
  real regression.
- Keep live vs derived vs placeholder labeling honest.
- Do not re-theme from scratch; refine the current product layer.
- Prove changes with browser screenshots and route-level verification.
