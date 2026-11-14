import { describe, expect, it } from "vitest";
import { INSIGHT_CACHE_MS, isInsightFresh, pickAtRiskItems, type ForecastItem } from "./insights";

describe("forecast insights", () => {
  it("sends at most 7 items, lowest coverage first, skipping items with no sales", () => {
    const items: ForecastItem[] = Array.from({ length: 10 }, (_, i) => ({ name: `p${i}`, stock: 10, daily: 1, coverageDays: 10 - i }));
    items.push({ name: "dead", stock: 5, daily: 0, coverageDays: null });
    const picked = pickAtRiskItems(items);
    expect(picked).toHaveLength(7);
    expect(picked[0].name).toBe("p9");
    expect(picked.some((p) => p.name === "dead")).toBe(false);
  });

  it("reuses a saved analysis for 24 hours only", () => {
    const now = 1_000_000_000;
    expect(isInsightFresh(now - INSIGHT_CACHE_MS + 1, now)).toBe(true);
    expect(isInsightFresh(now - INSIGHT_CACHE_MS, now)).toBe(false);
  });
});
