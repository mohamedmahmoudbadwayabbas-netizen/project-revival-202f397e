import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_INSIGHT_ITEMS, type ForecastItem } from "./insights";

export const generateForecastInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { items: ForecastItem[] }) => {
    const items = Array.isArray(input?.items) ? input.items.slice(0, MAX_INSIGHT_ITEMS) : [];
    return {
      items: items.map((i) => ({
        name: String(i.name ?? "").slice(0, 60),
        stock: Number(i.stock) || 0,
        daily: Number(i.daily) || 0,
        coverageDays: i.coverageDays == null ? null : Number(i.coverageDays),
      })),
    };
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    if (data.items.length === 0) return { text: "لا توجد مبيعات كافية للتحليل." };

    const lines = data.items
      .map((i) => `${i.name}|مخزون ${i.stock}|يومي ${i.daily.toFixed(1)}|تغطية ${i.coverageDays == null ? "-" : i.coverageDays.toFixed(1)} يوم`)
      .join("\n");
    const { generatePlainText } = await import("@/lib/ai-provider.server");
    const text = await generatePlainText(
      `أصناف متجر بقالة مصري (آخر 30 يوم):\n${lines}\nاكتب 3-4 توصيات قصيرة جدا: كمية الشراء المقترحة لكل صنف معرض للنقص، وأي صنف يحتاج انتباه. بدون مقدمات.`,
      { system: "أنت مساعد مخزون. عربي مختصر، نقاط فقط.", maxTokens: 300, temperature: 0.3, deadlineMs: 20000 },
    );
    return { text };
  });
