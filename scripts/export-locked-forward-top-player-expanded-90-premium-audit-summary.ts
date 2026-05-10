import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Args = {
  lockLedgerPath: string;
  settlementLedgerPath: string;
  marketLineLedgerPath: string;
  reportPrefix: string;
  outPrefix: string;
  modelLabel: string;
};

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  json: Record<string, unknown> | null;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let lockLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium-ledger.jsonl");
  let settlementLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium", "settlements.jsonl");
  let marketLineLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium", "market-lines.jsonl");
  let reportPrefix = path.join("exports", "locked-forward", "top-player-expanded-90-premium", "performance-report");
  let outPrefix = path.join("exports", "locked-forward", "top-player-expanded-90-premium", "audit-summary");
  let modelLabel = "Top Player Expanded 90 Premium";

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if (token === "--lock-ledger" && next) {
      lockLedgerPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--lock-ledger=")) {
      lockLedgerPath = token.slice("--lock-ledger=".length);
      continue;
    }
    if (token === "--settlement-ledger" && next) {
      settlementLedgerPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--settlement-ledger=")) {
      settlementLedgerPath = token.slice("--settlement-ledger=".length);
      continue;
    }
    if (token === "--market-line-ledger" && next) {
      marketLineLedgerPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--market-line-ledger=")) {
      marketLineLedgerPath = token.slice("--market-line-ledger=".length);
      continue;
    }
    if (token === "--report-prefix" && next) {
      reportPrefix = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--report-prefix=")) {
      reportPrefix = token.slice("--report-prefix=".length);
      continue;
    }
    if ((token === "--out-prefix" || token === "-o") && next) {
      outPrefix = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out-prefix=")) {
      outPrefix = token.slice("--out-prefix=".length);
      continue;
    }
    if (token === "--model-label" && next) {
      modelLabel = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--model-label=")) {
      modelLabel = token.slice("--model-label=".length);
    }
  }

  return {
    lockLedgerPath: path.resolve(lockLedgerPath),
    settlementLedgerPath: path.resolve(settlementLedgerPath),
    marketLineLedgerPath: path.resolve(marketLineLedgerPath),
    reportPrefix: path.resolve(reportPrefix),
    outPrefix: path.resolve(outPrefix),
    modelLabel,
  };
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function runTsxScript(scriptPath: string, args: string[]): CommandResult {
  const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
  try {
    const stdout = execFileSync(process.execPath, [tsxCli, scriptPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "", json: extractJson(stdout) };
  } catch (error) {
    const failed = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stdout = failed.stdout?.toString() ?? "";
    const stderr = failed.stderr?.toString() ?? failed.message ?? "";
    return { ok: false, stdout, stderr, json: extractJson(stdout) };
  }
}

function boolStatus(result: CommandResult): "PASS" | "FAIL" {
  return result.ok && result.json?.ok !== false ? "PASS" : "FAIL";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pct(value: number | null): string {
  return value == null ? "-" : `${value.toFixed(2)}%`;
}

function metric(value: number | null): string {
  return value == null ? "-" : String(value);
}

function toMarkdown(input: {
  generatedAt: string;
  statusLines: Record<string, string | number>;
  outputs: Record<string, string>;
  claimBoundary: string;
  commands: Record<string, CommandResult>;
  modelLabel: string;
}): string {
  const lines: string[] = [];
  lines.push(`# Locked Forward ${input.modelLabel} Audit Summary`);
  lines.push("");
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push("");
  lines.push("## Blunt Status");
  lines.push("");
  for (const [key, value] of Object.entries(input.statusLines)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Claim Boundary");
  lines.push("");
  lines.push(input.claimBoundary);
  lines.push("");
  lines.push("## Outputs");
  lines.push("");
  for (const [key, value] of Object.entries(input.outputs)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Verifier Details");
  lines.push("");
  for (const [key, result] of Object.entries(input.commands)) {
    const errors = Array.isArray(result.json?.errors) ? result.json.errors.length : 0;
    const warnings = Array.isArray(result.json?.warnings) ? result.json.warnings.length : 0;
    lines.push(`- ${key}: ${boolStatus(result)} (${errors} errors, ${warnings} warnings)`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const generatedAt = new Date().toISOString();
  const lockVerifier = runTsxScript("scripts/verify-locked-forward-ledger.ts", ["--ledger", args.lockLedgerPath]);
  const marketLineVerifier = runTsxScript("scripts/verify-locked-forward-market-lines.ts", [
    "--lock-ledger",
    args.lockLedgerPath,
    "--market-line-ledger",
    args.marketLineLedgerPath,
  ]);
  const settlementVerifier = runTsxScript("scripts/verify-locked-forward-settlements.ts", [
    "--lock-ledger",
    args.lockLedgerPath,
    "--settlement-ledger",
    args.settlementLedgerPath,
  ]);
  const report = runTsxScript("scripts/export-locked-forward-top-player-expanded-90-premium-performance-report.ts", [
    "--lock-ledger",
    args.lockLedgerPath,
    "--settlement-ledger",
    args.settlementLedgerPath,
    "--market-line-ledger",
    args.marketLineLedgerPath,
    "--out-prefix",
    args.reportPrefix,
    "--model-label",
    args.modelLabel,
  ]);

  const reportSummary = nestedRecord(report.json?.summary);
  const forwardPicks = num(lockVerifier.json?.forwardRows) ?? 0;
  const settledPicks = num(settlementVerifier.json?.settledPickCount) ?? num(reportSummary?.settledPickCount) ?? 0;
  const pricedBookSlots = num(marketLineVerifier.json?.pricedPickBookSlots) ?? num(reportSummary?.pricedBookSlots) ?? 0;
  const roiPct = num(reportSummary?.roiPct);
  const avgClv = num(reportSummary?.avgClv);
  const overallPass =
    boolStatus(lockVerifier) === "PASS" &&
    boolStatus(marketLineVerifier) === "PASS" &&
    boolStatus(settlementVerifier) === "PASS" &&
    report.ok;
  const statusLines: Record<string, string | number> = {
    "LOCK LEDGER": boolStatus(lockVerifier),
    "MARKET LINE LEDGER": boolStatus(marketLineVerifier),
    "SETTLEMENT LEDGER": boolStatus(settlementVerifier),
    "PERFORMANCE REPORT GENERATED": report.ok ? "PASS" : "FAIL",
    "FORWARD PICKS": forwardPicks,
    "SETTLED PICKS": settledPicks,
    "PRICED BOOK SLOTS": pricedBookSlots,
    ROI: pct(roiPct),
    CLV: metric(avgClv),
    OVERALL: overallPass ? "PASS" : "FAIL",
  };
  const outputs = {
    auditJson: `${args.outPrefix}.json`,
    auditMd: `${args.outPrefix}.md`,
    performanceJson: `${args.reportPrefix}.json`,
    performanceMd: `${args.reportPrefix}.md`,
    performanceCsv: `${args.reportPrefix}.csv`,
  };
  const claimBoundary =
    "Audit summary is derived. Source truth remains the lock ledger, market-line ledger, and settlement ledger; model is not forward-proven until real forward rows accumulate.";
  const payload = {
    generatedAt,
    claimBoundary,
    statusLines,
    inputs: {
      lockLedgerPath: args.lockLedgerPath,
      marketLineLedgerPath: args.marketLineLedgerPath,
      settlementLedgerPath: args.settlementLedgerPath,
      modelLabel: args.modelLabel,
    },
    outputs,
    verifierSummaries: {
      lock: lockVerifier.json,
      marketLines: marketLineVerifier.json,
      settlements: settlementVerifier.json,
      performanceReport: report.json,
    },
    commandOk: {
      lockVerifier: lockVerifier.ok,
      marketLineVerifier: marketLineVerifier.ok,
      settlementVerifier: settlementVerifier.ok,
      performanceReport: report.ok,
    },
  };

  await mkdir(path.dirname(args.outPrefix), { recursive: true });
  await Promise.all([
    writeFile(`${args.outPrefix}.json`, `${JSON.stringify(payload, null, 2)}\n`, "utf8"),
    writeFile(
      `${args.outPrefix}.md`,
      toMarkdown({
        generatedAt,
        statusLines,
        outputs,
        claimBoundary,
        commands: {
          "lock ledger": lockVerifier,
          "market-line ledger": marketLineVerifier,
          "settlement ledger": settlementVerifier,
        },
        modelLabel: args.modelLabel,
      }),
      "utf8",
    ),
  ]);

  process.stdout.write(`${toMarkdown({ generatedAt, statusLines, outputs, claimBoundary, commands: {
    "lock ledger": lockVerifier,
    "market-line ledger": marketLineVerifier,
    "settlement ledger": settlementVerifier,
  }, modelLabel: args.modelLabel })}`);
  if (!overallPass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
