import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Entry, Status } from "./types";

export type User = { id: string; email: string; name: string; picture: string };
export type SyncState = "idle" | "syncing" | "offline" | "error";

type Persisted = { entries: Record<string, Entry>; dirty: string[]; since: number; user: User | null };

const KEY = "ml.store.v1";

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { entries: {}, dirty: [], since: 0, user: null };
}

const initial = load();
// キャッシュがあれば初回描画から一覧を出す（スケルトンはキャッシュの無い初回起動時のみ）
const hadCache = Object.keys(initial.entries).length > 0 || initial.user !== null;
let state: Persisted & { sync: SyncState; ready: boolean; googleEnabled: boolean } = {
  ...initial,
  sync: "idle",
  ready: hadCache,
  googleEnabled: true,
};
const listeners = new Set<() => void>();

function emit(next: Partial<typeof state>) {
  state = { ...state, ...next };
  try {
    const { entries, dirty, since, user } = state;
    localStorage.setItem(KEY, JSON.stringify({ entries, dirty, since, user }));
  } catch {}
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getState = () => state;

export const uid = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let syncTimer: number | undefined;
function scheduleSync(delay = 500) {
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(sync, delay);
}

function write(e: Entry) {
  const entries = { ...state.entries, [e.id]: e };
  const dirty = state.dirty.includes(e.id) ? state.dirty : [...state.dirty, e.id];
  emit({ entries, dirty });
  if (state.user) scheduleSync();
}

export type Draft = Omit<Entry, "id" | "createdAt" | "updatedAt" | "deleted">;

export const blankDraft = (): Draft => ({
  memo: "",
  status: "pain",
  startedAt: Date.now(),
  endedAt: null,
  intensity: 0,
  meds: [],
  medEffect: null,
  sleepLack: false,
  triggers: [],
  symptoms: [],
  weather: null,
});

export const actions = {
  add(d: Draft) {
    const now = Date.now();
    const e: Entry = { ...d, id: uid(), createdAt: now, updatedAt: now };
    if (e.status === "gone" && !e.endedAt) e.endedAt = now;
    write(e);
    return e;
  },
  patch(id: string, p: Partial<Entry>) {
    const e = state.entries[id];
    if (e) write({ ...e, ...p, updatedAt: Date.now() });
  },
  setStatus(id: string, status: Status) {
    const e = state.entries[id];
    if (!e) return;
    const endedAt = status === "gone" ? (e.endedAt ?? Date.now()) : null;
    write({ ...e, status, endedAt, updatedAt: Date.now() });
  },
  remove(id: string) {
    const e = state.entries[id];
    if (e) write({ ...e, deleted: true, updatedAt: Date.now() });
  },
  restore(snapshot: Entry) {
    write({ ...snapshot, deleted: false, updatedAt: Date.now() });
  },
  async logout() {
    await fetch("/auth/logout", { method: "POST" }).catch(() => {});
    emit({ entries: {}, dirty: [], since: 0, user: null });
  },
};

let syncing = false;
export async function sync() {
  if (!state.user || syncing) return;
  if (!navigator.onLine) return emit({ sync: "offline" });
  syncing = true;
  emit({ sync: "syncing" });
  const sending = state.dirty.slice();
  const sentAt: Record<string, number> = {};
  sending.forEach((id) => state.entries[id] && (sentAt[id] = state.entries[id].updatedAt));
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ since: state.since, changes: sending.map((id) => state.entries[id]).filter(Boolean) }),
    });
    if (res.status === 401) {
      emit({ user: null, sync: "idle" });
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { now: number; entries: Entry[] };
    const entries = { ...state.entries };
    for (const e of data.entries) {
      const local = entries[e.id];
      if (!local || e.updatedAt >= local.updatedAt) entries[e.id] = e;
    }
    // 送信中に再編集されたものは dirty に残す
    const dirty = state.dirty.filter((id) => !(id in sentAt) || (entries[id]?.updatedAt ?? 0) > sentAt[id]);
    emit({ entries, since: data.now, dirty, sync: "idle" });
    if (state.dirty.length) scheduleSync(50);
  } catch {
    emit({ sync: navigator.onLine ? "error" : "offline" });
  } finally {
    syncing = false;
  }
}

export async function boot() {
  const started = performance.now();
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    const data = (await res.json()) as { user: User | null; googleEnabled: boolean };
    const switched = state.user && data.user && state.user.id !== data.user.id;
    if (switched) emit({ entries: {}, dirty: [], since: 0 });
    // 未ログインで書いた記録はログイン時にまとめてアップロードされる（dirty に残っているため）
    emit({ user: data.user, googleEnabled: data.googleEnabled });
    if (data.user) await sync();
  } catch {
    emit({ sync: "offline" });
  }
  if (!hadCache) {
    const wait = 650 - (performance.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  emit({ ready: true });
}

export function useStore() {
  return useSyncExternalStore(subscribe, () => state);
}

export function useBootSync() {
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    boot();
    const onFocus = () => document.visibilityState === "visible" && sync();
    window.addEventListener("online", () => sync());
    document.addEventListener("visibilitychange", onFocus);
    const iv = window.setInterval(() => sync(), 30000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(iv);
    };
  }, []);
}

// ---------- AI ----------
export type Parsed = {
  memo: string;
  intensity: 0 | 1 | 2 | 3;
  meds: string[];
  sleepLack: boolean;
  triggers: string[];
  symptoms: string[];
  time: string | null;
  status: Status;
};

const localIso = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 6e4);
  return z.toISOString().slice(0, 16);
};

export async function aiParse(text: string): Promise<Parsed> {
  const now = new Date();
  const wd = "日月火水木金土"[now.getDay()];
  const res = await fetch("/api/ai/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, now: `${localIso(now)}（${wd}曜日）` }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function aiInsight(): Promise<string> {
  await sync();
  const res = await fetch("/api/ai/insight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tz: -new Date().getTimezoneOffset() }),
  });
  if (res.status === 422) throw new Error("not_enough");
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { text: string }).text;
}

// "YYYY-MM-DDTHH:MM"（ローカル時刻）⇔ ms
export const toLocalInput = (ms: number) => localIso(new Date(ms));
export const fromLocalInput = (s: string) => {
  const t = new Date(s).getTime(); // タイムゾーン無しの日時はローカル時刻として解釈される
  return Number.isFinite(t) ? t : null;
};
