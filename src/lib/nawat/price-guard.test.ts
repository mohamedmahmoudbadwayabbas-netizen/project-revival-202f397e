import { describe, expect, it } from "vitest";
import { extractPriceMentions, findUnverifiedPrices, normalizeDigits } from "./price-guard";

const catalog = [
  { id: "tomato", price_per_unit: 10 },
  { id: "potato", price_per_unit: 19 },
  { id: "rice", price_per_unit: 175, old_price: 195 },
];

describe("Nawat price guard", () => {
  it("accepts unit prices, picked totals and the remaining budget", () => {
    const reply =
      "الطماطم ب 10 جنيه والبطاطس 19 ج.م، الإجمالي 39 جنيه، وباقي من ميزانيتك 461 جنيه";
    const picks = [
      { id: "tomato", quantity: 2 },
      { id: "potato", quantity: 1 },
    ];
    expect(findUnverifiedPrices(reply, catalog, picks, "ميزانية 500 جنيه")).toEqual([]);
  });

  it("accepts the old price of a discounted product", () => {
    expect(findUnverifiedPrices("كان ب 195 جنيه وبقى 175 جنيه", catalog, [], "")).toEqual([]);
  });

  it("catches invented prices written with Arabic-Indic digits or EGP", () => {
    expect(findUnverifiedPrices("الأرز ب ١٢٠ جنيه و EGP 33", catalog, [], "عايز رز")).toEqual([
      120, 33,
    ]);
  });

  it("reads thousands separators and Arabic decimal marks", () => {
    expect(extractPriceMentions("السعر 1,250.50 جنيه")).toEqual([1250.5]);
    expect(normalizeDigits("١٢٫٥")).toBe("12.5");
  });
});
