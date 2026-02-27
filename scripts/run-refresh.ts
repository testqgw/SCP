import { runRefresh } from "../lib/snapshot/refresh";
import { SportsDataClient } from "../lib/sportsdata/client";

async function main(): Promise<void> {
  const mode = process.argv[2]?.toLowerCase();
  if (mode !== "full" && mode !== "delta") {
    throw new Error('Usage: npm run refresh:full OR npm run refresh:delta (modes: "full"|"delta").');
  }

  const date = process.argv[3]; // Added definition for 'date'
  if (!date) {
    throw new Error('Usage: npm run refresh:full <date> OR npm run refresh:delta <date>. Date is required.');
  }

  try {
    const rawProps = await new SportsDataClient().fetchLegacyPlayerPropsByDate(date);
    // eslint-disable-next-line no-console
    console.log("RAW PROP EXAMPLE:", JSON.stringify(rawProps[0], null, 2));

    const result = await runRefresh(mode.toUpperCase() as "FULL" | "DELTA"); // Kept original runRefresh call with result
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    // eslint-disable-next-line no-console
    console.log(`Refresh ${mode} completed successfully for game date ${date}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Refresh ${mode} failed for game date ${date}:`, error);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
