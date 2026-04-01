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

async function handle(request: NextRequest): Promise<NextResponse> {
  try {
    const includePaths = isCronAuthorized(request);
    const modelFile = resolveUniversalModelFilePath();
    const calibrationFile = resolveUniversalCalibrationFilePath();
    const projectionDistributionFile = resolveUniversalProjectionDistributionFilePath();
    const qualificationSettingsFile = resolveUniversalQualificationSettingsFilePath();

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
