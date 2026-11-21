import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Activity, ArrowUpRight, ClipboardPaste, KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTrigger,
  DialogTitle,
} from "@/components/ui/dialog";
import { AI_PROVIDER_PRESETS, findPreset, OPENROUTER_FREE_MODEL } from "@/lib/ai-providers";
import {
  addVaultKeys,
  bulkImportVaultKeys,
  checkVaultKey,
  checkVaultKeys,
  listVault,
  updateVaultKey,
} from "@/lib/ai-vault.functions";

type Row = Awaited<ReturnType<typeof listVault>>[number];

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "سليم", cls: "bg-primary/10 text-primary" },
  cooling_down: { label: "محدود مؤقتًا", cls: "bg-accent/15 text-accent-foreground" },
  exhausted: { label: "نفد الرصيد", cls: "bg-destructive/10 text-destructive" },
  invalid: { label: "مرفوض", cls: "bg-destructive/10 text-destructive" },
  disabled: { label: "موقوف", cls: "bg-muted text-muted-foreground" },
};

const GUIDE_IDS = ["gemini", "groq", "cerebras", "mistral", "openrouter"] as const;
const GUIDE_COPY: Record<(typeof GUIDE_IDS)[number], string> = {
  gemini: "حصة مجانية تختلف حسب النموذج والمشروع؛ راجع الحد الحالي في AI Studio.",
  groq: "خطة مجانية سريعة مع حدود استخدام تتغير حسب النموذج والحساب.",
  cerebras: "خطة مجانية للتجربة؛ السرعة والحصة الفعلية حسب النموذج والحمل.",
  mistral: "رصيد التجربة وحدود الحساب تتغير؛ تحقق من سعر النموذج قبل اختياره.",
  openrouter: "للاستخدام المجاني اختر نموذجًا بسعر صفر في كتالوج OpenRouter.",
};

export function AiKeyVault() {
  const list = useServerFn(listVault);
  const add = useServerFn(addVaultKeys);
  const bulkImport = useServerFn(bulkImportVaultKeys);
  const update = useServerFn(updateVaultKey);
  const check = useServerFn(checkVaultKeys);
  const probe = useServerFn(checkVaultKey);
  const [rows, setRows] = useState<Row[]>([]);
  const [provider, setProvider] = useState("dahl");
  const [keys, setKeys] = useState("");
  const [model, setModel] = useState("");
  const [priority, setPriority] = useState("100");
  const [bulkText, setBulkText] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>("load");

  const refresh = useCallback(() => list().then(setRows).catch(() => {}), [list]);
  useEffect(() => { refresh().finally(() => setBusy(null)); }, [refresh]);

  const onAdd = async () => {
    setBusy("add");
    try {
      const r = await add({ data: { provider, keys, model: model || undefined, priority: Number(priority) || 100 } });
      toast.success(`أُضيف ${r.added} مفتاح جديد (من ${r.total})`);
      setKeys("");
      await refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const onCheck = async () => {
    setBusy("check");
    try { const r = await check(); toast.success(`${r.ok} من ${r.total} مفاتيح تعمل الآن`); await refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const onBulkImport = async () => {
    setBusy("bulk");
    try {
      const r = await bulkImport({ data: { text: bulkText } });
      toast.success(`أُضيف ${r.added} من ${r.total} مفتاح معروف؛ تم تجاوز ${r.ignored} سطرًا غير معروف`);
      setBulkText("");
      setBulkOpen(false);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const onProbe = async (row: Row) => {
    setBusy(`probe:${row.id}`);
    try {
      const result = await probe({ data: { id: row.id } });
      const message = result.status === "healthy"
        ? "المفتاح سليم"
        : result.status === "rate_limited"
          ? "المزود حدّ المعدل أو الحصة مؤقتًا"
          : result.status === "invalid"
            ? "المفتاح مرفوض"
            : "تعذر إكمال الفحص؛ بقيت الحالة السابقة كما هي";
      result.status === "healthy" ? toast.success(message) : toast.warning(message);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const toggle = async (r: Row) => {
    await update({ data: { id: r.id, status: r.status === "disabled" ? "active" : "disabled" } });
    await refresh();
  };

  return (
    <section className="admin-lux space-y-5 rounded-2xl border border-border bg-card p-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-bold text-foreground">خزانة المفاتيح ({rows.length})</h3>
            <p className="text-sm text-muted-foreground">
              ضع أي عدد من المفاتيح. لو مفتاح خلص أو اتقفل ينتقل المتجر للي بعده فورًا. المفاتيح لا تُحذف أبدًا.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy !== null} className="gap-1">
                <ClipboardPaste className="h-4 w-4" /> استيراد جماعي / لصق .env
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl" className="admin-lux max-h-[90vh] overflow-y-auto rounded-3xl">
              <DialogHeader>
                <DialogTitle>استيراد مفاتيح متعددة</DialogTitle>
                <DialogDescription>
                  الصق مفاتيح منفردة أو أسطرًا من ملف .env. تتم عملية الحفظ عبر دالة خادم محمية، ولا تُعاد المفاتيح في نتيجة الاستيراد.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                dir="ltr"
                rows={10}
                autoComplete="off"
                spellCheck={false}
                placeholder={'GEMINI_API_KEY=AIzaSy…\nGROQ_API_KEY=gsk_…\nCEREBRAS_API_KEY=csk-…\nOPENROUTER_API_KEY=sk-or-v1-…\nMISTRAL_API_KEY=…'}
              />
              <p className="text-xs text-muted-foreground">
                يتعرف النظام على Google وGroq وCerebras وOpenRouter وMistral. الأسطر غير المعروفة لا تُحفظ، والمكررات تُتجاهل.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={busy === "bulk"}>إلغاء</Button>
                <Button onClick={onBulkImport} disabled={busy !== null || !bulkText.trim()}>
                  {busy === "bulk" && <Loader2 className="h-4 w-4 animate-spin" />} حفظ المفاتيح المعروفة
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" onClick={onCheck} disabled={busy !== null} className="gap-1">
            {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} فحص الكل
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h4 className="font-semibold">روابط الحصول على مفاتيح الخطط المجانية</h4>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {GUIDE_IDS.map((id) => {
            const providerPreset = findPreset(id);
            if (!providerPreset?.keyUrl) return null;
            return (
              <a
                key={id}
                href={providerPreset.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/50 hover:bg-primary/[0.03]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{providerPreset.label.split(" (")[0]}</span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{GUIDE_COPY[id]}</p>
              </a>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          رابط المفتاح المجاني لا يعني أن كل نماذج المزود مجانية؛ راجع السعر والحصة في لوحة المزود قبل حفظ نموذج صريح.
        </p>
        <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-primary"><Activity className="h-4 w-4" /> Kilo :free — شبكة أمان بلا مفتاح</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            تُستخدم بعد غياب المفاتيح أو استنفاد الحصة/تعطل المزود، وتُكتشف النماذج المجانية من قائمة Kilo الحية. قد تتغير الحصة والتوافر، وقد تُسجل المطالبات في مسار :free وفق مرجع FreeLLMAPI؛ لا ترسل بيانات سرية.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            LLM7 يتطلب رمز API بحسب <a href="https://docs.llm7.io/quickstart" target="_blank" rel="noopener noreferrer" className="underline">وثائقه الحالية</a>، لذلك لا يدخل في المسار المجهول.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={provider}
          onChange={(e) => setProvider(e.target.value)}>
          {AI_PROVIDER_PRESETS.filter((p) => p.id !== "gemini").map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <Input value={model} onChange={(e) => setModel(e.target.value)} dir="ltr"
          placeholder={`النموذج: ${provider === "openrouter" ? "مجاني تلقائي" : findPreset(provider)?.modelHint ?? ""}`} />
        <Input value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric"
          placeholder="الأولوية (الأصغر أولًا)" />
      </div>
      <Textarea value={keys} onChange={(e) => setKeys(e.target.value)} dir="ltr" rows={4}
        placeholder="الصق مفتاحًا أو مئة مفتاح — كل مفتاح في سطر" autoComplete="off" />
      <Button onClick={onAdd} disabled={busy !== null || !keys.trim()} className="gap-2">
        {busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />} حفظ في الخزانة
      </Button>

      <div className="divide-y divide-border rounded-xl border border-border">
        {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">لا توجد مفاتيح بعد.</p>}
        {rows.map((r) => {
          const st = STATUS[r.status] ?? STATUS.active;
          const rowModel = r.model || findPreset(r.provider)?.modelHint;
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <span className="font-semibold">{findPreset(r.provider)?.label.split(" (")[0] ?? r.provider}</span>
              <code dir="ltr" className="text-muted-foreground">{r.masked}</code>
              <span dir="ltr" className="text-muted-foreground">
                {rowModel === OPENROUTER_FREE_MODEL ? "نموذج مجاني تلقائي" : rowModel}
              </span>
              <span className="text-muted-foreground">أولوية {r.priority}</span>
              <span className={`rounded-full px-2 py-0.5 text-[13px] font-medium ${st.cls}`}>{st.label}</span>
              <div className="ms-auto flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => onProbe(r)} disabled={busy !== null || r.status === "disabled"} className="gap-1">
                  {busy === `probe:${r.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />} فحص الآن
                </Button>
                <Button size="sm" variant="ghost" onClick={() => toggle(r)} disabled={busy !== null}>
                  {r.status === "disabled" ? "تشغيل" : "إيقاف"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
