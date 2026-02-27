import { NormalizedGame, NormalizedPlayerProp, NormalizedPlayerSeason } from "@/lib/sportsdata/types";
import { normalizeMarketFromBetType } from "@/lib/snapshot/markets";

export async function scrapeUnderdogProps(
    games: NormalizedGame[],
    seasonPlayers: NormalizedPlayerSeason[],
    capturedAt: Date = new Date(),
): Promise<NormalizedPlayerProp[]> {
    try {
        const response = await fetch("https://api.underdogfantasy.com/beta/v3/over_under_lines", {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            throw new Error(`Underdog API responded with status: ${response.status}`);
        }

        const data = await response.json();
        const props: NormalizedPlayerProp[] = [];

        if (!data || !Array.isArray(data.over_under_lines)) {
            return props;
        }

        // Build player lookup by name
        const playerNameToTeam = new Map<string, string>();
        for (const p of seasonPlayers) {
            if (p.teamAbbr) {
                playerNameToTeam.set(p.fullName.toLowerCase().replace(/[^a-z]/g, ""), p.teamAbbr);
            }
        }

        // Build game lookup by team
        const teamToGameId = new Map<string, string>();
        for (const g of games) {
            teamToGameId.set(g.homeTeamAbbr, g.externalGameId);
            teamToGameId.set(g.awayTeamAbbr, g.externalGameId);
        }

        for (const line of data.over_under_lines) {
            if (line.status !== "active") continue;

            const overUnder = line.over_under;
            if (!overUnder) continue;

            const overOption = line.options.find((o: { choice: string; selection_header?: string }) => o.choice === "higher");
            const underOption = line.options.find((o: { choice: string; selection_header?: string }) => o.choice === "lower");

            const playerName = overOption?.selection_header || underOption?.selection_header;
            if (!playerName) continue;

            let rawMarketName = overUnder.title;
            if (rawMarketName.startsWith(playerName + " ")) {
                rawMarketName = rawMarketName.substring(playerName.length + 1);
            }
            if (rawMarketName.endsWith(" O/U")) {
                rawMarketName = rawMarketName.substring(0, rawMarketName.length - 4);
            }
            if (rawMarketName.endsWith("  O/U")) {
                rawMarketName = rawMarketName.substring(0, rawMarketName.length - 5);
            }

            const market = normalizeMarketFromBetType(rawMarketName);
            if (!market) continue;

            const statValue = parseFloat(line.stat_value);
            if (isNaN(statValue)) continue;

            if (!Array.isArray(line.options) || line.options.length < 2) continue;

            const normalizedName = playerName.toLowerCase().replace(/[^a-z]/g, "");

            // Map player to team to game
            const teamAbbr = playerNameToTeam.get(normalizedName);
            if (!teamAbbr) continue;

            const externalGameId = teamToGameId.get(teamAbbr);
            if (!externalGameId) continue; // No game today for this player's team

            const overPrice = overOption ? parseInt(overOption.american_price, 10) : -112;
            const underPrice = underOption ? parseInt(underOption.american_price, 10) : -112;

            props.push({
                externalGameId,
                externalPlayerId: playerName,
                sportsbookKey: "underdog",
                sportsbookDisplayName: "Underdog Fantasy",
                providerSportsbookId: null,
                market,
                rawMarketName,
                line: statValue,
                overPrice: isNaN(overPrice) ? -112 : overPrice,
                underPrice: isNaN(underPrice) ? -112 : underPrice,
                providerMarketId: overUnder.id,
                providerBetTypeId: null,
                providerPeriodTypeId: null,
                providerOutcomeType: null,
                teamCodeProvider: null,
                opponentCodeProvider: null,
                teamCodeCanonical: null,
                opponentCodeCanonical: null,
                sourceFeed: "UNDERDOG_API",
                capturedAt,
            });
        }

        return props;
    } catch (error) {
        console.error("Failed to scrape Underdog props:", error);
        return [];
    }
}
