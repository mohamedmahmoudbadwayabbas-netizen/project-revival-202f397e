import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, PackageX, ShieldCheck, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface WadiPulse {
  pendingOrders: number;
  lowStock: number;
  pendingProposals: number;
  todaySales: number;
  todayOrders: number;
  spark: number[];
}

const db = supabase as any;

export async function fetchWadiPulse(): Promise<WadiPulse> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const week = new Date(Date.now() - 6 * 86400000);
  week.setHours(0, 0, 0, 0);
  const [pending, products, proposals, orders] = await Promise.all([
    db.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending", "new"]),
    db.from("products").select("stock,stock_quantity").limit(2000),
    db.from("ai_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("orders").select("total_price,created_at,status").gte("created_at", week.toISOString()).limit(2000),
  ]);
  const lowStock = (products.data ?? []).filter(
    (p: any) => Number(p.stock_quantity ?? p.stock ?? 0) <= 5,
  ).length;
  const spark = Array(7).fill(0);
  let todaySales = 0;
  let todayOrders = 0;
  for (const o of orders.data ?? []) {
    if (o.status === "cancelled") continue;
    const d = new Date(o.created_at);
    const idx = Math.min(6, Math.max(0, Math.floor((d.getTime() - week.getTime()) / 86400000)));
    spark[idx] += 1;
    if (d >= start) {
      todaySales += Number(o.total_price ?? 0);
      todayOrders += 1;
    }
  }
  return {
    pendingOrders: pending.count ?? 0,
    lowStock,
    pendingProposals: proposals.count ?? 0,
    todaySales,
    todayOrders,
    spark,
  };
}

export function useWadiPulse() {
  const [pulse, setPulse] = useState<WadiPulse | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetchWadiPulse().then((p) => alive && setPulse(p)).catch(() => {});
    load();
    const t = window.setInterval(load, 60000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  return pulse;
}

function Spark({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${28 - (v / max) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" className="h-7 w-20 text-primary" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

const fmt = (n: number) => new Intl.NumberFormat("ar-EG").format(Math.round(n));

export function WadiPulseBar({
  onAsk,
  className,
}: {
  onAsk?: (prompt: string) => void;
  className?: string;
}) {
  const pulse = useWadiPulse();
  const items = [
    {
      label: "طلبات تحتاج تدخل",
      value: pulse?.pendingOrders,
      icon: AlertTriangle,
      tone: "text-destructive bg-destructive/10",
      prompt: "/طلبات اعرض الطلبات المعلقة التي تحتاج تدخلي الآن ورتبها حسب الأقدم",
      to: "/admin/orders",
    },
    {
      label: "نواقص حرجة",
      value: pulse?.lowStock,
      icon: PackageX,
      tone: "text-gold-foreground bg-gold/25",
      prompt: "/مخزون اعرض الأصناف الناقصة أو القريبة من النفاد واقترح كميات إعادة الطلب",
      to: "/admin/replenishment",
    },
    {
      label: "قرارات بانتظارك",
      value: pulse?.pendingProposals,
      icon: ShieldCheck,
      tone: "text-primary bg-primary/10",
      prompt: "لخص لي اقتراحات الحوكمة المعلقة مع مستوى المخاطرة لكل منها",
      to: "/admin/governance",
    },
    {
      label: `مبيعات اليوم · ${pulse ? fmt(pulse.todayOrders) : "—"} طلب`,
      value: pulse?.todaySales,
      suffix: " ج.م",
      icon: TrendingUp,
      tone: "text-primary bg-secondary",
      prompt: "/تقرير حلل مبيعات اليوم مقارنة بآخر 7 أيام وأعطني 3 توصيات",
      to: "/admin/orders",
      spark: true,
    },
  ];
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {items.map((it) => {
        const Icon = it.icon;
        const body = (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className={cn("grid h-9 w-9 place-items-center rounded-xl", it.tone)}>
                <Icon className="h-4 w-4" />
              </span>
              {it.spark && pulse && <Spark data={pulse.spark} />}
            </div>
            <div className="mt-3 text-2xl font-extrabold tabular-nums text-foreground">
              {it.value === undefined ? "…" : fmt(it.value)}
              {it.suffix && <span className="text-sm font-bold text-muted-foreground">{it.suffix}</span>}
            </div>
            <div className="text-xs font-medium text-muted-foreground">{it.label}</div>
          </>
        );
        const cls =
          "block rounded-2xl border border-border bg-card p-4 text-right shadow-[var(--shadow-lux)] transition hover:-translate-y-0.5 hover:border-primary/40";
        return onAsk ? (
          <button key={it.label} type="button" className={cls} onClick={() => onAsk(it.prompt)}>
            {body}
          </button>
        ) : (
          <Link key={it.label} to={it.to} className={cls}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
