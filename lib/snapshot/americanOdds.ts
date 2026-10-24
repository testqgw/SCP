// American odds are not on a linear scale: -110 and +100 are 0.024 apart in probability but 210 apart
// as numbers, so averaging the two middle quotes of an even-sized book list gives values like -5.
// Consensus prices are therefore taken as a median in implied-probability space.

export function isValidAmericanPrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) >= 100;
}

export function americanToImpliedProbability(price: number | null | undefined): number | null {
  if (!isValidAmericanPrice(price)) return null;
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

export function impliedProbabilityToAmerican(probability: number): number | null {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return null;
  return probability >= 0.5 ? (-100 * probability) / (1 - probability) : (100 * (1 - probability)) / probability;
}

export function medianAmericanPrice(values: Array<number | null | undefined>): number | null {
  const quotes = values
    .filter(isValidAmericanPrice)
    .map((price) => ({ price, probability: americanToImpliedProbability(price) as number }))
    .sort((left, right) => left.probability - right.probability);
  if (quotes.length === 0) return null;
  const middle = Math.floor(quotes.length / 2);
  if (quotes.length % 2 === 1) return quotes[middle].price;
  const price = impliedProbabilityToAmerican((quotes[middle - 1].probability + quotes[middle].probability) / 2);
  return price == null ? null : Math.round(price * 100) / 100;
}
