import { readFileSync } from "node:fs";

const DEFAULT_INPUT = "exports/final-player-prop-model-v1-walk-forward-board.csv";
const MARKETS = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const LONG_CARD_MARKETS = new Set(["PTS", "REB", "PRA", "PA", "PR", "RA"]);

function parseArgs() {
  const args = process.argv.slice(2);
  const inputIndex = args.findIndex((arg) => arg === "--input" || arg === "-i");
  return {
    input: inputIndex >= 0 && args[inputIndex + 1] ? args[inputIndex + 1] : DEFAULT_INPUT,
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const header = rows.shift() ?? [];
  return rows
    .filter((line) => line.length === header.length)
    .map((line) => Object.fromEntries(header.map((column, index) => [column, line[index]])));
}

function numberValue(row, key, fallback = null) {
  const value = Number(row[key]);
  return row[key] === "" || !Number.isFinite(value) ? fallback : value;
}

function pct(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : 0;
}

function finalModelComponentSignature(row) {
  const ids = String(row.components ?? "").split(";");
  const signature = [
    ids.includes("top200_premium_90") ? "P90" : null,
    ids.includes("top200_accuracy_first") ? "AF" : null,
    ids.includes("top200_coverage_frontier") ? "CF" : null,
    ids.includes("top200_meta_reliability") ? "MR" : null,
    ids.includes("top200_primary") ? "PR" : null,
  ].filter(Boolean);
  return signature.length ? signature.join("") : "ROUTER";
}

function compareFinalModelBoardRows(left, right) {
  const leftScore = numberValue(left, "finalScore", -1);
  const rightScore = numberValue(right, "finalScore", -1);
  const leftPrior = numberValue(left, "estimatedAccuracyPriorPct", -1);
  const rightPrior = numberValue(right, "estimatedAccuracyPriorPct", -1);
  return (
    rightScore - leftScore ||
    rightPrior - leftPrior ||
    MARKETS.indexOf(left.market) - MARKETS.indexOf(right.market) ||
    left.playerName.localeCompare(right.playerName)
  );
}

function compareFinalModelPremiumTripletLegs(left, right) {
  const leftScore = numberValue(left, "finalScore", 0);
  const rightScore = numberValue(right, "finalScore", 0);
  const leftPrior = numberValue(left, "estimatedAccuracyPriorPct", 0);
  const rightPrior = numberValue(right, "estimatedAccuracyPriorPct", 0);
  return (
    right.tier.localeCompare(left.tier) ||
    Math.floor(rightScore * 20) - Math.floor(leftScore * 20) ||
    finalModelComponentSignature(right).localeCompare(finalModelComponentSignature(left)) ||
    leftScore - rightScore ||
    leftPrior - rightPrior ||
    right.playerName.localeCompare(left.playerName)
  );
}

function compareFinalModelMarketHighLegs(left, right) {
  const leftScore = numberValue(left, "finalScore", 0);
  const rightScore = numberValue(right, "finalScore", 0);
  const leftPrior = numberValue(left, "estimatedAccuracyPriorPct", 0);
  const rightPrior = numberValue(right, "estimatedAccuracyPriorPct", 0);
  return (
    left.market.localeCompare(right.market) ||
    rightScore - leftScore ||
    rightPrior - leftPrior ||
    left.playerName.localeCompare(right.playerName)
  );
}

function isSelectable(row) {
  return row.line !== "";
}

function isPairLeg(row) {
  return (row.tier === "C" || row.tier === "S") && row.market !== "AST" && numberValue(row, "finalScore", 0) >= 0.69;
}

function isTripletLeg(row) {
  return row.tier === "C" && row.market !== "AST" && numberValue(row, "finalScore", 0) >= 0.69;
}

function isLongOverLeg(row) {
  return (
    (row.tier === "C" || row.tier === "S") &&
    row.side === "OVER" &&
    LONG_CARD_MARKETS.has(row.market) &&
    numberValue(row, "finalScore", 0) >= 0.8
  );
}

function oneBestPerPlayer(rows) {
  const best = new Map();
  for (const row of rows) {
    if (!isSelectable(row)) continue;
    const key = `${row.playerId || row.playerName}|${row.teamCode}`;
    const current = best.get(key);
    if (!current || compareFinalModelBoardRows(current, row) > 0) {
      best.set(key, row);
    }
  }
  return [...best.values()].sort(compareFinalModelBoardRows);
}

function auditCards(rowsByDate, allRowCount, size, predicate, compare) {
  let candidates = 0;
  let legs = 0;
  let legWins = 0;
  let cards = 0;
  let cardWins = 0;
  let days = 0;
  let allCardDays = 0;

  for (const rows of rowsByDate.values()) {
    const filtered = oneBestPerPlayer(rows).filter(predicate).sort(compare);
    candidates += filtered.length;
    const usable = filtered.slice(0, Math.floor(filtered.length / size) * size);
    if (usable.length === 0) continue;

    days += 1;
    let dayHit = true;
    for (let index = 0; index < usable.length; index += size) {
      const card = usable.slice(index, index + size);
      const hit = card.every((row) => row.correct === "True");
      cards += 1;
      if (hit) cardWins += 1;
      dayHit = dayHit && hit;
      legs += card.length;
      legWins += card.filter((row) => row.correct === "True").length;
    }
    if (dayHit) allCardDays += 1;
  }

  return {
    candidates,
    legs,
    legRecord: `${legWins}-${legs - legWins}`,
    legAccuracyPct: pct(legWins, legs),
    legCoveragePct: pct(legs, allRowCount),
    cards,
    cardRecord: `${cardWins}-${cards - cardWins}`,
    cardAccuracyPct: pct(cardWins, cards),
    allCardDays: `${allCardDays}-${days}`,
    allCardDayPct: pct(allCardDays, days),
    avgLegsPerDay: days > 0 ? Math.round((legs / days) * 100) / 100 : 0,
    avgCardsPerDay: days > 0 ? Math.round((cards / days) * 100) / 100 : 0,
  };
}

function auditSingles(rowsByDate, allRowCount) {
  let picks = 0;
  let wins = 0;
  let days = 0;
  for (const rows of rowsByDate.values()) {
    const bestRows = oneBestPerPlayer(rows);
    if (bestRows.length === 0) continue;
    days += 1;
    picks += bestRows.length;
    wins += bestRows.filter((row) => row.correct === "True").length;
  }
  return {
    days,
    picks,
    record: `${wins}-${picks - wins}`,
    accuracyPct: pct(wins, picks),
    coveragePct: pct(picks, allRowCount),
  };
}

function main() {
  const args = parseArgs();
  const rows = parseCsv(readFileSync(args.input, "utf8"));
  const rowsByDate = new Map();
  for (const row of rows) {
    const bucket = rowsByDate.get(row.date) ?? [];
    bucket.push(row);
    rowsByDate.set(row.date, bucket);
  }

  const output = {
    input: args.input,
    dates: rowsByDate.size,
    rows: rows.length,
    singles: auditSingles(rowsByDate, rows.length),
    cards: {
      twoLeg: auditCards(rowsByDate, rows.length, 2, isPairLeg, compareFinalModelPremiumTripletLegs),
      threeLeg: auditCards(rowsByDate, rows.length, 3, isTripletLeg, compareFinalModelPremiumTripletLegs),
      fourLeg: auditCards(rowsByDate, rows.length, 4, isLongOverLeg, compareFinalModelMarketHighLegs),
      fiveLeg: auditCards(rowsByDate, rows.length, 5, isLongOverLeg, compareFinalModelMarketHighLegs),
      sixLeg: auditCards(rowsByDate, rows.length, 6, isLongOverLeg, compareFinalModelMarketHighLegs),
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
