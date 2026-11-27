/**
 * Nawat price guard: every amount the model writes next to a currency must be
 * explainable from real catalog data, otherwise the reply is replaced.
 *
 * Allowed amounts:
 *  - a product's unit price or old price, times a quantity up to 10 (¼ steps);
 *  - each picked line (price × the quantity Nawat picked);
 *  - the total of the products Nawat actually picked (and its running sums);
 *  - any number the customer wrote in the message (e.g. "ميزانية 500 جنيه"),
 *    and that number minus the picked total (the remaining budget).
 */

export interface GuardProduct {
  id: string;
  price_per_unit: number;
  old_price?: number | null;
}

export interface GuardPick {
  id: string;
  quantity: number;
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

/** Converts Arabic-Indic / Persian digits and separators to plain ASCII. */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

const CURRENCY_AFTER = "(?:جنيه|جنية|جنيهات|ج\\.\\s?م|ج\\s?م|EGP|LE|L\\.E)";
const AMOUNT = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)";
const PRICE_PATTERNS = [
  new RegExp(`${AMOUNT}\\s*${CURRENCY_AFTER}`, "gi"),
  new RegExp(`(?:EGP|LE)\\s*${AMOUNT}`, "gi"),
];

/** Every currency amount mentioned in the text, as numbers. */
export function extractPriceMentions(text: string): number[] {
  const normalized = normalizeDigits(text);
  const found: number[] = [];
  for (const pattern of PRICE_PATTERNS) {
    for (const match of normalized.matchAll(pattern)) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value)) found.push(value);
    }
  }
  return found;
}

function numbersIn(text: string): number[] {
  return [...normalizeDigits(text).matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.011;

export function buildAllowedAmounts(
  catalog: Iterable<GuardProduct>,
  picks: GuardPick[],
  userText: string,
): number[] {
  const allowed: number[] = [];
  const byId = new Map<string, GuardProduct>();
  for (const product of catalog) {
    byId.set(product.id, product);
    for (const base of [Number(product.price_per_unit), Number(product.old_price ?? NaN)]) {
      if (!Number.isFinite(base) || base <= 0) continue;
      for (let q = 0.25; q <= 10; q += 0.25) allowed.push(+(base * q).toFixed(2));
    }
  }
  let running = 0;
  for (const pick of picks) {
    const product = byId.get(pick.id);
    if (!product) continue;
    const line = Number(product.price_per_unit) * Number(pick.quantity || 1);
    allowed.push(+line.toFixed(2));
    running = +(running + line).toFixed(2);
    allowed.push(running);
  }
  const userNumbers = numbersIn(userText);
  allowed.push(...userNumbers);
  // "باقي من ميزانيتك" = what the customer gave minus the picked total.
  if (running > 0) for (const n of userNumbers) allowed.push(+(n - running).toFixed(2));
  return allowed;
}

/** Returns the amounts in the reply that no real data explains. */
export function findUnverifiedPrices(
  replyText: string,
  catalog: Iterable<GuardProduct>,
  picks: GuardPick[],
  userText: string,
): number[] {
  const mentions = extractPriceMentions(replyText);
  if (!mentions.length) return [];
  const allowed = buildAllowedAmounts(catalog, picks, userText);
  return mentions.filter((value) => !allowed.some((ok) => close(ok, value)));
}
