import { runRefresh } from "../lib/snapshot/refresh";

async function main(): Promise<void> {
  const mode = process.argv[2]?.toLowerCase();
  if (mode !== "full" && mode !== "delta") {
    throw new Error('Usage: npm run refresh:full OR npm run refresh:delta (modes: "full"|"delta").');
  }

  const result = await runRefresh(mode.toUpperCase() as "FULL" | "DELTA");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
