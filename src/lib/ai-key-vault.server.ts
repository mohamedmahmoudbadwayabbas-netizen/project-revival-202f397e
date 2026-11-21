// خزانة مفاتيح الذكاء الاصطناعي (جدول ai_key_vault). تُقرأ على الخادم فقط بصلاحية الخدمة.
// المفاتيح لا تُحذف تلقائيًا أبدًا: الفشل يغير الحالة/التبريد فقط.
import { findPreset, OPENROUTER_FREE_MODEL } from "@/lib/ai-providers";

export type VaultKey = {
  id: string;
  provider: string;
  label: string | null;
  api_key: string;
  base_url: string | null;
  model: string | null;
  priority: number;
  status: string;
  cooldown_until: string | null;
  last_error: string | null;
  last_used_at: string | null;
  total_requests: number;
  created_at: string;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export async function listVaultKeys(): Promise<VaultKey[]> {
  try {
    const { data } = await (await db())
      .from("ai_key_vault")
      .select("*")
      .order("priority")
      .order("created_at");
    return (data ?? []) as VaultKey[];
  } catch {
    return [];
  }
}

/** المفاتيح الصالحة للاستخدام الآن (نشطة أو انتهى تبريدها). */
export function usableKeys(keys: VaultKey[], now = Date.now()): VaultKey[] {
  return keys.filter((k) => {
    if (k.status === "disabled" || k.status === "invalid") return false;
    if (k.cooldown_until && new Date(k.cooldown_until).getTime() > now) return false;
    return true;
  });
}

export type ProviderGroup = { provider: string; baseUrl: string; model: string; keys: string[] };

/** يجمع المفاتيح حسب المزود بترتيب الأولوية: Dahl ← xKiro ← … كل مجموعة تُجرب مفاتيحها بالتتابع. */
export function groupByProvider(keys: VaultKey[]): ProviderGroup[] {
  const groups = new Map<string, ProviderGroup>();
  for (const k of keys) {
    const preset = findPreset(k.provider);
    const baseUrl = (k.base_url || preset?.baseUrl || "").replace(/\/+$/, "");
    const model = k.model || preset?.modelHint || "";
    if (!baseUrl || !model) continue;
    const id = `${baseUrl}|${model}`;
    const g = groups.get(id) ?? { provider: k.provider, baseUrl, model, keys: [] };
    g.keys.push(k.api_key);
    groups.set(id, g);
  }
  return [...groups.values()];
}

export async function markVaultKey(apiKey: string, patch: Record<string, unknown>) {
  try {
    await (await db())
      .from("ai_key_vault")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("api_key", apiKey);
  } catch {
    /* لا نوقف الرد بسبب تحديث إحصائي */
  }
}

export type VaultProbeResult = "healthy" | "rate_limited" | "invalid" | "unavailable";

/** فحص قصير من الخادم فقط؛ لا يعيد المفتاح أو نص الاستجابة إلى المتصفح. */
export async function probeVaultKey(key: VaultKey): Promise<VaultProbeResult> {
  const provider = String(key.provider).toLowerCase();
  const preset = findPreset(provider);
  const base = (key.base_url || preset?.baseUrl || "").replace(/\/+$/, "");
  let model = key.model || preset?.modelHint;
  if (!key.api_key || (!base && provider !== "gemini") || (!model && provider !== "gemini"))
    return "unavailable";

  try {
    const isGemini = provider === "gemini";
    if (provider === "openrouter" && model === OPENROUTER_FREE_MODEL) {
      const { firstOpenRouterFreeModel } = await import("@/lib/ai-provider.server");
      model = await firstOpenRouterFreeModel();
    }
    const response = await fetch(
      isGemini ? "https://generativelanguage.googleapis.com/v1beta/models" : `${base}/chat/completions`,
      {
        method: isGemini ? "GET" : "POST",
        headers: isGemini
          ? { "x-goog-api-key": key.api_key, Accept: "application/json" }
          : { "Content-Type": "application/json", Authorization: `Bearer ${key.api_key}` },
        ...(isGemini
          ? {}
          : { body: JSON.stringify({ model, messages: [{ role: "user", content: "OK" }], max_tokens: 1 }) }),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    await response.body?.cancel().catch(() => {});
    if (response.ok) {
      await markVaultKey(key.api_key, {
        ...(key.status === "disabled" ? {} : { status: "active", cooldown_until: null }),
        last_error: null,
      });
      return "healthy";
    }
    if (response.status === 401 || response.status === 403) {
      await markVaultKey(key.api_key, {
        status: key.status === "disabled" ? "disabled" : "invalid",
        ...(key.status === "disabled" ? {} : { cooldown_until: null }),
        last_error: String(response.status),
      });
      return "invalid";
    }
    if (response.status === 429 || response.status === 402) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const cooldownMs = response.status === 402
        ? 60 * 60 * 1000
        : retryAfter > 0 ? Math.min(retryAfter * 1000, 10 * 60 * 1000) : 60 * 1000;
      await markVaultKey(key.api_key, {
        ...(key.status === "disabled"
          ? {}
          : {
              status: response.status === 402 ? "exhausted" : "cooling_down",
              cooldown_until: new Date(Date.now() + cooldownMs).toISOString(),
            }),
        last_error: String(response.status),
      });
      return "rate_limited";
    }
    await markVaultKey(key.api_key, { last_error: String(response.status) });
    return "unavailable";
  } catch {
    await markVaultKey(key.api_key, { last_error: "network" });
    return "unavailable";
  }
}
