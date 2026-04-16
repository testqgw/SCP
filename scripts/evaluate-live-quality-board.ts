import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyPromotedLivePraRawFeatureRows,
  buildLiveQualityRuntimeSnapshot,
  disconnectLiveQualityBoardEvalPrisma,
  evaluateRows,
  loadRowsPayload,
  filterAndAttachRows,
  loadLiveQualityQualificationSettings,
  summarizeEvaluatedRows,
  summarizePlayers,
} from "./utils/liveQualityBoardEval";

type Args = {
  input: string | null;
  out: string | null;
  detailsOut: string | null;
  minActualMinutes: number;
  qualificationSettingsFile: string | null;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input: string | null = null;
  let out: string | null = null;
  let detailsOut: string | null = null;
  let minActualMinutes = 15;
  let qualificationSettingsFile: string | null = null;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if ((token === "--input" || token === "-i") && next) {
      input = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      input = token.slice("--input=".length);
      continue;
    }
    if ((token === "--out" || token === "-o") && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if ((token === "--details-out" || token === "--row-details-out") && next) {
      detailsOut = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--details-out=") || token.startsWith("--row-details-out=")) {
      detailsOut = token.includes("--row-details-out=")
        ? token.slice("--row-details-out=".length)
        : token.slice("--details-out=".length);
      continue;
    }
    if (token === "--no-out") {
      out = null;
      continue;
    }
    if ((token === "--qualification-settings-file" || token === "--settings-file") && next) {
      qualificationSettingsFile = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--qualification-settings-file=") || token.startsWith("--settings-file=")) {
      qualificationSettingsFile = token.includes("--settings-file=")
        ? token.slice("--settings-file=".length)
        : token.slice("--qualification-settings-file=".length);
      continue;
    }
    if (token === "--min-actual-minutes" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--min-actual-minutes=")) {
      const parsed = Number(token.slice("--min-actual-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      continue;
    }
  }

  return {
    input,
    out,
    detailsOut,
    minActualMinutes,
    qualificationSettingsFile,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = await loadRowsPayload(args.input);
  const rows = filterAndAttachRows(payload.playerMarketRows, args.minActualMinutes);
  const summaries = await summarizePlayers(rows);
  const qualification = await loadLiveQualityQualificationSettings(args.qualificationSettingsFile);
  const evaluatedRows = applyPromotedLivePraRawFeatureRows(
    rows,
    evaluateRows(rows, summaries, qualification.settings),
  );
  const summary = summarizeEvaluatedRows(evaluatedRows);
  const runtime = buildLiveQualityRuntimeSnapshot({
    input: args.input,
    qualificationSettingsFile: qualification.sourceFile,
  });

  const output = {
    generatedAt: new Date().toISOString(),
    input: args.input ? path.resolve(args.input) : null,
    from: payload.from ?? null,
    to: payload.to ?? null,
    filters: {
      minActualMinutes: args.minActualMinutes,
    },
    runtime,
    metricPriority: ["rawAccuracy", "blendedAccuracy", "coveragePct"],
    metricDefinitions: {
      rawAccuracy:
        "Resolved live-quality raw accuracy: player override when present, else universal raw side, else baseline.",
      strictRawAccuracy:
        "Strict live-quality raw accuracy: player override when present, else universal raw side, with unresolved rows scoring as misses.",
      qualifiedAccuracy:
        "Accuracy on rows where the live board used a non-baseline side after qualification and player overrides.",
      blendedAccuracy:
        "Final live board accuracy after qualification fallback to baseline and any curated player override.",
      legacyUniversalRawAccuracy:
        "Legacy universal-only raw accuracy before player overrides, retained to reconcile older metric family comparisons.",
      legacyUniversalBlendedAccuracy:
        "Legacy universal-only blended accuracy before player overrides, retained for comparison against prior branch files.",
    },
    settings: qualification.settings,
    overall: summary.overall,
    byMarket: summary.byMarket,
  };

  if (args.out) {
    const outPath = path.resolve(args.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
  if (args.detailsOut) {
    const detailsPath = path.resolve(args.detailsOut);
    await mkdir(path.dirname(detailsPath), { recursive: true });
    await writeFile(detailsPath, `${JSON.stringify(evaluatedRows, null, 2)}\n`, "utf8");
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectLiveQualityBoardEvalPrisma();
  });
