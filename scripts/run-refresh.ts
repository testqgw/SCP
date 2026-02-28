import { runRefresh } from "../lib/snapshot/refresh";

async function main(): Promise<void> {
  const mode = process.argv[2]?.toLowerCase();
  if (mode !== "full" && mode !== "delta") {
    throw new Error('Usage: npm run refresh:full OR npm run refresh:delta (modes: "full"|"delta").');
  }

  try {
    const result = await runRefresh(mode.toUpperCase() as "FULL" | "DELTA");
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    // eslint-disable-next-line no-console
    console.log(`Refresh ${mode} completed successfully.`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Refresh ${mode} failed:`, error);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
