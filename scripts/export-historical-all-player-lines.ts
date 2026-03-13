import { mkdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  DEFAULT_UNIVERSAL_LIVE_LINES_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_LINES_FALLBACK_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import type { SnapshotMarket } from "../lib/types/snapshot";

type Args = {
  from: string;
  to: string;
  out: string;
  tempDir: string;
  keepTemp: boolean;
};

const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");

function resolveDefaultOutputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_LINES_RELATIVE_PATH);
  if (fs.existsSync(path.dirname(preferred))) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_LINES_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let from = process.env.SNAPSHOT_UNIVERSAL_FROM?.trim() || "2025-10-23";
  let to = process.env.SNAPSHOT_UNIVERSAL_TO?.trim() || "2026-03-09";
  let out = resolveDefaultOutputPath();
  let tempDir = path.join("exports", "historical-lines", ".tmp-live-merge");
  let keepTemp = false;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if (token === "--from" && next) {
      from = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--from=")) {
      from = token.slice("--from=".length);
      continue;
    }
    if (token === "--to" && next) {
      to = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--to=")) {
      to = token.slice("--to=".length);
      continue;
    }
    if (token === "--out" && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if (token === "--temp-dir" && next) {
      tempDir = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--temp-dir=")) {
      tempDir = token.slice("--temp-dir=".length);
      continue;
    }
    if (token === "--keep-temp") {
      keepTemp = true;
    }
  }

  return {
    from,
    to,
    out: path.isAbsolute(out) ? out : path.join(process.cwd(), out),
    tempDir: path.isAbsolute(tempDir) ? tempDir : path.join(process.cwd(), tempDir),
    keepTemp,
  };
}

async function runScript(scriptPath: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, "--env-file=.env.local", "--env-file=.env", scriptPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed with exit code ${code ?? -1}: ${scriptPath}`));
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs();
  await mkdir(args.tempDir, { recursive: true });

  const tempFiles: string[] = [];
  for (const market of MARKETS) {
    const marketOutput = path.join(args.tempDir, `all-players-${market.toLowerCase()}-${args.from}-to-${args.to}.csv`);
    tempFiles.push(marketOutput);
    await runScript("scripts/export-historical-pts-lines-all.ts", [
      "--from",
      args.from,
      "--to",
      args.to,
      "--market",
      market,
      "--out",
      marketOutput,
    ]);
  }

  const combinedLines: string[] = [];
  for (let index = 0; index < tempFiles.length; index += 1) {
    const filePath = tempFiles[index];
    const content = await readFile(filePath, "utf8");
    const lines = content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;
    if (index === 0) {
      combinedLines.push(...lines);
    } else {
      combinedLines.push(...lines.slice(1));
    }
  }

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${combinedLines.join("\n")}\n`, "utf8");

  if (!args.keepTemp) {
    for (const filePath of tempFiles) {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // Ignore temp cleanup failures.
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        out: args.out,
        from: args.from,
        to: args.to,
        markets: MARKETS,
        marketFiles: tempFiles.length,
        rows: Math.max(combinedLines.length - 1, 0),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
