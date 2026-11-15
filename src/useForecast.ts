import { useMemo } from "react";
import { analyze, findDrops, levelOf, type Analysis, type DropEvent, type Level } from "./forecast";
import { useWeather } from "./weather";
import { dayKey } from "./format";
import { kindOf, type Entry } from "./types";

export type Forecast = { analysis: Analysis; events: (DropEvent & { level: Level })[] };

// 記録と現在地の気圧系列から、本人向けの分析と 48 時間先までの注意予報を作る
export function useForecast(entries: Entry[]): Forecast | null {
  const { series } = useWeather();
  const slot = Math.floor(Date.now() / 6e5); // 10 分ごとに再計算
  return useMemo(() => {
    if (!series) return null;
    const live = entries.filter((e) => !e.deleted);
    const pain = live.filter((e) => kindOf(e) === "headache").map((e) => e.startedAt);
    const clear = live.filter((e) => kindOf(e) === "clear").map((e) => e.startedAt);
    const analysis = analyze(series.hourly, pain, clear, dayKey);
    const now = Date.now();
    const events = findDrops(series.hourly, now, now + 48 * 36e5, analysis.threshold).map((ev) => ({
      ...ev,
      level: levelOf(ev, analysis),
    }));
    return { analysis, events };
  }, [series, entries, slot]);
}

// 「明日 14時ごろ」のような表記
export function whenLabel(ms: number, now = Date.now()) {
  const d = new Date(ms);
  const k = dayKey(ms);
  const day = k === dayKey(now) ? "" : k === dayKey(now + 864e5) ? "明日 " : `${d.getMonth() + 1}/${d.getDate()} `;
  return `${day}${d.getHours()}時ごろ`;
}

// 分析結果を一文で
export function analysisText(a: Analysis) {
  const th = Math.abs(a.threshold).toFixed(1).replace(/\.0$/, "");
  const pct = (v?: number) => `${Math.round((v ?? 0) * 100)}%`;
  if (a.mode === "personal")
    return `気圧が6時間で${th}hPa以上下がった日は頭痛が出た割合が${pct(a.exposedRate)}（それ以外の日は${pct(a.otherRate)}）。あなたは気圧の低下で頭痛が出やすい傾向があります。`;
  const note = "気圧は1日2回自然に上下するため、その分を除いた下がり方で判定しています。";
  if (a.mode === "unclear") return `${a.days}日分の記録では、気圧の下がり方と頭痛の関係ははっきりしません。大きな低下（6時間で3hPa以上）だけを注意として出します。${note}`;
  const need = Math.max(0, 5 - a.headacheDays);
  return need > 0
    ? `一般的な目安（6時間で2hPa以上の低下）で予報しています。頭痛の日があと${need}日分たまると、あなたの記録から基準を見つけます。${note}`
    : `一般的な目安（6時間で2hPa以上の低下）で予報しています。記録が2週間分たまると、あなたの記録から基準を見つけます。${note}`;
}
