import { describe, expect, it } from "vitest";
import type { Product } from "./cart-context";
import { extractProductDetails, formatProductDescriptionWithMetadata } from "./product-metadata";

const detergent: Product = {
  id: "detergent", name: "برسيل 10 ك", category_id: null, description: null,
  price_per_unit: 645, old_price: null, image_url: null, is_by_weight: false,
  unit_label: "قطعة", is_popular: false, is_on_sale: false,
};

describe("product metadata provenance", () => {
  it("does not invent nutritional values for a detergent without data", () => {
    expect(extractProductDetails(detergent).nutritionalInfo).toEqual({
      calories: "", protein: "", carbs: "", fiber: "", fats: "",
    });
  });
  it("does not invent source, storage, characteristics or cooking advice", () => {
    const details = extractProductDetails(detergent);
    expect(details.characteristics).toEqual([]);
    expect(details.cookingTip).toBe("");
    expect(details.storageInstructions).toBe("");
    expect(details.originSource).toBe("");
  });
  it("preserves supplied nutrition without filling absent fields", () => {
    expect(extractProductDetails({ ...detergent, nutritional_info: { calories: "25" } }).nutritionalInfo)
      .toEqual({ calories: "25", protein: "", carbs: "", fiber: "", fats: "" });
  });
  it("round-trips explicitly stored metadata", () => {
    const description = formatProductDescriptionWithMetadata("تفاصيل مسجلة", {
      nutritionalInfo: { calories: "25", protein: "2" }, characteristics: ["بيانات معتمدة"],
    });
    const details = extractProductDetails({ ...detergent, description });
    expect(details.nutritionalInfo.calories).toBe("25");
    expect(details.nutritionalInfo.protein).toBe("2");
    expect(details.nutritionalInfo.fats).toBe("");
    expect(details.characteristics).toEqual(["بيانات معتمدة"]);
  });
});