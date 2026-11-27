import { describe, expect, it } from "vitest";
import { formatPrice, formatNumber, toLatinDigits } from "./format-ar";

describe("Latin numeric formatting", () => {
  it("formats the approved price precision", () => expect(formatPrice(120)).toBe("120.00 ج.م"));
  it("preserves decimal quantities", () => expect(formatNumber(1.25)).toBe("1.25"));
  it("normalizes imported Arabic digits without changing their value", () => {
    expect(toLatinDigits("١٢٠٫٠٠")).toBe("120.00");
  });
});