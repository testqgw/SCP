# Ultops Redesign - Execution Prompt

Read `REDESIGN-HANDOFF-BRIEF.md` first.

## State update

- `/new` is confirmed live and rendering the completed redesigned dashboard.
- The tabbed product layer is live and switching correctly.
- The misleading shell view came from `app/loading.tsx`, not from a broken
  `/new` route.
- `/` and `/new` now share the same redesigned board implementation.

## Next task

1. Keep the loading experience honest and branded when streaming occurs.
2. Decide whether `/new` should remain as a staging alias or be retired.
3. Keep further work inside product polish, data provenance, and verification.

## Do not do

- Do not restart routing or deployment debugging unless live verification shows
  a regression.
- Do not claim completion from raw HTML alone.
- Do not invent market data or unlabeled placeholders.

## Required proof

When done, provide only:

1. changed files
2. commit SHA
3. screenshot of the rendered state you changed
4. confirmation whether `/` still differs from `/new` or is mirrored
5. anything still intentionally stubbed
