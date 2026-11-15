import { useSyncExternalStore } from "react";
import type { Weather } from "./types";
import { actions, getState } from "./store";
import { rateAt } from "./forecast";

export type Hourly = { t: number[]; p: (number | null)[]; temp: (number | null)[]; rh: (number | null)[]; code: (number | null)[] };
export type Series = { lat: number; lon: number; place: string | null; fetchedAt: number; past: number; hourly: Hourly };
export type Geo = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

type WState = { geo: Geo; loading: boolean; error: boolean; series: Series | null };

const KEY = "ml.weather.v1";
let state: WState = { geo: "unknown", loading: false, error: false, series: readCache() };
const listeners = new Set<() => void>();

function readCache(): Series | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null") as Series | null;
    // 6 時間以上前のものは使わない（グラフが古くなるため）
    return s && Date.now() - s.fetchedAt < 6 * 36e5 ? s : null;
  } catch {
    return null;
  }
}
function set(next: Partial<WState>) {
  state = { ...state, ...next };
  if (next.series) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next.series));
    } catch {}
  }
  listeners.forEach((l) => l());
}
export const useWeather = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );

// 開発時のみ：localStorage の ml.mockGeo に {"lat":..,"lon":..} を入れると位置情報を差し替える（ブラウザ自動テスト用）
const mockGeo: { lat: number; lon: number } | null = import.meta.env.DEV
  ? (() => {
      try {
        return JSON.parse(localStorage.getItem("ml.mockGeo") || "null");
      } catch {
        return null;
      }
    })()
  : null;

export async function checkPermission() {
  if (mockGeo) return set({ geo: "granted" });
  if (!("geolocation" in navigator)) return set({ geo: "unsupported" });
  try {
    const p = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    set({ geo: p.state as Geo });
    p.onchange = () => set({ geo: p.state as Geo });
  } catch {
    set({ geo: "prompt" });
  }
}

function position(): Promise<{ lat: number; lon: number }> {
  if (mockGeo) return Promise.resolve(mockGeo);
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (p) => {
        set({ geo: "granted" });
        resolve({ lat: p.coords.latitude, lon: p.coords.longitude });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) set({ geo: "denied" });
        reject(err);
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 15 * 6e4 },
    ),
  );
}

const near = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.abs(a.lat - b.lat) < 0.05 && Math.abs(a.lon - b.lon) < 0.05;

let inflight: Promise<Series | null> | null = null;

// 現在地の気圧系列（過去 past 日〜48 時間後）を取得
export function loadSeries({ force = false, past = 92 } = {}): Promise<Series | null> {
  // 本人の記録との比較（頭痛が出やすい下がり方の分析）に使うため、常に最大の 92 日分を取る
  past = Math.max(past, 92);
  if (inflight) return inflight;
  inflight = (async () => {
    set({ loading: true, error: false });
    try {
      const pos = await position();
      const s = state.series;
      if (!force && s && near(s, pos) && Date.now() - s.fetchedAt < 30 * 6e4 && s.past >= past) {
        set({ loading: false });
        return s;
      }
      const res = await fetch(`/api/weather?lat=${pos.lat.toFixed(2)}&lon=${pos.lon.toFixed(2)}&past=${past}`);
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { lat: number; lon: number; place: string | null; hourly: Hourly };
      const series: Series = { ...j, fetchedAt: Date.now(), past };
      set({ series, loading: false });
      return series;
    } catch {
      set({ loading: false, error: true });
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const at = (h: Hourly, i: number) => (i >= 0 && i < h.t.length ? h.p[i] : null);

// 指定時刻の気象スナップショット（最も近い 1 時間値）
export function snapshotAt(s: Series, t: number): Weather | null {
  const h = s.hourly;
  let best = -1;
  let diff = Infinity;
  h.t.forEach((x, i) => {
    const d = Math.abs(x - t);
    if (d < diff) {
      diff = d;
      best = i;
    }
  });
  const p = at(h, best);
  if (best < 0 || diff > 90 * 6e4 || p == null) return null;
  const p3 = at(h, best - 3);
  const p24 = at(h, best - 24);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    at: h.t[best],
    pressure: r1(p),
    d3h: p3 != null ? r1(p - p3) : null,
    d24h: p24 != null ? r1(p - p24) : null,
    trend: rateAt(h, h.t[best]),
    temp: h.temp[best] != null ? r1(h.temp[best]!) : null,
    humidity: h.rh[best] != null ? Math.round(h.rh[best]!) : null,
    code: h.code[best] ?? null,
    place: s.place ?? undefined,
    lat: s.lat,
    lon: s.lon,
  };
}

// 記録に、その日時・現在地の気圧と天気を付ける
export async function attachWeather(id: string, { force = false } = {}) {
  const e = getState().entries[id];
  if (!e) return false;
  const days = Math.ceil((Date.now() - e.startedAt) / 864e5) + 1;
  if (days > 92) return false;
  const s = await loadSeries({ force, past: Math.max(2, days) });
  if (!s) return false;
  const w = snapshotAt(s, e.startedAt);
  if (!w) return false;
  const cur = getState().entries[id];
  if (cur) actions.patch(id, { weather: w });
  return true;
}

// 今後 24 時間で 3 時間あたりの低下が最も大きい時刻
export function nextDrop(s: Series, now = Date.now()) {
  const h = s.hourly;
  let worst: { t: number; d: number } | null = null;
  for (let i = 3; i < h.t.length; i++) {
    if (h.t[i] < now || h.t[i] > now + 24 * 36e5) continue;
    const a = h.p[i - 3];
    const b = h.p[i];
    if (a == null || b == null) continue;
    const d = b - a;
    if (!worst || d < worst.d) worst = { t: h.t[i], d };
  }
  return worst;
}

// WMO 天気コード → 表示種別
export function sky(code: number | null | undefined): "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm" {
  if (code == null) return "cloud";
  if (code === 0) return "sun";
  if (code <= 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  return "rain";
}
export const SKY_LABEL = { sun: "晴れ", partly: "晴れ時々くもり", cloud: "くもり", fog: "霧", rain: "雨", snow: "雪", storm: "雷雨" };

export const getGeo = () => state.geo;
