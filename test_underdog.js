"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var scraper_1 = require("./lib/sportsdata/scraper");
(0, scraper_1.scrapeUnderdogProps)()
    .then(function (data) {
    console.log("Scraped ".concat(data.length, " props."));
    console.log(JSON.stringify(data.slice(0, 3), null, 2));
})
    .catch(console.error);
