// アプリシェルをキャッシュして「開いた瞬間」に表示する（API は常にネットワーク）
const CACHE = "ml-shell-v3";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  if (url.pathname.startsWith("/assets/")) {
    // ハッシュ付きアセットはキャッシュ優先
    e.respondWith(
      caches.match(e.request).then(
        (hit) => hit || fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }),
      ),
    );
    return;
  }
  if (e.request.mode === "navigate") {
    // キャッシュを即返しつつ裏で更新（stale-while-revalidate）
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match("/");
        const net = fetch(e.request).then((res) => { if (res.ok) c.put("/", res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }),
    );
  }
});

// 気圧の注意のプッシュ通知
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(d.title || "頭痛ログ", {
      body: d.body || "",
      tag: d.tag || "pressure",
      icon: "/icon-512.png",
      badge: "/icon-512.png",
      data: { url: "/" },
    }),
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      const c = cs.find((x) => new URL(x.url).origin === location.origin);
      return c ? c.focus() : self.clients.openWindow("/");
    }),
  );
});
