/**
 * Nawat system prompt — shared by the browser and the server.
 * The server (gemini.functions.ts) rebuilds it for customer chat requests and
 * ignores any system prompt sent by the browser.
 */

export const NAWAT_FALLBACK_SYSTEM = `أنت «نواة»، مساعد التسوق الذكي من سوبرماركت الوادي الأخضر.
قواعد صارمة لا يجوز مخالفتها أبداً:
1. اللغة: كل تفكيرك الداخلي وردك النهائي يجب أن يكون باللغة العربية (العامية المصرية الودودة) فقط. ممنوع تماماً كتابة أي كلمة إنجليزية أو ذكر أسماء الأدوات البرمجية للعميل.
2. منع الهلوسة تماماً: ممنوع منعاً باتاً ذكر اسم أي منتج أو سعر أو كمية مخزون لم يرجع صراحة في نتيجة أداة البحث في هذه المحادثة. إذا لم تجد منتجاً في القاعدة، قل بصراحة إنه غير متوفر حالياً ولا تخترع بدائل وهمية.
3. الأسئلة العامة (مثل: إيه للعشا؟ أو في إيه للغدا؟ أو عايز حاجة للدايت): استدعِ أداة البحث بكلمة فارغة "" أو "*" أولاً لتعرف كل المنتجات المتاحة في المتجر، ثم رشّح من الموجود فعلاً فقط.
4. لو هتقترح منتجات متوفرة من نتائج البحث، اكتب ردك العادي، وفي الآخر ضيف كتلة واحدة بالشكل ده بالظبط:
\`\`\`products
[{"id":"<id من نتيجة البحث حرفيًا>","quantity":1,"reason":"سبب قصير"}]
\`\`\`
5. لا تُنهِ أي رد بدون رسالة نصية عربية واضحة ومفيدة للعميل.
6. الأسعار: اذكر سعر المنتج كما رجع من البحث فقط. لا تحسب إجمالياً أو خصماً بنفسك؛ السلة تحسب الإجمالي الصحيح.`;

export interface NawatPromptConfig {
  system_prompt_base?: string | null;
  dynamic_rules?: unknown;
  forbidden_patterns?: unknown;
}

const MAX_RULES = 30;
const MAX_RULE_LENGTH = 300;

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, MAX_RULE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_RULES);
}

/** Builds the final Nawat system prompt from the admin config and this customer's preferences. */
export function composeNawatSystemPrompt(
  config: NawatPromptConfig | null | undefined,
  preferences?: unknown,
): string {
  // Immutable store boundaries stay in force even when the admin customizes the base.
  const custom = config?.system_prompt_base?.trim();
  let prompt = NAWAT_FALLBACK_SYSTEM;
  if (custom && custom !== NAWAT_FALLBACK_SYSTEM) prompt += `\n\n### تعليمات إدارة المتجر (لا تتجاوز القواعد الثابتة أعلاه):\n${custom}`;
  if (preferences && typeof preferences === "object" && Object.keys(preferences).length) {
    prompt += `\n\n### تفضيلات هذا العميل فقط (خصّص ردك له ولا تعتبرها قاعدة عامة):\n${JSON.stringify(preferences).slice(0, 2000)}`;
  }
  const rules = cleanList(config?.dynamic_rules);
  if (rules.length) {
    prompt += `\n\n### قواعد سلوكية إضافية معتمدة من إدارة المتجر (إلزامية التنفيذ):\n${rules
      .map((rule) => `- ${rule}`)
      .join("\n")}`;
  }
  const forbidden = cleanList(config?.forbidden_patterns);
  if (forbidden.length) {
    prompt += `\n\n### أخطاء سابقة ممنوع تكرارها نهائياً:\n${forbidden.map((f) => `- ${f}`).join("\n")}`;
  }
  return prompt;
}

/** Loads the config and the customer's preferences with the caller's own (RLS-scoped) client. */
export async function loadNawatSystemPrompt(
  client: { from: (table: string) => any },
  userId: string | null,
): Promise<string> {
  try {
    const { data: config } = await client
      .from("ai_agent_configs")
      .select("system_prompt_base, dynamic_rules, forbidden_patterns")
      .eq("agent_name", "nawat")
      .maybeSingle();
    let preferences: unknown = null;
    if (userId) {
      const { data: profile } = await client
        .from("profiles")
        .select("ai_preferences")
        .eq("id", userId)
        .maybeSingle();
      preferences = profile?.ai_preferences ?? null;
    }
    return composeNawatSystemPrompt(config as NawatPromptConfig | null, preferences);
  } catch {
    return NAWAT_FALLBACK_SYSTEM;
  }
}
