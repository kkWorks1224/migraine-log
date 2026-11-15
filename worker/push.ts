// Web Push（RFC 8291 の aes128gcm 暗号化 + RFC 8292 の VAPID）を Web Crypto だけで実装する。
// 外部のプッシュ用ライブラリは Node 前提のものが多く Workers で動かないため。

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const fromB64u = (s: string): B =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
type B = Uint8Array<ArrayBuffer>;
const concat = (...parts: B[]): B => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
async function hmac(key: B, data: B): Promise<B> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export type PushSub = { endpoint: string; p256dh: string; auth: string };

// RFC 8291：ペイロードを購読者の公開鍵で暗号化
export async function encryptPayload(sub: PushSub, payload: B, salt: B = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  const as = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", as.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // レコードサイズ 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// RFC 8292：VAPID の JWT（ES256）
async function vapidAuth(endpoint: string, privateJwk: JsonWebKey, publicKey: string, subject: string) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

export type VapidConfig = { publicKey: string; privateJwk: JsonWebKey; subject: string };

// 送信。戻り値の status が 404/410 のときは購読が無効になっている
export async function sendPush(sub: PushSub, data: unknown, v: VapidConfig, ttl = 6 * 3600) {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(data)));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuth(sub.endpoint, v.privateJwk, v.publicKey, v.subject),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(ttl),
      urgency: "normal",
    },
    body,
  });
  return res.status;
}

// SSRF 対策：主要ブラウザのプッシュサービスだけを許可
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/];
export function validSub(s: any): s is PushSub {
  if (!s || typeof s.endpoint !== "string" || s.endpoint.length > 1024) return false;
  let u: URL;
  try {
    u = new URL(s.endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || !PUSH_HOSTS.some((re) => re.test(u.hostname))) return false;
  try {
    return fromB64u(s.p256dh).length === 65 && fromB64u(s.auth).length === 16;
  } catch {
    return false;
  }
}
