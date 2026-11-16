import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { PRODROMES, STATUSES, SYMPTOMS, TRIGGERS, type Entry } from "../src/types";
import { findDrops } from "../src/forecast";
import { sendPush, validSub, type PushSub, type VapidConfig } from "./push";

type Env = {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
  AI_MODEL: string;
  DEV_LOGIN?: string;
  AI_LIMITER?: RateLimit;
  WEATHER_LIMITER?: RateLimit;
  SYNC_LIMITER?: RateLimit;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
};
type User = { id: string; email: string; name: string; picture: string };
type Vars = { user: User };

const SESSION_DAYS = 60;
const MAX_ENTRIES_PER_USER = 20000;
const AI_DAILY_LIMIT = 100;
const UA = "migraine-log/1.0 (+https://github.com/kkWorks1224/migraine-log)";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const baseHeaders = secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
});
app.use("*", (c, next) => (c.req.path === "/auth/callback" ? next() : baseHeaders(c, next)));

// 状態を変える POST は自オリジンからのみ受け付ける（SameSite Cookie に加えた CSRF 対策）
// 本文は 5MB まで（同期 500 件 × メモ 4000 字が収まる上限）
const MAX_BODY = 5 * 1024 * 1024;
app.use("*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();
  const self = new URL(c.req.url).origin;
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");
  if (origin ? origin !== self : site && site !== "same-origin") return c.json({ error: "forbidden" }, 403);
  const len = Number(c.req.header("content-length") ?? 0);
  if (len > MAX_BODY) return c.json({ error: "too_large" }, 413);
  return next();
});

app.onError((err, c) => {
  if (err instanceof SyntaxError) return c.json({ error: "bad_request" }, 400);
  console.error(err);
  return c.json({ error: "internal" }, 500);
});

// ---------- helpers ----------
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) =>
  b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const isSecure = (url: string) => new URL(url).protocol === "https:";

async function createSession(c: any, user: User) {
  const db = c.env.DB as D1Database;
  await db
    .prepare(
      `INSERT INTO users (id, email, name, picture, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture`,
    )
    .bind(user.id, user.email, user.name, user.picture, Date.now())
    .run();
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(Date.now()).run();
  const token = randomToken();
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(await sha256(token), user.id, Date.now() + SESSION_DAYS * 864e5)
    .run();
  setCookie(c, "sid", token, {
    httpOnly: true,
    secure: isSecure(c.req.url),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

async function currentUser(c: any): Promise<User | null> {
  const token = getCookie(c, "sid");
  if (!token) return null;
  const row = await (c.env.DB as D1Database)
    .prepare(
      `SELECT u.id, u.email, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?1 AND s.expires_at > ?2`,
    )
    .bind(await sha256(token), Date.now())
    .first<User>();
  return row ?? null;
}

// ---------- auth（Google OpenID Connect：ID トークンを Google の公開鍵で検証。クライアントシークレット不要） ----------
type Jwk = JsonWebKey & { kid: string };
let jwksCache: { at: number; keys: Jwk[] } | null = null;
async function googleKeys(force = false): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.at < 3600e3) return jwksCache.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const { keys } = (await r.json()) as { keys: Jwk[] };
  jwksCache = { at: Date.now(), keys };
  return keys;
}
const b64urlDecode = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (ch) =>
    ch.charCodeAt(0),
  );

async function verifyIdToken(token: string, clientId: string, nonce: string) {
  try {
    return await verifyIdTokenUnsafe(token, clientId, nonce);
  } catch {
    return null; // 壊れたトークン（base64・JSON 不正など）は検証失敗として扱う
  }
}
async function verifyIdTokenUnsafe(token: string, clientId: string, nonce: string) {
  if (token.length > 8192) return null;
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return null;
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  if (header.alg !== "RS256") return null;
  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const c = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  const validIss = ["https://accounts.google.com", "accounts.google.com"].includes(c.iss);
  if (!validIss || c.aud !== clientId || c.exp * 1000 < Date.now() || c.nonce !== nonce) return null;
  return c as { sub: string; email?: string; name?: string; picture?: string };
}

app.get("/auth/login", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.text("Google OAuth is not configured", 503);
  const state = randomToken(16);
  const nonce = randomToken(16);
  setCookie(c, "oauth", `${state}.${nonce}`, {
    httpOnly: true,
    secure: isSecure(c.req.url),
    sameSite: "Lax",
    path: "/auth",
    maxAge: 600,
  });
  const q = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: new URL("/auth/callback", c.req.url).toString(),
    response_type: "id_token",
    response_mode: "fragment",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
});

// ID トークンは URL フラグメントで返る（サーバに届かない）ので、小さなページで受け取り /auth/complete へ送る
app.get("/auth/callback", (c) =>
  c.html(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ログイン中</title><script src="/callback.js"></script>',
    200,
    {
      "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    },
  ),
);

app.post("/auth/complete", async (c) => {
  const [state, nonce] = (getCookie(c, "oauth") ?? "").split(".");
  deleteCookie(c, "oauth", { path: "/auth" });
  const body = await c.req.json<{ id_token?: string; state?: string }>();
  if (!state || !nonce || body.state !== state || typeof body.id_token !== "string") {
    console.error("oauth state mismatch", { hasCookie: !!state });
    return c.json({ error: "bad_state" }, 400);
  }
  const claims = await verifyIdToken(body.id_token, c.env.GOOGLE_CLIENT_ID, nonce);
  if (!claims) {
    console.error("id_token invalid");
    return c.json({ error: "invalid_token" }, 400);
  }
  await createSession(c, {
    id: `g:${claims.sub}`,
    email: claims.email ?? "",
    name: claims.name ?? "",
    picture: claims.picture ?? "",
  });
  return c.json({ ok: true });
});

// ローカル開発専用（.dev.vars で DEV_LOGIN=1 かつ localhost のときのみ）
app.get("/auth/dev", async (c) => {
  const host = new URL(c.req.url).hostname;
  if (c.env.DEV_LOGIN !== "1" || !["localhost", "127.0.0.1"].includes(host)) return c.notFound();
  await createSession(c, { id: "dev:tester", email: "tester@example.test", name: "Tester", picture: "" });
  return c.redirect("/");
});

app.post("/auth/logout", async (c) => {
  const token = getCookie(c, "sid");
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(await sha256(token)).run();
  deleteCookie(c, "sid", { path: "/" });
  return c.json({ ok: true });
});

// ---------- weather（ログイン不要：未ログインでも記録に気圧を残せるように） ----------
type Daily = { t: number[]; code: (number | null)[]; tmax: (number | null)[]; tmin: (number | null)[]; pop: (number | null)[] };
type Hourly = { t: number[]; p: (number | null)[]; temp: (number | null)[]; rh: (number | null)[]; code: (number | null)[]; daily?: Daily | null };

async function cached<T>(key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
  const cache = (caches as any).default as Cache;
  const req = new Request(`https://cache.internal/${key}`);
  const hit = await cache.match(req);
  if (hit) return hit.json<T>();
  const v = await load();
  if (v != null) {
    await cache.put(req, new Response(JSON.stringify(v), { headers: { "cache-control": `max-age=${ttl}` } }));
  }
  return v;
}

async function openMeteo(lat: number, lon: number, past: number): Promise<Hourly | null> {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "pressure_msl,temperature_2m,relative_humidity_2m,weather_code",
    // 週間予報（今日を含む 8 日分。7 日先まで日ごとの注意を出すため）
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    past_days: String(past),
    forecast_days: "8",
    timeformat: "unixtime",
    timezone: "auto",
  });
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const h = j.hourly;
    const d = j.daily;
    // 週間は今日以降だけ（過去分は不要）
    const today = Math.floor(Date.now() / 1000) - 86400;
    const keep = d ? d.time.map((t: number, i: number) => (t >= today ? i : -1)).filter((i: number) => i >= 0) : [];
    const pick = (a: any[]) => keep.map((i: number) => a?.[i] ?? null);
    return {
      t: h.time.map((s: number) => s * 1000),
      p: h.pressure_msl,
      temp: h.temperature_2m,
      rh: h.relative_humidity_2m,
      code: h.weather_code,
      daily: d
        ? {
            t: keep.map((i: number) => d.time[i] * 1000),
            code: pick(d.weather_code),
            tmax: pick(d.temperature_2m_max),
            tmin: pick(d.temperature_2m_min),
            pop: pick(d.precipitation_probability_max),
          }
        : null,
    };
  } catch {
    return null;
  }
}

// Open-Meteo に届かないときの予備（MET Norway。過去データは無く現在以降のみ）
const MET_CODE: [RegExp, number][] = [
  [/thunder/, 95],
  [/snow/, 71],
  [/sleet/, 66],
  [/heavyrain/, 65],
  [/rainshowers/, 80],
  [/rain/, 61],
  [/fog/, 45],
  [/cloudy/, 3],
  [/partlycloudy/, 2],
  [/fair/, 1],
  [/clearsky/, 0],
];
async function metNo(lat: number, lon: number): Promise<Hourly | null> {
  try {
    const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const out: Hourly = { t: [], p: [], temp: [], rh: [], code: [] };
    for (const s of j.properties.timeseries.slice(0, 48)) {
      const d = s.data.instant.details;
      const sym: string = s.data.next_1_hours?.summary?.symbol_code ?? "";
      out.t.push(Date.parse(s.time));
      out.p.push(d.air_pressure_at_sea_level ?? null);
      out.temp.push(d.air_temperature ?? null);
      out.rh.push(d.relative_humidity ?? null);
      out.code.push(sym ? (MET_CODE.find(([re]) => re.test(sym))?.[1] ?? null) : null);
    }
    return out;
  } catch {
    return null;
  }
}

async function placeName(env: Env, lat: number, lon: number): Promise<string | null> {
  return cached(`place/${lat}/${lon}`, 30 * 86400, async () => {
    // Nominatim の利用規約（アプリ全体で毎秒 1 回まで）を守るため、全利用者共通のキーで 60 回/分に制限
    if (env.WEATHER_LIMITER && !(await env.WEATHER_LIMITER.limit({ key: "nominatim:global" })).success) return null;
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&accept-language=ja`,
        { headers: { "user-agent": UA }, signal: AbortSignal.timeout(4000) },
      );
      if (!r.ok) return null;
      const j: any = await r.json();
      const a = j.address ?? {};
      return a.city || a.town || a.village || a.county || a.province || a.state || j.name || null;
    } catch {
      return null;
    }
  });
}

app.get("/api/weather", async (c) => {
  // 位置は約 1km 単位に丸めてから外部 API に渡す
  const lat = Math.round(Number(c.req.query("lat")) * 100) / 100;
  const lon = Math.round(Number(c.req.query("lon")) * 100) / 100;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return c.json({ error: "bad_request" }, 400);
  }
  const past = Math.min(92, Math.max(2, Math.ceil(Number(c.req.query("past")) || 2)));
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if (c.env.WEATHER_LIMITER && !(await c.env.WEATHER_LIMITER.limit({ key: ip })).success) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const hour = Math.floor(Date.now() / 36e5);
  const [hourly, place] = await Promise.all([
    cached(`om8/${lat}/${lon}/${past}/${hour}`, 3600, () => openMeteo(lat, lon, past)).then(
      (h) => h ?? cached(`met/${lat}/${lon}/${hour}`, 3600, () => metNo(lat, lon)),
    ),
    placeName(c.env, lat, lon),
  ]);
  if (!hourly) return c.json({ error: "weather_unavailable" }, 502);
  const { daily, ...h } = hourly;
  return c.json({ lat, lon, place, hourly: h, daily: daily ?? null }, 200, { "cache-control": "private, max-age=600" });
});

// ---------- api（ログイン必須） ----------
app.get("/api/me", async (c) => {
  const user = await currentUser(c);
  return c.json({ user, googleEnabled: Boolean(c.env.GOOGLE_CLIENT_ID), vapidKey: c.env.VAPID_PUBLIC_KEY ?? null });
});

app.use("/api/*", async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
});

const strList = (v: unknown, max = 20, len = 40) =>
  Array.isArray(v)
    ? [...new Set(v.slice(0, 100).filter((s): s is string => typeof s === "string").map((s) => s.trim().slice(0, len)).filter(Boolean))].slice(0, max)
    : [];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// 受け取った記録を検証・正規化（未知のキーは捨てる）
function sanitize(e: any): Entry | null {
  if (!e || typeof e.id !== "string" || !e.id || e.id.length > 64) return null;
  if (!STATUSES.includes(e.status)) return null;
  if (![e.startedAt, e.createdAt, e.updatedAt].every(Number.isFinite)) return null;
  const w = e.weather;
  const kind = ["clear", "midas"].includes(e.kind) ? (e.kind as "clear" | "midas") : undefined;
  return {
    id: e.id,
    ...(kind ? { kind } : {}),
    prodromes: strList(e.prodromes),
    ...(kind === "midas" && Array.isArray(e.midas)
      ? { midas: e.midas.slice(0, 5).map((v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(92, Math.max(0, Math.round(v))) : 0)) }
      : {}),
    memo: typeof e.memo === "string" ? e.memo.slice(0, 4000) : "",
    status: e.status,
    startedAt: e.startedAt,
    endedAt: num(e.endedAt),
    intensity: [0, 1, 2, 3].includes(e.intensity) ? e.intensity : 0,
    meds: strList(e.meds, 10),
    medEffect: ["good", "some", "none"].includes(e.medEffect) ? e.medEffect : null,
    sleepLack: e.sleepLack === true,
    triggers: strList(e.triggers),
    symptoms: strList(e.symptoms),
    weather:
      w && num(w.pressure) !== null
        ? {
            at: num(w.at) ?? e.startedAt,
            pressure: w.pressure,
            d3h: num(w.d3h),
            d24h: num(w.d24h),
            trend: num(w.trend),
            temp: num(w.temp),
            humidity: num(w.humidity),
            code: num(w.code),
            place: typeof w.place === "string" ? w.place.slice(0, 60) : undefined,
            lat: num(w.lat) ?? 0,
            lon: num(w.lon) ?? 0,
          }
        : null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    deleted: e.deleted === true,
  };
}

// 差分同期：updatedAt の後勝ちでマージし、since 以降にサーバで変わった行を返す
app.post("/api/sync", async (c) => {
  const user = c.get("user");
  if (c.env.SYNC_LIMITER && !(await c.env.SYNC_LIMITER.limit({ key: user.id })).success) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const body = await c.req.json<{ since?: number; changes?: unknown[] }>();
  const since = Number(body.since) || 0;
  const changes = (Array.isArray(body.changes) ? body.changes : [])
    .slice(0, 500)
    .map(sanitize)
    .filter((e): e is Entry => e !== null);
  const now = Date.now();

  if (changes.length) {
    const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM entries WHERE user_id = ?1")
      .bind(user.id)
      .first<{ n: number }>();
    if ((used?.n ?? 0) + changes.length > MAX_ENTRIES_PER_USER) return c.json({ error: "quota_exceeded" }, 413);
    const stmt = c.env.DB.prepare(
      `INSERT INTO entries (id, user_id, data, started_at, updated_at, deleted, synced_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(user_id, id) DO UPDATE SET
         data = excluded.data, started_at = excluded.started_at, updated_at = excluded.updated_at,
         deleted = excluded.deleted, synced_at = excluded.synced_at
       WHERE excluded.updated_at > entries.updated_at`,
    );
    await c.env.DB.batch(
      changes.map((e) =>
        stmt.bind(e.id, user.id, JSON.stringify(e), e.startedAt, e.updatedAt, e.deleted ? 1 : 0, now),
      ),
    );
  }

  const { results } = await c.env.DB.prepare("SELECT data FROM entries WHERE user_id = ?1 AND synced_at > ?2")
    .bind(user.id, since)
    .all<{ data: string }>();
  return c.json({ now, entries: results.map((r) => JSON.parse(r.data)) });
});

// ---------- Workers AI ----------
async function aiGuard(c: any): Promise<Response | null> {
  const user = c.get("user") as User;
  if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: user.id })).success) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const day = new Date().toISOString().slice(0, 10);
  const usage = await (c.env.DB as D1Database)
    .prepare(
      `INSERT INTO ai_usage (user_id, day, count) VALUES (?1, ?2, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1 RETURNING count`,
    )
    .bind(user.id, day)
    .first<{ count: number }>();
  return (usage?.count ?? 0) > AI_DAILY_LIMIT ? c.json({ error: "rate_limited" }, 429) : null;
}

async function runAI(env: Env, system: string, user: string, maxTokens: number): Promise<string> {
  const out: any = await env.AI.run(env.AI_MODEL as any, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0.2,
  });
  return typeof out?.response === "string"
    ? out.response
    : out?.response
      ? JSON.stringify(out.response)
      : (out?.choices?.[0]?.message?.content ?? "");
}

// 音声入力のメモを読み取り、強さ・薬・寝不足・誘因・症状・時刻に整理する
app.post("/api/ai/parse", async (c) => {
  const body = await c.req.json<{ text?: string; now?: string }>();
  const input = (body.text ?? "").trim().slice(0, 2000);
  if (!input) return c.json({ error: "bad_request" }, 400);
  const blocked = await aiGuard(c);
  if (blocked) return blocked;
  const now = typeof body.now === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.now) ? body.now.slice(0, 16) : "";

  const system = [
    "あなたは頭痛ダイアリーの入力アシスタントです。",
    "ユーザーのメモは音声入力のため誤字・脱字・誤変換を含むことがあります（例：「六その人」→ロキソニン、「ねぶそく」→寝不足、「いぶ」→イブ、「はきけ」→吐き気、「ずきずき」→ズキズキ）。頭痛の記録であることを前提に意図を汲んでください。",
    "誤変換を直すときは頭痛・体調・薬に関係する語にだけ直し、無関係な語（例：発毛）に変えないこと。確信が持てない語は元のまま残す。",
    `現在日時は ${now || "不明"}（ユーザーの現地時刻）です。`,
    "次のキーを持つ JSON のみを出力してください:",
    '{"memo": 誤変換を直した元メモ（要約しない）,',
    ' "intensity": 頭痛の強さ。強さを表す言葉（軽い・少し・中くらい・つらい・ひどい・寝込む 等）が無ければ 0。1=軽い 2=中くらい・支障あり 3=強い・寝込む,',
    ' "meds": 飲んだ薬の名前の配列（一般的な表記に直す。例: ロキソニン, イブ, カロナール, イミグラン, マクサルト, レルパックス, アマージ, ゾーミッグ）,',
    ' "medEffect": 薬の効き目の記載があれば "good"=効いた / "some"=少し効いた・あまり効かない / "none"=全く効かない、無ければ null,',
    ' "sleepLack": 寝不足・睡眠不足の記載があれば true,',
    ` "triggers": きっかけの配列。次から選ぶ: ${TRIGGERS.join("、")},`,
    ` "symptoms": 症状の配列。次から選ぶ: ${SYMPTOMS.join("、")},`,
    ` "prodromes": 頭痛の前に出ていた前ぶれの配列。次から選ぶ: ${PRODROMES.join("、")},`,
    ' "time": 頭痛が始まった時刻の記載があれば "YYYY-MM-DDTHH:MM"（現在日時から計算。時刻が曖昧なら 今朝=07:00、昼=12:00、夕方=17:00、夜=21:00、昨夜=前日の22:00、夜中・明け方=03:00 を目安にする）、無ければ null,',
    ' "status": "pain"=今痛い / "easing"=和らいできた / "gone"=治まった（記載が無ければ "pain"）}',
    "メモに書かれていないことは推測で追加しないこと。",
  ].join("\n");

  try {
    const raw = await runAI(c.env, system, input, 600);
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    const p = json ? JSON.parse(json) : {};
    const t = typeof p.time === "string" ? Date.parse(p.time) : NaN; // タイムゾーンはクライアントで解釈
    return c.json({
      memo: typeof p.memo === "string" && p.memo.trim() ? p.memo.trim().slice(0, 4000) : input,
      intensity: [0, 1, 2, 3].includes(p.intensity) ? p.intensity : 0,
      meds: strList(p.meds, 10),
      medEffect: ["good", "some", "none"].includes(p.medEffect) ? p.medEffect : null,
      sleepLack: p.sleepLack === true,
      triggers: strList(p.triggers).filter((s) => TRIGGERS.includes(s)),
      symptoms: strList(p.symptoms).filter((s) => SYMPTOMS.includes(s)),
      prodromes: strList(p.prodromes).filter((s) => PRODROMES.includes(s)),
      time: Number.isFinite(t) ? String(p.time).slice(0, 16) : null,
      status: STATUSES.includes(p.status) ? p.status : "pain",
    });
  } catch (e) {
    console.error("ai parse failed", e);
    return c.json({ error: "ai_failed" }, 502);
  }
});

// 直近 90 日の記録から傾向をまとめる
app.post("/api/ai/insight", async (c) => {
  const user = c.get("user");
  const { tz } = await c.req.json<{ tz?: number }>().catch(() => ({ tz: 0 }));
  const offset = Number.isFinite(tz) ? Number(tz) : 0; // 分（Date#getTimezoneOffset の符号反転値）
  const { results } = await c.env.DB.prepare(
    `SELECT data FROM entries WHERE user_id = ?1 AND deleted = 0 AND started_at > ?2 ORDER BY started_at`,
  )
    .bind(user.id, Date.now() - 90 * 864e5)
    .all<{ data: string }>();
  const entries = results.map((r) => JSON.parse(r.data) as Entry).filter((e) => !e.kind || e.kind === "headache");
  if (entries.length < 3) return c.json({ error: "not_enough" }, 422);
  const blocked = await aiGuard(c);
  if (blocked) return blocked;

  const fmt = (ms: number) => new Date(ms + offset * 6e4).toISOString().slice(0, 16).replace("T", " ");
  const lines = entries.slice(-120).map((e) => {
    const w = e.weather;
    return [
      fmt(e.startedAt),
      `強さ${e.intensity || "-"}`,
      e.endedAt ? `${Math.round((e.endedAt - e.startedAt) / 36e5)}h` : "",
      e.meds.length ? `薬:${e.meds.join("/")}${e.medEffect ? `(${{ good: "効いた", some: "少し", none: "効かない" }[e.medEffect]})` : ""}` : "",
      e.sleepLack ? "寝不足" : "",
      e.triggers.length ? `誘因:${e.triggers.join("/")}` : "",
      e.symptoms.length ? `症状:${e.symptoms.join("/")}` : "",
      e.prodromes?.length ? `前ぶれ:${e.prodromes.join("/")}` : "",
      w ? `気圧${Math.round(w.pressure)}hPa${w.trend != null ? ` 6h${w.trend > 0 ? "+" : ""}${w.trend.toFixed(1)}` : ""}${w.d24h != null ? ` 24h${w.d24h > 0 ? "+" : ""}${w.d24h.toFixed(1)}` : ""}` : "",
      e.memo ? `メモ:${e.memo.replace(/\s+/g, " ").slice(0, 60)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  });

  // 数値の事実はサーバで計算して渡し、AI には根拠のある傾向だけを書かせる
  const day = (ms: number) => new Date(ms + offset * 6e4).toISOString().slice(0, 10);
  const recent = entries.filter((e) => e.startedAt > Date.now() - 30 * 864e5);
  const medDays30 = new Set(recent.filter((e) => e.meds.length).map((e) => day(e.startedAt))).size;
  const withW = entries.filter((e) => e.weather && (e.weather.trend != null || e.weather.d24h != null));
  const drops = withW.filter((e) => (e.weather!.trend ?? 0) <= -2 || (e.weather!.d24h ?? 0) <= -5).length;
  const facts = [
    `記録件数: ${entries.length}件（直近90日）`,
    `頭痛のあった日数: ${new Set(entries.map((e) => day(e.startedAt))).size}日`,
    `直近30日の服薬日数: ${medDays30}日（${medDays30 >= 10 ? "10日以上：薬の使いすぎに注意が必要" : "10日未満：薬の使いすぎには該当しない"}）`,
    `寝不足の記録: ${entries.filter((e) => e.sleepLack).length}件`,
    `気圧の変化が分かる記録: ${withW.length}件、そのうち気圧が急に下がっていた記録: ${drops}件`,
  ];

  const system = [
    "あなたは頭痛ダイアリーを読み解くアシスタントです。診断や処方はしません。",
    "【事実】と【記録】だけを根拠に、読み取れる傾向（時間帯・曜日、寝不足、きっかけ、前ぶれ、症状、薬の効き方、気圧の変化）を日本語で簡潔にまとめてください。",
    "根拠となる件数や割合を必ず添えること。根拠が 1〜2 件しかない傾向や、記録に無いことは書かない。",
    "気圧について書くのは【事実】の「気圧が急に下がっていた記録」が 2 件以上ある場合だけ。",
    "薬の使いすぎに触れるのは【事実】で「10日以上」となっている場合だけ（その場合は医師への相談を勧める）。",
    "記録件数が少なく傾向が言えない場合は、その旨と、続けて記録すると分かることを 1 行で書く。",
    "見出しは付けず、「・」で始まる箇条書き 2〜5 行、各 60 文字以内。",
  ].join("\n");
  const prompt = `【事実】\n${facts.join("\n")}\n\n【記録】\n${lines.join("\n")}`;

  try {
    const raw = await runAI(c.env, system, prompt, 700);
    const text = raw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 1)
      .map((s) => s.replace(/^[-*•・\d.)\s]+/, "・"))
      .slice(0, 6)
      .join("\n");
    return c.json({ text, count: entries.length });
  } catch (e) {
    console.error("ai insight failed", e);
    return c.json({ error: "ai_failed" }, 502);
  }
});

// ---------- 気圧の注意のプッシュ通知 ----------
const vapid = (env: Env): VapidConfig | null => {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: "https://github.com/kkWorks1224/migraine-log" };
};
const MAX_SUBS_PER_USER = 10;

app.post("/api/push/subscribe", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ subscription?: any; lat?: number; lon?: number; threshold?: number; tz?: number }>();
  const s = body.subscription;
  const sub = s && { endpoint: s.endpoint, p256dh: s.keys?.p256dh, auth: s.keys?.auth };
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!validSub(sub) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return c.json({ error: "bad_request" }, 400);
  }
  const threshold = Math.min(-1, Math.max(-6, Number(body.threshold) || -2));
  const tz = Math.min(840, Math.max(-720, Math.round(Number(body.tz) || 0)));
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?1 AND endpoint != ?2")
    .bind(user.id, sub.endpoint)
    .first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_SUBS_PER_USER) return c.json({ error: "too_many" }, 409);
  const now = Date.now();
  // 位置は小数 1 桁（約 10km）に丸めて保存
  await c.env.DB.prepare(
    `INSERT INTO push_subs (endpoint, user_id, p256dh, auth, lat, lon, threshold, tz, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       lat = excluded.lat, lon = excluded.lon, threshold = excluded.threshold, tz = excluded.tz, updated_at = excluded.updated_at`,
  )
    .bind(sub.endpoint, user.id, sub.p256dh, sub.auth, Math.round(lat * 10) / 10, Math.round(lon * 10) / 10, threshold, tz, now)
    .run();
  return c.json({ ok: true });
});

app.post("/api/push/unsubscribe", async (c) => {
  const user = c.get("user");
  const { endpoint } = await c.req.json<{ endpoint?: string }>();
  if (typeof endpoint === "string") {
    await c.env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?1 AND user_id = ?2").bind(endpoint, user.id).run();
  }
  return c.json({ ok: true });
});

app.post("/api/push/test", async (c) => {
  const user = c.get("user");
  const v = vapid(c.env);
  if (!v) return c.json({ error: "not_configured" }, 503);
  if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `push:${user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
  const { results } = await c.env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?1").bind(user.id).all<PushSub>();
  let sent = 0;
  for (const s of results) {
    const st = await sendPush(s, { title: "頭上注意", body: "通知は届いています。気圧が下がりそうなときにお知らせします。", tag: "test" }, v, 600);
    if (st === 404 || st === 410) await c.env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?1").bind(s.endpoint).run();
    else if (st < 300) sent++;
  }
  return c.json({ sent });
});

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// 1 時間ごと：購読者の地点の予報を見て、この先 12 時間に注意が必要な低下があれば知らせる
type SubRow = PushSub & { lat: number; lon: number; threshold: number; tz: number; last_event: number };
export async function runForecastAlerts(env: Env, now = Date.now()) {
  const v = vapid(env);
  if (!v) return { checked: 0, sent: 0 };
  const { results } = await env.DB.prepare(
    "SELECT endpoint, p256dh, auth, lat, lon, threshold, tz, last_event FROM push_subs ORDER BY updated_at DESC LIMIT 2000",
  ).all<SubRow>();
  const series = new Map<string, Hourly | null>();
  let sent = 0;
  for (const s of results) {
    // 夜間（現地 22:00〜6:59）は送らない。翌朝の回で、まだ始まっていない低下だけ知らせる
    const local = new Date(now + s.tz * 6e4);
    const hour = local.getUTCHours();
    if (hour >= 22 || hour < 7) continue;
    const key = `${s.lat}/${s.lon}`;
    if (!series.has(key)) {
      const slot = Math.floor(now / 36e5);
      series.set(key, await cached(`om8/${s.lat}/${s.lon}/2/${slot}`, 3600, () => openMeteo(s.lat, s.lon, 2)).then((h) => h ?? metNo(s.lat, s.lon)));
    }
    const h = series.get(key);
    if (!h) continue;
    const ev = findDrops(h, now, now + 12 * 36e5, s.threshold)[0];
    // 同じ低下を何度も知らせない（前回知らせた低下の開始から 6 時間以内は同じものとみなす）
    if (!ev || Math.abs(ev.from - s.last_event) < 6 * 36e5) continue;
    const t = new Date(ev.from + s.tz * 6e4);
    const sameDay = t.getUTCDate() === local.getUTCDate();
    const when = `${sameDay ? "" : "明日 "}${t.getUTCHours()}時ごろ`;
    const drop = Math.abs(ev.peak).toFixed(1);
    const body =
      ev.from <= now + 30 * 6e4
        ? `今、気圧が下がっています（6時間で −${drop}hPa）。薬を手元に。`
        : `${when}から気圧が下がります（6時間で −${drop}hPa）。薬を手元に。`;
    const st = await sendPush(
      s,
      { title: "気圧の注意", body, tag: "pressure" },
      v,
    );
    if (st === 404 || st === 410) {
      await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?1").bind(s.endpoint).run();
    } else if (st < 300) {
      sent++;
      await env.DB.prepare("UPDATE push_subs SET last_event = ?1 WHERE endpoint = ?2").bind(ev.from, s.endpoint).run();
    } else {
      console.error("push failed", st);
    }
  }
  return { checked: results.length, sent };
}

// ローカル開発専用：Cron の処理を手動で走らせる
app.get("/auth/dev/cron", async (c) => {
  const host = new URL(c.req.url).hostname;
  if (c.env.DEV_LOGIN !== "1" || !["localhost", "127.0.0.1"].includes(host)) return c.notFound();
  const at = Number(c.req.query("at")) || Date.now();
  return c.json(await runForecastAlerts(c.env, at));
});

export default {
  fetch: app.fetch,
  scheduled: (_e: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runForecastAlerts(env).then((r) => console.log("forecast alerts", r)));
  },
} satisfies ExportedHandler<Env>;
