import type { Product } from "@/lib/cart-context";
import { DEFAULT_GEMINI_MODEL } from "@/lib/gemini-config";
import { generateGeminiContent } from "@/lib/gemini.functions";
import { normalizeProduct } from "@/lib/store-data-hooks";
import { supabase } from "@/integrations/supabase/client";
import { toolSearchProducts } from "@/services/aiTools/coreCatalogTools";
import { AI_TOOL_SUITE } from "@/services/aiTools/toolDefinitions";
import { formatPrice } from "@/lib/format-ar";
import { findUnverifiedPrices } from "./price-guard";
import { composeNawatSystemPrompt, NAWAT_FALLBACK_SYSTEM } from "./system-prompt";
import {
  extractProductPicks,
  recoverAnswerFromThinking,
  splitThinking,
  stripLeakedPlanning,
} from "./chat-parse";

export interface NawatToolRun {
  query: string;
  ok: boolean;
  count: number;
}

export interface NawatPick {
  product: Product;
  quantity: number;
  reason: string;
}

export interface NawatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  tools?: NawatToolRun[];
  products?: NawatPick[];
  error?: boolean;
  interactionId?: string;
  rating?: 1 | -1;
  createdAt: string;
}

const BASE_SEARCH_DECL = AI_TOOL_SUITE.find((t) => t.name === "searchProducts")?.declaration;
const MAX_STEPS = 5;

/** يكتشف الإشارات الضمنية من رسالة العميل (تصحيح، غضب، شكوى لغة) */
export function detectUserImplicitSignal(userText: string): "user_correction" | "neutral" {
  const frustrationRegex =
    /(بتألف|من دماغك|مش موجود|كذب|غلط|كلمني عربي|بالعربي|مش فاهم|انت متاكد|بختبرك|مش صح)/i;
  return frustrationRegex.test(userText) ? "user_correction" : "neutral";
}

/**
 * حارس منع الهلوسة الفوري (Real-Time Price & Fact Guardrail):
 * كل مبلغ مكتوب بجانب عملة في الرد يجب أن يكون مفسَّراً من بيانات حقيقية
 * (سعر منتج × كمية منطقية، أو إجمالي المنتجات المقترحة، أو رقم كتبه العميل).
 */
function enforceRealTimePriceGuardrail(
  replyText: string,
  catalog: Map<string, Product>,
  picks: Array<{ id: string; quantity: number }>,
  userText: string,
): { safeText: string; triggered: boolean } {
  const unverified = findUnverifiedPrices(replyText, catalog.values(), picks, userText);
  if (!unverified.length) return { safeText: replyText, triggered: false };

  const availableItems = [...catalog.values()].filter((p) => Number(p.stock_quantity) > 0);
  if (availableItems.length === 0) {
    return {
      safeText:
        "معلش، دورت في المتجر حالياً ومالقيتش منتجات مطابقة متوفرة في المخزون دلوقتي. تحب أدورلك على حاجة تانية؟",
      triggered: true,
    };
  }

  const pickedIds = new Set(picks.map((p) => p.id));
  const ordered = [
    ...availableItems.filter((p) => pickedIds.has(p.id)),
    ...availableItems.filter((p) => !pickedIds.has(p.id)),
  ];
  const verifiedList = ordered
    .slice(0, 6)
    .map((p) => `• **${p.name_ar || p.name}** — ${formatPrice(p.price_per_unit)}`)
    .join("\n");

  return {
    safeText: `دي المنتجات المتوفرة حالياً بأسعارها الفعلية من المتجر:\n\n${verifiedList}\n\nتقدر تضيف اللي يناسبك للسلة من الكروت تحت، والإجمالي هيظهر في السلة.`,
    triggered: true,
  };
}

/** يجلب إعدادات نواة الحية والقواعد السلوكية المعتمدة من حوكمة الوكلاء */
async function loadDynamicNawatRuntime() {
  try {
    const [{ data: config }, { data: tools }] = await Promise.all([
      supabase
        .from("ai_agent_configs" as never)
        .select("system_prompt_base, dynamic_rules, forbidden_patterns, strict_price_guard")
        .eq("agent_name", "nawat")
        .maybeSingle(),
      supabase
        .from("ai_tool_registry" as never)
        .select("tool_name, description_ar, runtime_hints, is_enabled")
        .eq("agent_name", "nawat"),
    ]);

    const cfg = config as {
      system_prompt_base?: string;
      dynamic_rules?: string[];
      forbidden_patterns?: string[];
      strict_price_guard?: boolean;
    } | null;

    // تفضيلات العميل الفردية (لا تُعمَّم على باقي العملاء أبداً)
    let preferences: unknown = null;
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user) {
        const { data: prof } = await (supabase as any)
          .from("profiles")
          .select("ai_preferences")
          .eq("id", auth.user.id)
          .maybeSingle();
        preferences = prof?.ai_preferences ?? null;
      }
    } catch {
      /* preferences are optional */
    }
    // The server rebuilds the same prompt for customers; this copy keeps admins' previews accurate.
    const fullPrompt = composeNawatSystemPrompt(cfg, preferences);

    const searchToolMeta = ((tools as any[]) ?? []).find((t) => t.tool_name === "searchProducts");
    const dynamicSearchDecl = BASE_SEARCH_DECL
      ? {
          ...BASE_SEARCH_DECL,
          description: [
            searchToolMeta?.description_ar || BASE_SEARCH_DECL.description,
            searchToolMeta?.runtime_hints ? `تلميحات بحث مهمة: ${searchToolMeta.runtime_hints}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        }
      : undefined;

    return {
      systemInstruction: fullPrompt,
      searchDeclaration: dynamicSearchDecl,
      strictPriceGuard: cfg?.strict_price_guard !== false,
    };
  } catch {
    return {
      systemInstruction: NAWAT_FALLBACK_SYSTEM,
      searchDeclaration: BASE_SEARCH_DECL,
      strictPriceGuard: true,
    };
  }
}

async function callModel(
  contents: unknown[],
  runtime: { systemInstruction: string; searchDeclaration?: unknown },
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await generateGeminiContent({
        data: {
          purpose: "chat",
          model: DEFAULT_GEMINI_MODEL,
          contents,
          config: {
            systemInstruction: runtime.systemInstruction,
            tools: [{ functionDeclarations: runtime.searchDeclaration ? [runtime.searchDeclaration] : [] }],
            toolConfig: { functionCallingConfig: { mode: "AUTO" } },
            thinkingConfig: { includeThoughts: true },
          },
        } as never,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!/503|overload|high demand|unavailable/i.test(msg) || attempt === 2) throw error;
      await new Promise((r) => setTimeout(r, 1200 * 2 ** attempt));
    }
  }
  throw new Error("unavailable");
}

function toContents(history: NawatMessage[]) {
  const valid = history.filter((m) => !m.error && m.content.trim());
  const earlier = valid.slice(0, -40);
  const recent = valid.slice(-40);
  const contents = recent.map((m) => {
    let text = m.content;
    if (m.products?.length) {
      text += `\n[منتجات حقيقية اقترحتها: ${m.products
        .map((p) => `${p.product.name_ar || p.product.name} ×${p.quantity} (id: ${p.product.id})`)
        .join("، ")}]`;
    }
    return { role: m.role === "assistant" ? "model" : "user", parts: [{ text }] };
  });
  if (earlier.length) {
    const summary = earlier
      .slice(-12)
      .map((m) => `${m.role === "user" ? "العميل" : "نواة"}: ${m.content.slice(0, 180)}`)
      .join(" | ");
    contents.unshift({
      role: "user",
      parts: [{ text: `[ملخص بداية المحادثة للحفاظ على السياق]: ${summary}` }],
    });
  }
  return contents;
}

export async function runNawatTurn(
  history: NawatMessage[],
  onActivity: (label: string) => void,
  onThought?: (thinking: string) => void,
): Promise<
  Omit<NawatMessage, "id" | "createdAt" | "role"> & {
    guardrailTriggered?: boolean;
    implicitSignal?: string;
  }
> {
  const runtime = await loadDynamicNawatRuntime();
  const lastUserText = history.at(-1)?.content ?? "";
  const implicitSignal = detectUserImplicitSignal(lastUserText);

  const contents: any[] = toContents(history);
  const catalog = new Map<string, Product>();
  const tools: NawatToolRun[] = [];
  const thoughts: string[] = [];
  let finalText = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    onActivity(
      step === 0
        ? "بيقرأ طلبك ويفهم احتياجك"
        : step === 1
          ? "بيراجع المنتجات المتوفرة في المتجر"
          : "بيجهزلك الرد والترشيحات المناسبة",
    );
    const res: any = await callModel(contents, runtime);
    const parts: any[] = res?.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) if (p?.thought && typeof p.text === "string") thoughts.push(p.text);
    if (thoughts.length) onThought?.(thoughts.join("\n\n"));

    const calls = parts.filter((p) => p?.functionCall?.name);
    if (!calls.length) {
      finalText = parts
        .filter((p) => typeof p?.text === "string" && !p.thought)
        .map((p) => p.text)
        .join("");
      if (!finalText && typeof res?.text === "string") finalText = res.text;
      break;
    }

    contents.push({ role: "model", parts });
    const responses: any[] = [];
    for (const call of calls) {
      const args = (call.functionCall.args ?? {}) as { query?: string; limit?: number };
      const query = String(args.query ?? "").slice(0, 60);
      onActivity(`بيدوّر في المتجر على «${query || "كل المنتجات المتاحة"}»`);
      const out =
        call.functionCall.name === "searchProducts"
          ? await toolSearchProducts(args)
          : { tool: call.functionCall.name, ok: false, messageAr: "أداة غير متاحة", data: null };
      const rows: any[] = (out.data as { results?: any[] } | null)?.results ?? [];
      for (const row of rows) {
        const product = normalizeProduct(row);
        catalog.set(product.id, product);
      }
      tools.push({ query, ok: out.ok === true, count: rows.length });
      responses.push({
        functionResponse: {
          name: call.functionCall.name,
          response: { ok: out.ok, messageAr: out.messageAr, data: out.data ?? null },
        },
      });
    }
    contents.push({ role: "user", parts: responses });
  }

  const split = splitThinking(finalText);
  if (split.thinking) thoughts.push(split.thinking);
  let visible = split.text;
  if (!visible && thoughts.length) {
    const rec = recoverAnswerFromThinking(thoughts.pop() ?? "");
    if (rec.thinking) thoughts.push(rec.thinking);
    visible = rec.text;
  }
  const cleaned = stripLeakedPlanning(visible);
  if (cleaned.leaked) thoughts.push(cleaned.leaked);
  visible = cleaned.text;
  onThought?.(thoughts.join("\n\n"));

  const { text: rawExtractedText, picks } = extractProductPicks(visible);

  // تطبيق حارس منع الهلوسة الفوري قبل عرض الرد للعميل
  let safeReplyText = rawExtractedText;
  let guardrailTriggered = false;
  if (runtime.strictPriceGuard && safeReplyText) {
    const guard = enforceRealTimePriceGuardrail(safeReplyText, catalog, picks, lastUserText);
    safeReplyText = guard.safeText;
    guardrailTriggered = guard.triggered;
  }

  const mentioned = [...catalog.values()]
    .filter((product) => {
      const name = product.name_ar || product.name;
      return name.length > 1 && safeReplyText.includes(name);
    })
    .slice(0, 8)
    .map((product) => ({ id: product.id, quantity: 1, reason: "متوفر في المتجر" }));

  const resolvedPicks = picks.length ? picks : mentioned;
  const products: NawatPick[] = [];
  for (const pick of resolvedPicks) {
    const product = catalog.get(pick.id);
    if (product && Number(product.stock_quantity) > 0) {
      products.push({ product, quantity: pick.quantity, reason: pick.reason });
    }
  }

  return {
    content:
      safeReplyText ||
      (products.length
        ? "دي المنتجات المتوفرة حالياً في المتجر وتناسب طلبك:"
        : "أهلاً بيك! قولّي بتدور على إيه تحديداً وهشوفلك المتوفر في المتجر حالياً."),
    thinking:
      thoughts
        .map((t) => t.trim())
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 6000) || undefined,
    tools: tools.length ? tools : undefined,
    products: products.length ? products : undefined,
    guardrailTriggered,
    implicitSignal: guardrailTriggered ? "hallucination_blocked" : implicitSignal,
  };
}
