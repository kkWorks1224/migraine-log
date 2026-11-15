import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { STATUSES, SYMPTOMS, TRIGGERS, type Entry } from "../src/types";

type Env = {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  AI_MODEL: string;
  DEV_LOGIN?: string;
  AI_LIMITER?: RateLimit;
  WEATHER_LIMITER?: RateLimit;
};
type User = { id: string; email: string; name: string; picture: string };
type Vars = { user: User };

const SESSION_DAYS = 60;
const MAX_ENTRIES_PER_USER = 20000;
const AI_DAILY_LIMIT = 100;
const UA = "migraine-log/1.0 (+https://github.com/kkWorks1224/migraine-log)";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);

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

// ---------- auth（Google OAuth 2.0 Authorization Code + PKCE） ----------
app.get("/auth/login", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.text("Google OAuth is not configured", 503);
  const state = randomToken(16);
  const verifier = randomToken(48);
  setCookie(c, "oauth", `${state}.${verifier}`, {
    httpOnly: true,
    secure: isSecure(c.req.url),
    sameSite: "Lax",
    path: "/auth",
    maxAge: 600,
  });
  const q = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: new URL("/auth/callback", c.req.url).toString(),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
});

app.get("/auth/callback", async (c) => {
  const [state, verifier] = (getCookie(c, "oauth") ?? "").split(".");
  deleteCookie(c, "oauth", { path: "/auth" });
  const code = c.req.query("code");
  if (!code || !state || state !== c.req.query("state")) {
    console.error("oauth state mismatch", { hasCode: !!code, hasCookie: !!state, err: c.req.query("error") });
    return c.redirect("/?auth=error");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: new URL("/auth/callback", c.req.url).toString(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    console.error("token exchange failed", res.status, await res.text());
    return c.redirect("/?auth=error");
  }
  const { id_token } = (await res.json()) as { id_token: string };
  // id_token は Google のトークンエンドポイントから TLS で直接受け取ったものなので、クレームのみ検証する
  const claims = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (ch) =>
        ch.charCodeAt(0),
      ),
    ),
  );
  const validIss = ["https://accounts.google.com", "accounts.google.com"].includes(claims.iss);
  if (!validIss || claims.aud !== c.env.GOOGLE_CLIENT_ID || claims.exp * 1000 < Date.now()) {
    console.error("id_token claims invalid");
    return c.redirect("/?auth=error");
  }
  await createSession(c, {
    id: `g:${claims.sub}`,
    email: claims.email ?? "",
    name: claims.name ?? "",
    picture: claims.picture ?? "",
  });
  return c.redirect("/");
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
type Hourly = { t: number[]; p: (number | null)[]; temp: (number | null)[]; rh: (number | null)[]; code: (number | null)[] };

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
    past_days: String(past),
    forecast_days: "2",
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
    return {
      t: h.time.map((s: number) => s * 1000),
      p: h.pressure_msl,
      temp: h.temperature_2m,
      rh: h.relative_humidity_2m,
      code: h.weather_code,
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

async function placeName(lat: number, lon: number): Promise<string | null> {
  return cached(`place/${lat}/${lon}`, 30 * 86400, async () => {
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
    cached(`om/${lat}/${lon}/${past}/${hour}`, 3600, () => openMeteo(lat, lon, past)).then(
      (h) => h ?? cached(`met/${lat}/${lon}/${hour}`, 3600, () => metNo(lat, lon)),
    ),
    placeName(lat, lon),
  ]);
  if (!hourly) return c.json({ error: "weather_unavailable" }, 502);
  return c.json({ lat, lon, place, hourly }, 200, { "cache-control": "private, max-age=600" });
});

// ---------- api（ログイン必須） ----------
app.get("/api/me", async (c) => {
  const user = await currentUser(c);
  return c.json({ user, googleEnabled: Boolean(c.env.GOOGLE_CLIENT_ID) });
});

app.use("/api/*", async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
});

const strList = (v: unknown, max = 20, len = 40) =>
  Array.isArray(v)
    ? [...new Set(v.filter((s): s is string => typeof s === "string").map((s) => s.trim().slice(0, len)).filter(Boolean))].slice(0, max)
    : [];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// 受け取った記録を検証・正規化（未知のキーは捨てる）
function sanitize(e: any): Entry | null {
  if (!e || typeof e.id !== "string" || !e.id || e.id.length > 64) return null;
  if (!STATUSES.includes(e.status)) return null;
  if (![e.startedAt, e.createdAt, e.updatedAt].every(Number.isFinite)) return null;
  const w = e.weather;
  return {
    id: e.id,
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
    "ユーザーのメモは音声入力のため誤字・脱字・誤変換を含むことがあります（例：「ロキソニン」が「六その人」、「寝不足」が「ねぶそく」）。意図を汲んで読み取ってください。",
    `現在日時は ${now || "不明"}（ユーザーの現地時刻）です。`,
    "次のキーを持つ JSON のみを出力してください:",
    '{"memo": 誤変換を直した元メモ（要約しない）,',
    ' "intensity": 頭痛の強さ 0=記載なし 1=軽い 2=中くらい・支障あり 3=強い・寝込む,',
    ' "meds": 飲んだ薬の名前の配列（一般的な表記に直す。例: ロキソニン, イブ, カロナール, イミグラン, マクサルト, レルパックス, アマージ, ゾーミッグ）,',
    ' "sleepLack": 寝不足・睡眠不足の記載があれば true,',
    ` "triggers": きっかけの配列。次から選ぶ: ${TRIGGERS.join("、")},`,
    ` "symptoms": 症状の配列。次から選ぶ: ${SYMPTOMS.join("、")},`,
    ' "time": 頭痛が始まった時刻の記載があれば "YYYY-MM-DDTHH:MM"（「今朝7時」「昨夜」などは現在日時から計算）、無ければ null,',
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
      sleepLack: p.sleepLack === true,
      triggers: strList(p.triggers).filter((s) => TRIGGERS.includes(s)),
      symptoms: strList(p.symptoms).filter((s) => SYMPTOMS.includes(s)),
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
  const entries = results.map((r) => JSON.parse(r.data) as Entry);
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
      w ? `気圧${Math.round(w.pressure)}hPa${w.d3h != null ? ` 3h${w.d3h > 0 ? "+" : ""}${w.d3h.toFixed(1)}` : ""}${w.d24h != null ? ` 24h${w.d24h > 0 ? "+" : ""}${w.d24h.toFixed(1)}` : ""}` : "",
      e.memo ? `メモ:${e.memo.replace(/\s+/g, " ").slice(0, 60)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  });

  const system = [
    "あなたは頭痛ダイアリーを読み解くアシスタントです。診断や処方はしません。",
    "記録から読み取れる傾向（曜日・時間帯、気圧の低下や変化、寝不足、誘因、薬の効き方と服薬日数）を、具体的な数字を添えて日本語で簡潔にまとめてください。",
    "月に 10 日以上の鎮痛薬・トリプタンの服用が見られる場合は、薬の使いすぎによる頭痛の可能性を医師に相談するよう一言添えること。",
    "見出しは付けず、「・」で始まる箇条書き 3〜5 行、各 60 文字以内。記録に無いことは書かない。",
  ].join("\n");

  try {
    const raw = await runAI(c.env, system, lines.join("\n"), 700);
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

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
