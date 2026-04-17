# NBA Player Prop Snapshot

Private NBA betting intelligence dashboard with:
- snapshot edge board (board date uses Pacific time)
- last-5 and season over/under hit rates
- bounce-back signal
- opponent allowance vs position+usage archetype
- ranked edge scoring (A/B/C confidence)
- 5-minute delta refresh + daily full refresh + retention cleanup

## Current Product State
- The redesigned Snapshot dashboard is the canonical root experience at `/`.
- `/new` is retired as a product surface and now returns a permanent `308`
  redirect to `/`.
- Legacy `SnapshotDashboard` code has been removed. The live board now runs
  through `app/_snapshot-page.tsx` and `components/snapshot/NewDashboard.tsx`.
- Release marker: `snapshot-root-canonical-2026-04-04`
- Operational follow-up lives in `SNAPSHOT-ROOT-CANONICAL-OPS.md`.

## Stack
- Next.js 14 App Router
- Prisma + PostgreSQL
- SportsDataIO ingestion
- Vercel cron jobs

## Setup
1. Copy `.env.example` to `.env.local` and fill in values.
2. Generate Prisma client and run migration:
```bash
npx prisma generate
npx prisma db push --accept-data-loss
```
3. Start local dev server:
```bash
npm run dev
```

## Board Date Contract
- The snapshot board date is defined by `getSnapshotBoardDateString()` in `lib/snapshot/time.ts`.
- `getSnapshotBoardDateString()` uses `SNAPSHOT_BOARD_TIMEZONE = "America/Los_Angeles"`.
- Board-date defaults in the root page and snapshot APIs flow through that helper.
- Upstream game and log dates elsewhere in the app remain ET because the schedule and stat feeds are normalized that way.

## Live Routes
- `GET /`
- `GET /api/health`
- `GET /api/snapshot/board`
- `GET /api/snapshot/player`
- `GET /api/snapshot/player/logs`
- `GET /api/snapshot/player/backtest`
- `POST /api/refresh`
- `POST /api/internal/refresh/full` (cron protected)
- `POST /api/internal/refresh/delta` (cron protected)
- `GET /api/internal/runtime-contract`
- `GET /api/internal/debug-props`

## Retired Routes
- `/unlock`
- `/api/auth/unlock`
- `/api/auth/lock`
- `/api/snapshot/today`
- `/api/snapshot/filters`
- `/api/internal/cleanup/lines`

## Manual Refresh Commands
```bash
npm run refresh:full
npm run refresh:delta
```

## Notes
- Vercel cron calls must include `CRON_SECRET` (`Authorization: Bearer <secret>`).
- Low-confidence rows (`<58`) are stored but hidden by default in the snapshot board payload.
- Quality gate blocks snapshot publishing when sportsbook/line/stat integrity checks fail.
