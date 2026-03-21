import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type CachedPlayerMeta = {
  id: string;
  fullName: string | null;
  position: string | null;
};

type PlayerMetaCacheFile = {
  updatedAt: string;
  players: CachedPlayerMeta[];
};

type CacheRow = {
  playerId: string;
  playerName?: string | null;
};

type LoadPlayerMetaWithCacheArgs = {
  rows: CacheRow[];
  fetcher: (playerIds: string[]) => Promise<CachedPlayerMeta[]>;
  cachePath?: string;
  logger?: Pick<Console, "warn">;
};

const DEFAULT_PLAYER_META_CACHE_PATH = path.join(process.cwd(), "exports", "player-meta-cache.json");

async function readCache(cachePath: string): Promise<Map<string, CachedPlayerMeta>> {
  if (!fs.existsSync(cachePath)) {
    return new Map();
  }

  try {
    const payload = JSON.parse(await readFile(cachePath, "utf8")) as PlayerMetaCacheFile;
    return new Map((payload.players ?? []).map((player) => [player.id, player]));
  } catch {
    return new Map();
  }
}

async function writeCache(cachePath: string, cache: Map<string, CachedPlayerMeta>): Promise<void> {
  const payload: PlayerMetaCacheFile = {
    updatedAt: new Date().toISOString(),
    players: [...cache.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function loadPlayerMetaWithCache({
  rows,
  fetcher,
  cachePath = DEFAULT_PLAYER_META_CACHE_PATH,
  logger = console,
}: LoadPlayerMetaWithCacheArgs): Promise<Map<string, CachedPlayerMeta>> {
  const requestedIds = [...new Set(rows.map((row) => row.playerId).filter(Boolean))];
  const fallbackNameById = new Map<string, string>();
  rows.forEach((row) => {
    if (!row.playerId || !row.playerName) return;
    if (!fallbackNameById.has(row.playerId)) {
      fallbackNameById.set(row.playerId, row.playerName);
    }
  });

  const cache = await readCache(cachePath);
  const missingIds = requestedIds.filter((playerId) => !cache.has(playerId));

  if (missingIds.length > 0) {
    try {
      const fetched = await fetcher(missingIds);
      fetched.forEach((player) => {
        cache.set(player.id, player);
      });
      if (fetched.length > 0) {
        await writeCache(cachePath, cache);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown player meta error";
      logger.warn(
        `[player-meta-cache] Failed to refresh ${missingIds.length} players from primary source. ` +
          `Using cached or row-name fallback. ${message}`,
      );
    }
  }

  const resolved = new Map<string, CachedPlayerMeta>();
  let fallbackOnlyCount = 0;

  requestedIds.forEach((playerId) => {
    const cached = cache.get(playerId);
    if (cached) {
      resolved.set(playerId, cached);
      return;
    }

    fallbackOnlyCount += 1;
    resolved.set(playerId, {
      id: playerId,
      fullName: fallbackNameById.get(playerId) ?? null,
      position: null,
    });
  });

  if (fallbackOnlyCount > 0) {
    logger.warn(
      `[player-meta-cache] ${fallbackOnlyCount} players are using row-name fallback with null position. ` +
        `Archetype classification may be slightly noisier until the cache refresh succeeds.`,
    );
  }

  return resolved;
}
