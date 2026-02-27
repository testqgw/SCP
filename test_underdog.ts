import { scrapeUnderdogProps } from "./lib/sportsdata/scraper";

scrapeUnderdogProps()
    .then((data) => {
        console.log(`Scraped ${data.length} props.`);
        console.log(JSON.stringify(data.slice(0, 3), null, 2));
    })
    .catch(console.error);
