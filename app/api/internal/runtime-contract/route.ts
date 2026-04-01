import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/auth/guard";
import {
  DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_PROJECTION_DISTRIBUTION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_QUALIFICATION_SETTINGS_RELATIVE_PATH,
  resolveProjectPath,
} from "@/lib/snapshot/universalArtifactPaths";
import {
  getLivePraRawFeatureRuntimeMeta,
  resolveLivePraRawFeatureModelFilePath,
} from "@/lib/snapshot/livePraRawFeatureModel";
import { getLivePlayerOverrideRuntimeMeta } from "@/lib/snapshot/livePlayerSideModels";

export const dynamic = "force-dynamic";

type FileContract = {
  path: string | null;
  exists: boolean;
  sizeBytes: number | null;
  parsed: boolean | null;
  recordCount: number | null;
};

function fileSize(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function parseJsonFile(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw) as Record<string, unknown>;
}

function readJsonArrayMeta(filePath: string, key?: string): { parsed: boolean; count: number | null } {
  if (!fs.existsSync(filePath)) {
    return {
      parsed: false,
      count: null,
    };
  }
  try {
    const payload = parseJsonFile(filePath);
    if (!key) {
      return {
        parsed: true,
        count: null,
      };
    }
    const value = payload[key];
    return {
      parsed: true,
      count: Array.isArray(value) ? value.length : null,
    };
  } catch {
    return {
      parsed: false,
      count: null,
    };
  }
}

function buildFileContract(filePath: string, key?: string): FileContract {
  const parsedMeta = readJsonArrayMeta(filePath, key);
  return {
    path: filePath,
    exists: fs.existsSync(filePath),
    sizeBytes: fileSize(filePath),
    parsed: parsedMeta.parsed,
    recordCount: parsedMeta.count,
  };
}

function sanitizeFileContract(contract: FileContract, includePath: boolean): FileContract {
  return {
    ...contract,
    path: includePath ? contract.path : null,
  };
}

function resolveUniversalModelFilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_MODEL_FILE?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  }

  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH);
  const fallback = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH);
  if (preferred && fs.existsSync(preferred)) return preferred;
  return fallback;
}

function resolveUniversalCalibrationFilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_CALIBRATION_FILE?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  }
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH);
}

function resolveUniversalProjectionDistributionFilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_PROJECTION_DISTRIBUTION_FILE?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  }
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_PROJECTION_DISTRIBUTION_RELATIVE_PATH);
}

function resolveUniversalQualificationSettingsFilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_QUALIFICATION_SETTINGS_FILE?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  }
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_QUALIFICATION_SETTINGS_RELATIVE_PATH);
}

const PLAYER_MODEL_SUMMARY_FILE_NAMES = [
  "shai-gilgeous-alexander-player-model-summary.json",
  "giannis-antetokounmpo-player-model-summary.json",
  "luka-doncic-player-model-summary.json",
  "victor-wembanyama-player-model-summary.json",
  "anthony-edwards-player-model-summary.json",
  "stephen-curry-player-model-summary.json",
  "donovan-mitchell-player-model-summary.json",
  "cade-cunningham-player-model-summary.json",
  "jaylen-brown-player-model-summary.json",
  "kevin-durant-player-model-summary.json",
  "kawhi-leonard-player-model-summary.json",
] as const;

function resolvePlayerOverrideAllowlistFilePath(): string {
  const override = process.env.SNAPSHOT_LIVE_PLAYER_OVERRIDE_ALLOWLIST_FILE?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  }
  return path.join(process.cwd(), "exports", "live-player-override-allowlist.json");
}

function readAllowlistCount(filePath: string): number | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const payload = parseJsonFile(filePath) as
      | { allowedPlayers?: unknown[]; players?: unknown[]; playerStats?: unknown[] }
      | unknown[];
    if (Array.isArray(payload)) return payload.length;
    if (Array.isArray(payload.allowedPlayers)) return payload.allowedPlayers.length;
    if (Array.isArray(payload.players)) return payload.players.length;
    if (Array.isArray(payload.playerStats)) return payload.playerStats.length;
    return 0;
  } catch {
    return null;
  }
}

function readManifestEntriesCount(filePath: string): number | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const payload = parseJsonFile(filePath) as { entries?: unknown[] } | unknown[];
    if (Array.isArray(payload)) return payload.length;
    if (Array.isArray(payload.entries)) return payload.entries.length;
    return 0;
  } catch {
    return null;
  }
}

function buildPlayerSummaryContract(includePaths: boolean) {
  const exportsDir = path.join(process.cwd(), "exports");
  const files = PLAYER_MODEL_SUMMARY_FILE_NAMES.map((name) => {
    const filePath = path.join(exportsDir, name);
    return {
      name,
      path: includePaths ? filePath : null,
      exists: fs.existsSync(filePath),
      sizeBytes: fileSize(filePath),
      playerModels: readJsonArrayMeta(filePath, "playerModels").count,
    };
  });

  return {
    expectedCount: PLAYER_MODEL_SUMMARY_FILE_NAMES.length,
    existingCount: files.filter((file) => file.exists).length,
    files,
  };
}

async function handle(request: NextRequest): Promise<NextResponse> {
  try {
    const includePaths = isCronAuthorized(request);
    const modelFile = resolveUniversalModelFilePath();
    const calibrationFile = resolveUniversalCalibrationFilePath();
    const projectionDistributionFile = resolveUniversalProjectionDistributionFilePath();
    const qualificationSettingsFile = resolveUniversalQualificationSettingsFilePath();
    const promotedPraRawFeatureFile = resolveLivePraRawFeatureModelFilePath();
    const promotedPraRuntime = getLivePraRawFeatureRuntimeMeta();
    const allowlistFile = resolvePlayerOverrideAllowlistFilePath();
    const playerOverrideRuntime = getLivePlayerOverrideRuntimeMeta();
    const playerSummary = buildPlayerSummaryContract(includePaths);

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      authorized: includePaths,
      universal: {
        modelFile: sanitizeFileContract(buildFileContract(modelFile, "models"), includePaths),
        calibrationFile: sanitizeFileContract(buildFileContract(calibrationFile, "records"), includePaths),
        projectionDistributionFile: sanitizeFileContract(
          buildFileContract(projectionDistributionFile, "records"),
          includePaths,
        ),
        qualificationSettingsFile: sanitizeFileContract(buildFileContract(qualificationSettingsFile), includePaths),
        promotedPraRawFeatureFile: sanitizeFileContract(buildFileContract(promotedPraRawFeatureFile), includePaths),
      },
      promotedPraRawFeature: {
        mode: promotedPraRuntime.mode,
        enabled: promotedPraRuntime.enabled,
        label: promotedPraRuntime.label,
        version: promotedPraRuntime.version,
      },
      playerOverrides: {
        mode: playerOverrideRuntime.mode,
        joelMode: playerOverrideRuntime.joelMode,
        javonMode: playerOverrideRuntime.javonMode,
        jaMode: playerOverrideRuntime.jaMode,
        naeMode: playerOverrideRuntime.naeMode,
        coleMode: playerOverrideRuntime.coleMode,
        dejounteMode: playerOverrideRuntime.dejounteMode,
        devinMode: playerOverrideRuntime.devinMode,
        aaronMode: playerOverrideRuntime.aaronMode,
        sabonisMode: playerOverrideRuntime.sabonisMode,
        taureanMode: playerOverrideRuntime.taureanMode,
        tristanMode: playerOverrideRuntime.tristanMode,
        marcusMode: playerOverrideRuntime.marcusMode,
        kyleMode: playerOverrideRuntime.kyleMode,
        playerLocalRecoveryManifest: {
          mode: playerOverrideRuntime.playerLocalRecoveryManifestMode,
          path: includePaths ? playerOverrideRuntime.playerLocalRecoveryManifestFile : null,
          signature: playerOverrideRuntime.playerLocalRecoveryManifestSignature,
          exists: fs.existsSync(playerOverrideRuntime.playerLocalRecoveryManifestFile),
          sizeBytes: fileSize(playerOverrideRuntime.playerLocalRecoveryManifestFile),
          entries: readManifestEntriesCount(playerOverrideRuntime.playerLocalRecoveryManifestFile),
        },
        allowlistFile: {
          path: includePaths ? allowlistFile : null,
          exists: fs.existsSync(allowlistFile),
          sizeBytes: fileSize(allowlistFile),
          entries: readAllowlistCount(allowlistFile),
        },
        summaryFiles: playerSummary,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown runtime contract error",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
