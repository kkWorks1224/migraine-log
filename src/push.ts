// 気圧の注意のプッシュ通知（購読の登録・更新・解除）
import { getState } from "./store";

const KEY = "ml.push";
type Saved = { endpoint: string; at: number; threshold: number; lat: number; lon: number };

export type PushSupport = "ok" | "ios-home" | "unsupported";

export function pushSupport(): PushSupport {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "ok";
  // iPhone はホーム画面に追加したアプリでだけプッシュ通知が使える（iOS 16.4 以降）
  if (ios && !standalone) return "ios-home";
  return "unsupported";
}

export function savedPush(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

const b64uToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

async function post(sub: PushSubscription, lat: number, lon: number, threshold: number) {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON(), lat, lon, threshold, tz: -new Date().getTimezoneOffset() }),
  });
  if (!res.ok) throw new Error(String(res.status));
  const saved: Saved = { endpoint: sub.endpoint, at: Date.now(), threshold, lat, lon };
  localStorage.setItem(KEY, JSON.stringify(saved));
}

export async function enablePush(lat: number, lon: number, threshold: number) {
  const key = getState().vapidKey;
  if (!key) throw new Error("not_configured");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("denied");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) }));
  await post(sub, lat, lon, threshold);
}

export async function disablePush() {
  const saved = savedPush();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {}
  if (saved) {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: saved.endpoint }),
    }).catch(() => {});
  }
  localStorage.removeItem(KEY);
}

// 基準（本人の分析結果）や場所が変わったら、サーバ側の購読を更新する（12 時間に 1 回まで）
export async function refreshPush(lat: number, lon: number, threshold: number) {
  const saved = savedPush();
  if (!saved || !getState().user || pushSupport() !== "ok") return;
  const moved = Math.abs(saved.lat - lat) >= 0.1 || Math.abs(saved.lon - lon) >= 0.1;
  if (!moved && saved.threshold === threshold && Date.now() - saved.at < 12 * 36e5) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return localStorage.removeItem(KEY);
    await post(sub, lat, lon, threshold);
  } catch {}
}

export async function testPush() {
  const res = await fetch("/api/push/test", { method: "POST" });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { sent: number }).sent;
}
