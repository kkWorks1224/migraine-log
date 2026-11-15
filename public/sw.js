// アプリシェルをキャッシュして「開いた瞬間」に表示する（API は常にネットワーク）
const CACHE = "ml-shell-v1";
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
