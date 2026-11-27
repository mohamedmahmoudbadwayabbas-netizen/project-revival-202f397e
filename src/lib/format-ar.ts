// Shared number formatting for every price, count and time in the app.
// Brand decision (2026-11): Latin digits everywhere ("120.00 ج.م"), Arabic text around them.
// Use these helpers instead of toFixed()/toLocaleString() in JSX.

/** Arabic locale, Latin digits: Arabic month/day names with 0-9 digits. */
export const APP_LOCALE = "ar-EG-u-nu-latn";

const numFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const priceFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatNumber = (n: number | null | undefined) => numFmt.format(Number(n ?? 0));
export const formatPrice = (n: number | null | undefined) =>
  `${priceFmt.format(Number(n ?? 0))} ج.م`;
export const formatPercent = (n: number) => `${numFmt.format(n)}%`;

/** Converts Arabic-Indic / Persian digits and separators inside a string to Latin ones. */
export const toLatinDigits = (s: string) =>
  s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, ".")
    .replace(/\u066C/g, ",");

// ── Backwards-compatible names (kept so existing imports keep working). ──
// They now return Latin digits, per the brand decision above.
export const formatNumberAr = formatNumber;
export const formatPriceAr = formatPrice;
export const formatPercentAr = formatPercent;
export const toArabicDigits = toLatinDigits;
