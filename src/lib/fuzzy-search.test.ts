import { describe, expect, it } from "vitest";
import { searchProductsFuzzy } from "./fuzzy-search";

const catalog = [
  { name: "شوكولاتة داكنة بالبندق والكراميل", description: "شوكولاتة بالحليب والبندق" },
  { name: "حليب طازج كامل الدسم 1 لتر" },
  { name: "بن يمني محوج بالحبهان" },
  { name: "نوتيلا", description: "كريمة البندق بالكاكاو" },
  { name: "حلبة مغات مشروب وزن" },
  { name: "بلح المجدول علبة 3 كيلو" },
  { name: "أرز مصري عريض الحبة 5 كجم" },
  { name: "بصل أحمر", description: "بصل أحمر بارز الطعم" },
  { name: "طماطم" },
];
const names = (query: string) => searchProductsFuzzy(catalog, query, 0.35).map((p) => p.name);

describe("searchProductsFuzzy", () => {
  it("puts milk first for «لبن» and ignores letters hidden inside other words", () => {
    const result = names("لبن");
    expect(result[0]).toBe("حليب طازج كامل الدسم 1 لتر");
    expect(result).not.toContain("بن يمني محوج بالحبهان");
    expect(result).not.toContain("نوتيلا");
    expect(result).not.toContain("حلبة مغات مشروب وزن");
    expect(result).not.toContain("بلح المجدول علبة 3 كيلو");
  });

  it("finds rice for the colloquial «رز» and nothing else", () => {
    expect(names("رز")).toEqual(["أرز مصري عريض الحبة 5 كجم"]);
  });

  it("tolerates a typo in longer words", () => {
    expect(names("طمطم")).toEqual(["طماطم"]);
    expect(names("شوكلاته")[0]).toBe("شوكولاتة داكنة بالبندق والكراميل");
  });

  it("ignores the article «ال» in the query", () => {
    expect(names("الحليب")[0]).toBe("حليب طازج كامل الدسم 1 لتر");
  });

  it("returns nothing when no product matches", () => {
    expect(names("زيت")).toEqual([]);
  });
});
