import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type FeatureUsage = {
  feature: string;
  count: number;
};

type BucketUsage = {
  market: string;
  archetype: string;
  bucketKey: string;
  modelKind: string | null;
  features: FeatureUsage[];
  totalMatches: number;
};

type Args = {
  input: string;
  out: string | null;
  features: string[];
};

function parseArgs(argv: string[]): Args {
  let input: string | null = null;
  let out: string | null = null;
  let features = ["l5MarketDeltaAvg", "l5OverRate", "l5MinutesAvg"];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if ((token === "--input" || token === "-i") && next) {
      input = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      input = token.slice("--input=".length);
      continue;
    }
    if ((token === "--out" || token === "-o") && next) {
      out = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if ((token === "--features" || token === "-f") && next) {
      features = next
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (token.startsWith("--features=")) {
      features = token
        .slice("--features=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }

  if (!input) {
    throw new Error("Missing required --input <path>.");
  }

  return { input, out, features };
}

function collectFeatureMatches(node: unknown, tracked: Set<string>, counts: Map<string, number>): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectFeatureMatches(item, tracked, counts));
    return;
  }
  if (typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  const feature = typeof record.feature === "string" ? record.feature : null;
  if (feature && tracked.has(feature)) {
    counts.set(feature, (counts.get(feature) ?? 0) + 1);
  }

  Object.values(record).forEach((value) => collectFeatureMatches(value, tracked, counts));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.isAbsolute(args.input) ? args.input : path.join(process.cwd(), args.input);
  const raw = await readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const tracked = new Set(args.features);
  const buckets = Array.isArray(parsed.byBucket)
    ? parsed.byBucket
    : Array.isArray(parsed.models)
      ? parsed.models
      : Array.isArray(parsed.bucketModels)
        ? parsed.bucketModels
        : [];
  const bucketUsages: BucketUsage[] = [];
  const totalsByFeature = new Map<string, number>();

  for (const bucket of buckets) {
    if (bucket == null || typeof bucket !== "object") continue;
    const record = bucket as Record<string, unknown>;
    const market = typeof record.market === "string" ? record.market : null;
    const archetype = typeof record.archetype === "string" ? record.archetype : null;
    if (!market || !archetype) continue;

    const model = record.model;
    const counts = new Map<string, number>();
    collectFeatureMatches(model, tracked, counts);
    if (counts.size === 0) continue;

    const features = Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([feature, count]) => ({ feature, count }));

    features.forEach(({ feature, count }) => {
      totalsByFeature.set(feature, (totalsByFeature.get(feature) ?? 0) + count);
    });

    bucketUsages.push({
      market,
      archetype,
      bucketKey: `${market}|${archetype}`,
      modelKind:
        model && typeof model === "object" && typeof (model as Record<string, unknown>).kind === "string"
          ? ((model as Record<string, unknown>).kind as string)
          : null,
      features,
      totalMatches: features.reduce((sum, item) => sum + item.count, 0),
    });
  }

  bucketUsages.sort(
    (left, right) =>
      right.totalMatches - left.totalMatches ||
      left.market.localeCompare(right.market) ||
      left.archetype.localeCompare(right.archetype),
  );

  const summary = {
    input: inputPath,
    trackedFeatures: args.features,
    bucketCount: bucketUsages.length,
    totalsByFeature: Array.from(totalsByFeature.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([feature, count]) => ({ feature, count })),
    buckets: bucketUsages,
  };

  if (args.out) {
    const outputPath = path.isAbsolute(args.out) ? args.out : path.join(process.cwd(), args.out);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(`Saved L5 split summary: ${outputPath}`);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  console.error("Failed to extract L5 split usage:", error);
  process.exitCode = 1;
});
