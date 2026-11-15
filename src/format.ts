import type { Entry } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
export const WD = "日月火水木金土";

export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const fmtTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()}:${pad(d.getMinutes())}`;
};
export function fmtDay(ms: number, now = Date.now()) {
  const k = dayKey(ms);
  if (k === dayKey(now)) return "今日";
  if (k === dayKey(now - 864e5)) return "昨日";
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? "" : `${d.getFullYear()}/`}${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}
export const fmtWhen = (ms: number) => `${fmtDay(ms)} ${fmtTime(ms)}`;
export function fmtDayLong(ms: number) {
  const d = new Date(ms);
  const k = fmtDay(ms);
  const base = `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
  return k === "今日" || k === "昨日" ? `${k} · ${base}` : base;
}
export function fmtDuration(ms: number) {
  const m = Math.max(1, Math.round(ms / 6e4));
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}時間${m % 60}分` : `${h}時間`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}日${h % 24}時間` : `${d}日`;
}
export const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

const DEFAULT_MEDS = ["ロキソニン", "イブ", "カロナール", "イミグラン", "マクサルト", "レルパックス"];

// 過去によく使った薬を優先し、足りない分を一般的な薬名で補う
export function medSuggestions(entries: Entry[], selected: string[] = [], n = 6) {
  const freq = new Map<string, number>();
  entries.forEach((e) => !e.deleted && e.meds.forEach((m) => freq.set(m, (freq.get(m) ?? 0) + 1)));
  const used = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  const list = [...new Set([...selected, ...used, ...DEFAULT_MEDS])];
  return list.slice(0, Math.max(n, selected.length + (used.length ? 2 : 0)));
}

// 記録時点で気圧が大きく下がっていたか（日内変動を除いて 6 時間で 2hPa 以上、または 24 時間で 5hPa 以上）
export const isDropW = (w: { trend?: number | null; d24h: number | null } | null | undefined) =>
  !!w && ((w.trend != null && w.trend <= -2) || (w.d24h ?? 0) <= -5);

export const INTENSITY_COLOR = ["var(--gray)", "var(--yellow)", "var(--orange)", "var(--red)"];
