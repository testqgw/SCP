import path from "node:path";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import {
  trainUniversalBaselineRouter,
  type RouterDatasetRow,
  type RouterFeatureMode,
} from "../lib/snapshot/universalBaselineRouter";

type Args = {
  input: string;
  out: string;
  maxDepth: number;
  minLeaf: number;
  featureMode: RouterFeatureMode;
  bucketKeys: string[];
};

function parseBucketKeys(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = path.join("exports", "universal-baseline-router-dataset.jsonl");
  let out = path.join("exports", "universal-baseline-router-live.json");
  let maxDepth = 3;
  let minLeaf = 250;
  let featureMode: RouterFeatureMode = "core_relations";
  const bucketKeys = new Set<string>();

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
    if (token === "--bucket-key" && next) {
      parseBucketKeys(next).forEach((bucketKey) => bucketKeys.add(bucketKey));
      index += 1;
      continue;
    }
    if (token.startsWith("--bucket-key=")) {
      parseBucketKeys(token.slice("--bucket-key=".length)).forEach((bucketKey) => bucketKeys.add(bucketKey));
      continue;
    }
    if (token === "--max-depth" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) maxDepth = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--max-depth=")) {
      const parsed = Number(token.slice("--max-depth=".length));
      if (Number.isFinite(parsed) && parsed > 0) maxDepth = Math.floor(parsed);
      continue;
    }
    if (token === "--min-leaf" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minLeaf = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-leaf=")) {
      const parsed = Number(token.slice("--min-leaf=".length));
      if (Number.isFinite(parsed) && parsed > 0) minLeaf = Math.floor(parsed);
      continue;
    }
    if (token === "--feature-mode" && next) {
      if (next === "core" || next === "core_relations") featureMode = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--feature-mode=")) {
      const value = token.slice("--feature-mode=".length);
      if (value === "core" || value === "core_relations") featureMode = value;
    }
  }

  return { input, out, maxDepth, minLeaf, featureMode, bucketKeys: [...bucketKeys] };
}

function readJsonl<T>(filePath: string): T[] {
  const content = readFileSync(path.resolve(filePath), "utf8").trim();
  if (!content) return [];
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const bucketFilter = args.bucketKeys.length > 0 ? new Set(args.bucketKeys) : null;
  const rows = readJsonl<RouterDatasetRow>(args.input).filter(
    (row) => row.routerTarget != null && (!bucketFilter || bucketFilter.has(row.bucketKey)),
  );
  const model = trainUniversalBaselineRouter(rows, {
    maxDepth: args.maxDepth,
    minLeaf: args.minLeaf,
    featureMode: args.featureMode,
  });

  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        generatedAt: model.generatedAt,
        input: path.resolve(args.input),
        out: outPath,
        bucketKeys: args.bucketKeys,
        config: model.config,
        featureCount: model.featureCatalog.length,
        training: model.training,
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
