const key = process.env.SPORTS_DATA_IO_API_KEY || "db956f2ac8a14aeb96dd146df9753dfd";
const date = "2026-02-27";

async function fetchSdio(path) {
    const url = `https://api.sportsdata.io/v3/nba${path}`;
    const res = await fetch(url, {
        headers: { "Ocp-Apim-Subscription-Key": key }
    });
    console.log(`[${res.status}] ${path}`);
    if (!res.ok) return null;
    return res.json();
}

async function main() {
    const [legacyByDate, bettingEvents] = await Promise.all([
        fetchSdio(`/odds/json/PlayerPropsByDate/${date}`),
        fetchSdio(`/odds/json/BettingEventsByDate/${date}`)
    ]);

    console.log('Legacy PlayerPropsByDate count:', legacyByDate?.length || 0);
    console.log('BettingEventsByDate count:', bettingEvents?.length || 0);

    if (bettingEvents && bettingEvents.length > 0) {
        const gameId = bettingEvents[0].GameID || bettingEvents[0].EventID;
        const byGameId = await fetchSdio(`/odds/json/BettingPlayerPropsByGameID/${gameId}`);
        if (byGameId) {
            console.log('BettingPlayerPropsByGameID length for game', gameId, ':', byGameId.length);
            console.log('First primary prop:', byGameId[0]);
        }

        const byEventId = await fetchSdio(`/odds/json/BettingPlayerPropsByEventID/${gameId}`);
        if (byEventId) {
            console.log('BettingPlayerPropsByEventID length for event', gameId, ':', byEventId.length);
        }
    }

    const bettingByDate = await fetchSdio(`/odds/json/BettingPlayerPropsByDate/${date}`);
    if (bettingByDate) {
        console.log('BettingPlayerPropsByDate length:', bettingByDate.length);
        console.log('First prop:', bettingByDate[0]);
    }
}
main().catch(console.error);
