-- ESPN fallback feed: remember which ESPN athlete/event each NBA-keyed row corresponds to.
-- Nullable and additive. Apply before deploying code generated from this schema.
ALTER TABLE "players" ADD COLUMN "espnId" TEXT;
ALTER TABLE "games" ADD COLUMN "espnId" TEXT;

CREATE UNIQUE INDEX "players_espnId_key" ON "players"("espnId");
CREATE UNIQUE INDEX "games_espnId_key" ON "games"("espnId");
