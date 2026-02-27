# NBA Player Prop Snapshot

Private NBA betting intelligence dashboard with:
- today-only edge board (US Eastern date boundary)
- last-5 and season over/under hit rates
- bounce-back signal
- opponent allowance vs position+usage archetype
- ranked edge scoring (A/B/C confidence)
- 5-minute delta refresh + daily full refresh + retention cleanup

## Stack
- Next.js 14 App Router
- Prisma + PostgreSQL
- SportsDataIO ingestion
- Vercel cron jobs
- passcode gate using signed httpOnly cookie

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
4. Open `http://localhost:3000/unlock` and enter your passcode.

## Key Endpoints
- `GET /api/snapshot/today`
- `GET /api/snapshot/filters`
- `GET /api/snapshot/player/:playerId`
- `POST /api/internal/refresh/full` (cron protected)
- `POST /api/internal/refresh/delta` (cron protected)
- `POST /api/internal/cleanup/lines` (cron protected)
- `POST /api/auth/unlock`
- `POST /api/auth/lock`
- `GET /api/health`

## Manual Refresh Commands
```bash
npm run refresh:full
npm run refresh:delta
```

## Notes
- Vercel cron calls must include `CRON_SECRET` (`Authorization: Bearer <secret>`).
- Snapshot API routes are gated by the session cookie set via `/api/auth/unlock`.
- Low-confidence rows (`<58`) are stored but hidden by default in `GET /api/snapshot/today`.
- Quality gate blocks snapshot publishing when sportsbook/line/stat integrity checks fail.
