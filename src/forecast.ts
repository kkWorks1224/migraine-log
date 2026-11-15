// 気圧の「下がり方」の予報と、本人の記録から頭痛が出やすい下がり方を見つける分析。
// DOM に依存しないので、Worker（プッシュ通知の Cron）からも使う。

export type PSeries = { t: number[]; p: (number | null)[] };

// 気圧は 1 日 2 回、潮汐で自然に 1〜3hPa 上下する（日本の内陸では 3 時間で 2hPa 以上下がる日が半数）。
// そのままの変化では毎日「低下」と判定されるため、24 時間移動平均で日内の上下を除き、
// 低気圧などによる下がり方だけを「6 時間あたりの変化」で見る。
export const WINDOW = 6;
export const GENERAL_THRESHOLD = -2; // 一般的な目安：日内変動を除いて 6 時間で 2hPa 以上（本州で上位 2〜3 割の日）
const CANDIDATES = [-1, -1.5, -2, -2.5, -3, -4];

// 24 時間中心移動平均（潮汐の 12・24 時間周期を打ち消す）
export function smoothed(h: PSeries): (number | null)[] {
  const p = h.p;
  return p.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = i - 12; k < i + 12; k++) {
      const v = k >= 0 && k < p.length ? p[k] : null;
      if (v != null) {
        s += v;
        n++;
      }
    }
    return n >= 18 ? s / n : null;
  });
}

// 時刻 t における日内変動を除いた 6 時間あたりの変化
export function rateAt(h: PSeries, t: number, ma = smoothed(h)): number | null {
  let i = -1;
  let best = Infinity;
  h.t.forEach((x, j) => {
    const d = Math.abs(x - t);
    if (d < best) {
      best = d;
      i = j;
    }
  });
  if (i < WINDOW || best > 90 * 6e4) return null;
  const a = ma[i - WINDOW];
  const b = ma[i];
  return a == null || b == null ? null : Math.round((b - a) * 10) / 10;
}

export type DropEvent = {
  from: number; // 下がり始め（ms）
  to: number; // 下がり終わり（ms）
  peak: number; // 6 時間あたりの最大低下（負の hPa、日内変動を除く）
  peakAt: number;
};

// [from, to] の間で、日内変動を除いて 6 時間あたり threshold 以上下がる区間をまとめて返す
export function findDrops(h: PSeries, from: number, to: number, threshold: number, ma = smoothed(h)): DropEvent[] {
  const out: DropEvent[] = [];
  let cur: DropEvent | null = null;
  for (let i = WINDOW; i < h.t.length; i++) {
    const t = h.t[i];
    if (t < from || t > to) continue;
    const a = ma[i - WINDOW];
    const b = ma[i];
    const d = a == null || b == null ? null : b - a;
    if (d != null && d <= threshold) {
      if (!cur) cur = { from: Math.max(h.t[i - WINDOW], from), to: t, peak: d, peakAt: t };
      cur.to = t;
      if (d < cur.peak) {
        cur.peak = d;
        cur.peakAt = t;
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export type Level = "high" | "mid" | "low";
export const LEVEL_LABEL: Record<Level, string> = { high: "高", mid: "中", low: "低" };

export type Analysis = {
  mode: "general" | "personal" | "unclear";
  threshold: number; // 予報・通知に使う 6 時間あたりの低下（負、日内変動を除く）
  days: number; // 分析に使えた日数
  headacheDays: number;
  // personal / unclear のとき：threshold 以上下がった日とそれ以外の日の頭痛の割合
  exposedRate?: number;
  otherRate?: number;
  ratio?: number;
};

// 本人の記録と、その地点の過去の気圧から、頭痛が出やすい下がり方を探す
export function analyze(
  h: PSeries,
  headacheStarts: number[],
  clearDays: number[],
  dayKey: (ms: number) => string,
  now = Date.now(),
): Analysis {
  const general: Analysis = { mode: "general", threshold: GENERAL_THRESHOLD, days: 0, headacheDays: 0 };
  if (h.t.length < 48 || headacheStarts.length === 0) return general;

  // 日ごとの「6 時間あたりの最大低下（日内変動を除く）」
  const ma = smoothed(h);
  const dayDrop = new Map<string, number>();
  const today = dayKey(now);
  for (let i = WINDOW; i < h.t.length; i++) {
    if (h.t[i] > now) break;
    const k = dayKey(h.t[i]);
    if (k === today) continue;
    const a = ma[i - WINDOW];
    const b = ma[i];
    if (a == null || b == null) continue;
    const d = b - a;
    dayDrop.set(k, Math.min(dayDrop.get(k) ?? Infinity, d));
  }
  const first = dayKey(Math.min(...headacheStarts, ...clearDays));
  const pain = new Set(headacheStarts.map(dayKey));
  const clear = new Set(clearDays.map(dayKey));
  // 頭痛なしの日をよく記録している人は、記録のある日だけで比べる（記録漏れを「頭痛なし」と誤認しない）
  const strict = clear.size >= 7;
  const days = [...dayDrop.entries()].filter(([k]) => k >= first && (!strict || pain.has(k) || clear.has(k)));
  const headacheDays = days.filter(([k]) => pain.has(k)).length;
  if (days.length < 14 || headacheDays < 5) return { ...general, days: days.length, headacheDays };

  let best: Analysis | null = null;
  for (const th of CANDIDATES) {
    const ex = days.filter(([, d]) => d <= th);
    const ot = days.filter(([, d]) => d > th);
    if (ex.length < 3 || ot.length < 3) continue;
    const exH = ex.filter(([k]) => pain.has(k)).length;
    const otH = ot.filter(([k]) => pain.has(k)).length;
    if (exH < 2) continue;
    const exposedRate = exH / ex.length;
    const otherRate = otH / ot.length;
    const ratio = exposedRate / Math.max(otherRate, 0.5 / ot.length);
    if (!best || ratio > best.ratio!) {
      best = { mode: "personal", threshold: th, days: days.length, headacheDays, exposedRate, otherRate, ratio };
    }
  }
  if (!best) return { ...general, mode: "unclear", days: days.length, headacheDays };
  // 1.5 倍未満なら「関係ははっきりしない」として、大きな低下だけを注意する
  if (best.ratio! < 1.5) return { ...best, mode: "unclear", threshold: -3 };
  return best;
}

// 予報の注意レベル
export function levelOf(ev: DropEvent, a: Analysis): Level {
  if (a.mode === "unclear") return "low";
  const strong = ev.peak <= a.threshold * 1.6;
  if (a.mode === "personal") return strong || (a.ratio ?? 0) >= 2.5 ? "high" : "mid";
  return strong ? "high" : "mid";
}
