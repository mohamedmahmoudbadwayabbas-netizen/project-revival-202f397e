export type ForecastItem = { name: string; stock: number; daily: number; coverageDays: number | null };

export const INSIGHT_CACHE_MS = 24 * 60 * 60 * 1000;
export const MAX_INSIGHT_ITEMS = 7;

/** يختار أكثر الأصناف عرضة للنقص (أقل أيام تغطية) لإرسال ملخص صغير للنموذج. */
export function pickAtRiskItems(items: ForecastItem[], max = MAX_INSIGHT_ITEMS): ForecastItem[] {
  return items
    .filter((i) => i.daily > 0)
    .sort((a, b) => (a.coverageDays ?? Infinity) - (b.coverageDays ?? Infinity))
    .slice(0, max);
}

export function isInsightFresh(savedAt: number, now = Date.now()): boolean {
  return now - savedAt < INSIGHT_CACHE_MS;
}
