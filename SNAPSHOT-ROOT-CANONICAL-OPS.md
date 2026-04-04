# Snapshot Root Canonical Ops

Release tag: `snapshot-root-canonical-2026-04-04`

## Canonical flow
- Production dashboard route: `/`
- Retired compatibility route: `/new` -> `308` redirect to `/`
- Live board implementation: `app/_snapshot-page.tsx` + `components/snapshot/NewDashboard.tsx`

## Deployment notes
- Treat pushes to `main` as production-bound changes.
- After a production deploy, verify:
  - `https://ultops.com/` returns the redesigned Snapshot dashboard
  - `https://ultops.com/new` returns `308 Permanent Redirect` to `/`
  - the root board still passes the existing deploy smoke flow (`npm run deploy:smoke`) when relevant
- If workflow or runtime secrets need a base URL, prefer the canonical domain `https://ultops.com` unless a workflow explicitly needs a different alias.

## Branch protection note
- GitHub branch protection is not stored in this repo.
- Keep any external branch protection rules aligned with the canonical production flow:
  - protect `main`
  - require the checks your team treats as release-gating
  - use `snapshot-root-canonical-2026-04-04` as the rollout marker for the canonical-root cutover

## Release note summary
- The redesigned Snapshot dashboard is now the canonical root experience.
- Legacy route and legacy dashboard code are retired.
- Remaining work is normal polish and feature iteration, not migration.
