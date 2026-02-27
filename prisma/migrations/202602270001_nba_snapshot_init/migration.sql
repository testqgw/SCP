-- Create enums
CREATE TYPE "Market" AS ENUM (
  'PTS',
  'REB',
  'AST',
  'THREES',
  'PRA',
  'PA',
  'PR',
  'RA',
  'STL',
  'BLK',
  'TOV',
  'DOUBLE_DOUBLE',
  'TRIPLE_DOUBLE'
);

CREATE TYPE "Book" AS ENUM ('DK', 'FD', 'MGM');
CREATE TYPE "Side" AS ENUM ('OVER', 'UNDER');
CREATE TYPE "Confidence" AS ENUM ('A', 'B', 'C', 'LOW');
CREATE TYPE "RefreshType" AS ENUM ('FULL', 'DELTA', 'CLEANUP');
CREATE TYPE "RefreshStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- Create tables
CREATE TABLE "teams" (
  "id" TEXT NOT NULL,
  "externalId" TEXT,
  "abbreviation" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "city" TEXT,
  "conference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "players" (
  "id" TEXT NOT NULL,
  "externalId" TEXT,
  "fullName" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "position" TEXT,
  "usageRate" DOUBLE PRECISION,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "teamId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "games" (
  "id" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "gameDateEt" TEXT NOT NULL,
  "season" TEXT,
  "status" TEXT,
  "commenceTimeUtc" TIMESTAMP(3),
  "homeTeamId" TEXT NOT NULL,
  "awayTeamId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "player_game_logs" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "externalGameId" TEXT NOT NULL,
  "gameDateEt" TEXT NOT NULL,
  "teamId" TEXT,
  "opponentTeamId" TEXT,
  "minutes" DOUBLE PRECISION,
  "points" DOUBLE PRECISION,
  "rebounds" DOUBLE PRECISION,
  "assists" DOUBLE PRECISION,
  "threes" DOUBLE PRECISION,
  "steals" DOUBLE PRECISION,
  "blocks" DOUBLE PRECISION,
  "turnovers" DOUBLE PRECISION,
  "pace" DOUBLE PRECISION,
  "total" DOUBLE PRECISION,
  "isHome" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "player_game_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sportsbooks" (
  "id" TEXT NOT NULL,
  "code" "Book" NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sportsbooks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prop_line_snapshots" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "sportsbookId" TEXT NOT NULL,
  "market" "Market" NOT NULL,
  "rawMarketName" TEXT NOT NULL,
  "line" DOUBLE PRECISION NOT NULL,
  "overPrice" INTEGER,
  "underPrice" INTEGER,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prop_line_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refresh_runs" (
  "id" TEXT NOT NULL,
  "type" "RefreshType" NOT NULL,
  "status" "RefreshStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "totalGames" INTEGER NOT NULL DEFAULT 0,
  "totalPlayers" INTEGER NOT NULL DEFAULT 0,
  "totalLines" INTEGER NOT NULL DEFAULT 0,
  "totalEdges" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "notes" JSONB,
  CONSTRAINT "refresh_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "player_market_metrics" (
  "id" TEXT NOT NULL,
  "refreshRunId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "sportsbookId" TEXT NOT NULL,
  "market" "Market" NOT NULL,
  "line" DOUBLE PRECISION NOT NULL,
  "last5OverRate" DOUBLE PRECISION NOT NULL,
  "last5UnderRate" DOUBLE PRECISION NOT NULL,
  "seasonOverRate" DOUBLE PRECISION NOT NULL,
  "seasonUnderRate" DOUBLE PRECISION NOT NULL,
  "bounceBackFlag" BOOLEAN NOT NULL,
  "bounceBackScore" DOUBLE PRECISION NOT NULL,
  "archetypeKey" TEXT NOT NULL,
  "opponentAllowanceDelta" DOUBLE PRECISION NOT NULL,
  "lineValueScore" DOUBLE PRECISION NOT NULL,
  "minutesTrendScore" DOUBLE PRECISION NOT NULL,
  "paceTotalScore" DOUBLE PRECISION NOT NULL,
  "injuryContextScore" DOUBLE PRECISION NOT NULL,
  "recentFormScore" DOUBLE PRECISION NOT NULL,
  "seasonVsLineScore" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "player_market_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "edge_snapshots" (
  "id" TEXT NOT NULL,
  "refreshRunId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "sportsbookId" TEXT NOT NULL,
  "market" "Market" NOT NULL,
  "line" DOUBLE PRECISION NOT NULL,
  "overPrice" INTEGER,
  "underPrice" INTEGER,
  "recommendedSide" "Side" NOT NULL,
  "overEdgeScore" DOUBLE PRECISION NOT NULL,
  "underEdgeScore" DOUBLE PRECISION NOT NULL,
  "edgeScore" DOUBLE PRECISION NOT NULL,
  "confidence" "Confidence" NOT NULL,
  "last5OverRate" DOUBLE PRECISION NOT NULL,
  "bounceBackFlag" BOOLEAN NOT NULL,
  "opponentAllowanceDelta" DOUBLE PRECISION NOT NULL,
  "archetypeKey" TEXT NOT NULL,
  "lineMove24h" DOUBLE PRECISION NOT NULL,
  "componentScores" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "edge_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "system_settings" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- Unique constraints
CREATE UNIQUE INDEX "teams_externalId_key" ON "teams"("externalId");
CREATE UNIQUE INDEX "teams_abbreviation_key" ON "teams"("abbreviation");
CREATE UNIQUE INDEX "players_externalId_key" ON "players"("externalId");
CREATE UNIQUE INDEX "games_externalId_key" ON "games"("externalId");
CREATE UNIQUE INDEX "sportsbooks_code_key" ON "sportsbooks"("code");
CREATE UNIQUE INDEX "player_game_logs_playerId_externalGameId_key"
  ON "player_game_logs"("playerId", "externalGameId");
CREATE UNIQUE INDEX "player_market_metrics_refreshRunId_playerId_gameId_sportsbookId_market_key"
  ON "player_market_metrics"("refreshRunId", "playerId", "gameId", "sportsbookId", "market");
CREATE UNIQUE INDEX "edge_snapshots_refreshRunId_playerId_gameId_sportsbookId_market_key"
  ON "edge_snapshots"("refreshRunId", "playerId", "gameId", "sportsbookId", "market");

-- Indexes
CREATE INDEX "players_teamId_idx" ON "players"("teamId");
CREATE INDEX "games_gameDateEt_idx" ON "games"("gameDateEt");
CREATE INDEX "games_homeTeamId_idx" ON "games"("homeTeamId");
CREATE INDEX "games_awayTeamId_idx" ON "games"("awayTeamId");
CREATE INDEX "player_game_logs_gameDateEt_idx" ON "player_game_logs"("gameDateEt");
CREATE INDEX "player_game_logs_playerId_gameDateEt_idx" ON "player_game_logs"("playerId", "gameDateEt");
CREATE INDEX "player_game_logs_opponentTeamId_gameDateEt_idx" ON "player_game_logs"("opponentTeamId", "gameDateEt");
CREATE INDEX "prop_line_snapshots_gameId_sportsbookId_market_idx" ON "prop_line_snapshots"("gameId", "sportsbookId", "market");
CREATE INDEX "prop_line_snapshots_playerId_market_idx" ON "prop_line_snapshots"("playerId", "market");
CREATE INDEX "prop_line_snapshots_capturedAt_idx" ON "prop_line_snapshots"("capturedAt");
CREATE INDEX "player_market_metrics_playerId_market_idx" ON "player_market_metrics"("playerId", "market");
CREATE INDEX "player_market_metrics_sportsbookId_market_gameId_idx" ON "player_market_metrics"("sportsbookId", "market", "gameId");
CREATE INDEX "edge_snapshots_playerId_market_idx" ON "edge_snapshots"("playerId", "market");
CREATE INDEX "edge_snapshots_sportsbookId_market_gameId_idx" ON "edge_snapshots"("sportsbookId", "market", "gameId");
CREATE INDEX "refresh_runs_startedAt_idx" ON "refresh_runs"("startedAt");

-- Foreign keys
ALTER TABLE "players"
  ADD CONSTRAINT "players_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "games"
  ADD CONSTRAINT "games_homeTeamId_fkey"
  FOREIGN KEY ("homeTeamId") REFERENCES "teams"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "games"
  ADD CONSTRAINT "games_awayTeamId_fkey"
  FOREIGN KEY ("awayTeamId") REFERENCES "teams"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "player_game_logs"
  ADD CONSTRAINT "player_game_logs_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "players"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "player_game_logs"
  ADD CONSTRAINT "player_game_logs_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "player_game_logs"
  ADD CONSTRAINT "player_game_logs_opponentTeamId_fkey"
  FOREIGN KEY ("opponentTeamId") REFERENCES "teams"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "prop_line_snapshots"
  ADD CONSTRAINT "prop_line_snapshots_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES "games"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prop_line_snapshots"
  ADD CONSTRAINT "prop_line_snapshots_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "players"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prop_line_snapshots"
  ADD CONSTRAINT "prop_line_snapshots_sportsbookId_fkey"
  FOREIGN KEY ("sportsbookId") REFERENCES "sportsbooks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "player_market_metrics"
  ADD CONSTRAINT "player_market_metrics_refreshRunId_fkey"
  FOREIGN KEY ("refreshRunId") REFERENCES "refresh_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "player_market_metrics"
  ADD CONSTRAINT "player_market_metrics_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "players"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "player_market_metrics"
  ADD CONSTRAINT "player_market_metrics_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES "games"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "player_market_metrics"
  ADD CONSTRAINT "player_market_metrics_sportsbookId_fkey"
  FOREIGN KEY ("sportsbookId") REFERENCES "sportsbooks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "edge_snapshots"
  ADD CONSTRAINT "edge_snapshots_refreshRunId_fkey"
  FOREIGN KEY ("refreshRunId") REFERENCES "refresh_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "edge_snapshots"
  ADD CONSTRAINT "edge_snapshots_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "players"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "edge_snapshots"
  ADD CONSTRAINT "edge_snapshots_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES "games"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "edge_snapshots"
  ADD CONSTRAINT "edge_snapshots_sportsbookId_fkey"
  FOREIGN KEY ("sportsbookId") REFERENCES "sportsbooks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
