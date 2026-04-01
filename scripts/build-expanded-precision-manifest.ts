/**
 * Build an expanded precision card manifest from the v13-live player-local manifest.
 *
 * The current vFinal manifest has 70 player-market pairs (55 THREES, 9 REB, 6 PA).
 * This script expands it by:
 *
 * 1. Keeping all existing vFinal pairs (proven high-accuracy cohort)
 * 2. Adding pairs from the v13-live player-local manifest for the Core Three markets (REB, THREES, PA)
 * 3. Adding pairs for the new Expansion markets (PRA, PR, RA) from the same manifest
 * 4. Each v13-live manifest entry has per-market routing rules â€” we include each
 *    player-market pair where the player has a dedicated routing rule for that market.
 *
 * Output: exports/precision-card-expanded-v1.json
 */

import fs from "node:fs";
import path from "node:path";

type SnapshotMarket = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";

type VFinalPair = {
  playerId: string;
  playerName?: string;
  market: SnapshotMarket;
  picks?: number;
};

type VFinalFile = {
  generatedAt?: string;
  source?: string;
  summary?: Record<string, unknown>;
  pairs: VFinalPair[];
};

type ManifestRule = {
  kind: string;
  [key: string]: unknown;
};

type ManifestEntry = {
  playerKey?: string | null;
  playerName?: string | null;
  label?: string | null;
  targetRawAccuracy?: number;
  markets?: Partial<Record<SnapshotMarket, ManifestRule>>;
};

type ManifestFile = {
  version?: string;
  generatedAt?: string;
  entries?: ManifestEntry[];
};

// Markets eligible for precision picks
const CORE_THREE: SnapshotMarket[] = ["REB", "THREES", "PA"];
const EXPANSION_MARKETS: SnapshotMarket[] = ["PRA", "RA"];
const ALL_PRECISION_MARKETS: SnapshotMarket[] = ["PTS", ...CORE_THREE, ...EXPANSION_MARKETS];

function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function main() {
  const exportsDir = path.join(process.cwd(), "exports");

  // Load existing vFinal manifest
  const vFinalPath = path.join(exportsDir, "precision-card-core-three-vfinal.json");
  const vFinal: VFinalFile = JSON.parse(fs.readFileSync(vFinalPath, "utf8"));

  // Load v13-live player-local manifest
  const v13Path = path.join(exportsDir, "player-local-target-lift-manifest-v13-live.json");
  const v13: ManifestFile = JSON.parse(fs.readFileSync(v13Path, "utf8"));

  // Build a set of existing pairs for deduplication
  const existingPairs = new Set<string>();
  for (const pair of vFinal.pairs) {
    existingPairs.add(`${pair.playerId}|${pair.market}`);
  }

  // Start with all existing vFinal pairs
  const expandedPairs: VFinalPair[] = [...vFinal.pairs];

  // Count additions by source
  const stats = {
    existingVFinal: vFinal.pairs.length,
    addedFromV13CoreThree: 0,
    addedFromV13Expansion: 0,
    v13EntriesProcessed: 0,
    skippedDuplicate: 0,
    skippedNoRule: 0,
  };

  // Process v13-live manifest entries
  for (const entry of v13.entries ?? []) {
    stats.v13EntriesProcessed++;
    const playerName = entry.playerName ?? entry.playerKey ?? null;
    if (!playerName || !entry.markets) continue;

    // We don't have playerIds in the v13 manifest, so we use a synthetic key
    // based on normalized player name. The precision system needs to be updated
    // to support name-based matching as a fallback.
    const playerKey = normalizePlayerName(playerName);

    for (const market of ALL_PRECISION_MARKETS) {
      const rule = entry.markets[market];
      if (!rule) {
        stats.skippedNoRule++;
        continue;
      }

      // Check if already exists (by name match against existing pairs)
      const existsByName = expandedPairs.some(
        (p) => p.playerName && normalizePlayerName(p.playerName) === playerKey && p.market === market,
      );

      if (existsByName) {
        stats.skippedDuplicate++;
        continue;
      }

      // Add new pair
      const isCore = CORE_THREE.includes(market);
      expandedPairs.push({
        playerId: `manifest:${playerKey}`,
        playerName: playerName,
        market: market,
        picks: 0, // Will be populated by backtest
      });

      if (isCore) {
        stats.addedFromV13CoreThree++;
      } else {
        stats.addedFromV13Expansion++;
      }
    }
  }

  // Summary by market
  const byMarket: Record<string, number> = {};
  for (const pair of expandedPairs) {
    byMarket[pair.market] = (byMarket[pair.market] || 0) + 1;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: "build-expanded-precision-manifest.ts",
    baseManifest: "precision-card-core-three-vfinal.json",
    expansionManifest: "player-local-target-lift-manifest-v13-live.json",
    stats,
    byMarket,
    summary: {
      totalPairs: expandedPairs.length,
      totalPlayers: new Set(expandedPairs.map((p) => normalizePlayerName(p.playerName ?? ""))).size,
      markets: [...new Set(expandedPairs.map((p) => p.market))],
    },
    pairs: expandedPairs,
  };

  const outPath = path.join(exportsDir, "precision-card-expanded-v1.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("\n=== Expanded Precision Manifest ===");
  console.log(`Existing vFinal pairs: ${stats.existingVFinal}`);
  console.log(`Added from v13 (Core Three): ${stats.addedFromV13CoreThree}`);
  console.log(`Added from v13 (Expansion): ${stats.addedFromV13Expansion}`);
  console.log(`Total pairs: ${expandedPairs.length}`);
  console.log(`\nBy market:`, byMarket);
  console.log(`\nWritten to: ${outPath}`);
}

main();





