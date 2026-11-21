import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("خزانة المفاتيح متاحة لمسؤول المتجر فقط.");
}
async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
const mask = (k: string) => (k.length > 10 ? `${k.slice(0, 5)}••••${k.slice(-4)}` : "••••");

export const listVault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { listVaultKeys } = await import("@/lib/ai-key-vault.server");
    return (await listVaultKeys()).map((k) => ({
      id: k.id, provider: k.provider, label: k.label, masked: mask(k.api_key), model: k.model,
      base_url: k.base_url, priority: k.priority, status: k.status, cooldown_until: k.cooldown_until,
      last_error: k.last_error, last_used_at: k.last_used_at,
    }));
  });

export const addVaultKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      provider: z.string().trim().min(1).max(40),
      keys: z.string().max(200000),
      model: z.string().trim().max(200).optional(),
      baseUrl: z.string().trim().max(500).optional(),
      priority: z.number().int().min(0).max(10000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { splitKeys } = await import("@/lib/ai-provider.server");
    const keys = splitKeys(data.keys).filter((k) => k.length >= 8 && k.length <= 2000);
    if (!keys.length) throw new Error("لم أجد أي مفتاح صالح في النص.");
    const rows = keys.map((api_key) => ({
      provider: data.provider, api_key, model: data.model || null,
      base_url: data.baseUrl || null, priority: data.priority ?? 100,
    }));
    const { error, data: inserted } = await (await db())
      .from("ai_key_vault")
      .upsert(rows, { onConflict: "provider,api_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error("تعذر حفظ المفاتيح.");
    return { added: inserted?.length ?? 0, total: keys.length };
  });

export const bulkImportVaultKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ text: z.string().trim().min(1).max(200000) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const [{ parseBulkVaultKeyImport, defaultVaultPriority }, { findPreset }] = await Promise.all([
      import("@/lib/ai-provider.server"),
      import("@/lib/ai-providers"),
    ]);
    const { rows, ignored } = parseBulkVaultKeyImport(data.text);
    if (!rows.length) throw new Error("لم أجد مفاتيح معروفة في النص المرسل.");
    if (rows.length > 500) throw new Error("الحد الأقصى للاستيراد في المرة الواحدة 500 مفتاح.");
    const payload = rows.map(({ provider, api_key }) => ({
      provider,
      api_key,
      model: findPreset(provider)?.modelHint || null,
      base_url: findPreset(provider)?.baseUrl || null,
      priority: defaultVaultPriority(provider),
    }));
    const { error, data: inserted } = await (await db())
      .from("ai_key_vault")
      .upsert(payload, { onConflict: "provider,api_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error("تعذر حفظ المفاتيح المستوردة.");
    return { added: inserted?.length ?? 0, total: rows.length, ignored };
  });

export const updateVaultKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["active", "disabled"]).optional(),
      priority: z.number().int().min(0).max(10000).optional(),
      model: z.string().trim().max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { id, ...patch } = data;
    const extra = patch.status === "active" ? { cooldown_until: null, last_error: null } : {};
    await (await db()).from("ai_key_vault").update({ ...patch, ...extra, updated_at: new Date().toISOString() }).eq("id", id);
    return { ok: true };
  });

/** فحص صحة كل المفاتيح وتحديث حالتها (لا يحذف أي مفتاح). */
export const checkVaultKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { listVaultKeys, probeVaultKey } = await import("@/lib/ai-key-vault.server");
    const keys = (await listVaultKeys()).filter((k) => k.status !== "disabled");
    let ok = 0;
    for (let i = 0; i < keys.length; i += 8) {
      const results = await Promise.all(keys.slice(i, i + 8).map(probeVaultKey));
      ok += results.filter((result) => result === "healthy").length;
    }
    return { ok, total: keys.length };
  });

export const checkVaultKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { listVaultKeys, probeVaultKey } = await import("@/lib/ai-key-vault.server");
    const key = (await listVaultKeys()).find((item) => item.id === data.id);
    if (!key) throw new Error("المفتاح غير موجود في الخزانة.");
    const status = await probeVaultKey(key);
    return { status };
  });
