"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeUnderdogProps = scrapeUnderdogProps;
var normalize_1 = require("@/lib/sportsdata/normalize");
function scrapeUnderdogProps() {
    return __awaiter(this, arguments, void 0, function (capturedAt) {
        var response, data, props, _i, _a, line, overUnder, rawMarketName, market, statValue, overOption, underOption, playerName, overPrice, underPrice, error_1;
        if (capturedAt === void 0) { capturedAt = new Date(); }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, fetch("https://api.underdogfantasy.com/beta/v3/over_under_lines", {
                            headers: {
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                                "Accept": "application/json",
                            },
                        })];
                case 1:
                    response = _b.sent();
                    if (!response.ok) {
                        throw new Error("Underdog API responded with status: ".concat(response.status));
                    }
                    return [4 /*yield*/, response.json()];
                case 2:
                    data = _b.sent();
                    props = [];
                    if (!data || !Array.isArray(data.over_under_lines)) {
                        return [2 /*return*/, props];
                    }
                    for (_i = 0, _a = data.over_under_lines; _i < _a.length; _i++) {
                        line = _a[_i];
                        if (line.status !== "active")
                            continue;
                        overUnder = line.over_under;
                        if (!overUnder)
                            continue;
                        rawMarketName = overUnder.grid_display_title || overUnder.title;
                        market = (0, normalize_1.normalizeMarketFromBetType)(rawMarketName);
                        if (!market)
                            continue;
                        statValue = parseFloat(line.stat_value);
                        if (isNaN(statValue))
                            continue;
                        // Ensure we have options to get the player name and odds
                        if (!Array.isArray(line.options) || line.options.length < 2)
                            continue;
                        overOption = line.options.find(function (o) { return o.choice === "higher"; });
                        underOption = line.options.find(function (o) { return o.choice === "lower"; });
                        playerName = (overOption === null || overOption === void 0 ? void 0 : overOption.selection_header) || (underOption === null || underOption === void 0 ? void 0 : underOption.selection_header);
                        if (!playerName)
                            continue;
                        overPrice = overOption ? parseInt(overOption.american_price, 10) : -112;
                        underPrice = underOption ? parseInt(underOption.american_price, 10) : -112;
                        props.push({
                            externalGameId: "UNDERDOG_GAME", // We don't have game linking, but it doesn't matter much if we process by player name
                            externalPlayerId: playerName, // Use player name as external ID so we can fuzzy match later
                            sportsbookKey: "underdog",
                            sportsbookDisplayName: "Underdog Fantasy",
                            providerSportsbookId: null,
                            market: market,
                            rawMarketName: rawMarketName,
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
                            capturedAt: capturedAt,
                        });
                    }
                    return [2 /*return*/, props];
                case 3:
                    error_1 = _b.sent();
                    console.error("Failed to scrape Underdog props:", error_1);
                    return [2 /*return*/, []];
                case 4: return [2 /*return*/];
            }
        });
    });
}
