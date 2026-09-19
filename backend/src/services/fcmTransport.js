// TRANSPORT FCM (HTTP v1) — tanpa dependency baru.
//
// Mengirim push ke token FCM asli memakai akun layanan Google (service
// account): membuat JWT RS256 → menukar dengan access token OAuth2 → memanggil
// https://fcm.googleapis.com/v1/projects/{project}/messages:send.
//
// Kredensial dibaca dari env; bila TIDAK lengkap, semua fungsi kirim menjadi
// no-op yang melapor `{ skipped: "no_credentials" }` — TIDAK PERNAH melempar
// dan tidak pernah mencoba jaringan (fitur push mati diam-diam, bukan error).
//
// Env (salah satu bentuk):
//   FCM_SERVICE_ACCOUNT_JSON   isi JSON akun layanan (boleh base64)
//   ATAU  FCM_PROJECT_ID + FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY (\n literal diperbolehkan)
// Token Expo (ExponentPushToken[...]) TIDAK lewat sini — lihat services/expoPush.js.

import jwt from "jsonwebtoken";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let transport = { fetch: (...a) => globalThis.fetch(...a), now: () => Date.now() };
/** Ganti fetch/jam — hanya untuk tes. */
export function setFcmTransportForTests(t) { transport = { ...transport, ...t }; cached = null; }

let cached = null; // { token, expiresAt }

export function readFcmCredentials(env = process.env) {
  try {
    if (env.FCM_SERVICE_ACCOUNT_JSON) {
      let raw = env.FCM_SERVICE_ACCOUNT_JSON.trim();
      if (!raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
      const j = JSON.parse(raw);
      if (j.project_id && j.client_email && j.private_key) {
        return { projectId: j.project_id, clientEmail: j.client_email, privateKey: j.private_key };
      }
      return null;
    }
    if (env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) {
      return {
        projectId: env.FCM_PROJECT_ID,
        clientEmail: env.FCM_CLIENT_EMAIL,
        privateKey: env.FCM_PRIVATE_KEY.replace(/\\n/g, "\n"),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function fcmConfigured() {
  return readFcmCredentials() !== null;
}

async function getAccessToken(cred) {
  const now = transport.now();
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;
  const iat = Math.floor(now / 1000);
  const assertion = jwt.sign(
    { iss: cred.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 },
    cred.privateKey,
    { algorithm: "RS256" }
  );
  const res = await transport.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!res.ok) throw new Error(`FCM oauth gagal (${res.status})`);
  const j = await res.json();
  cached = { token: j.access_token, expiresAt: now + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

const HARUS_DIHAPUS = new Set(["UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND", "SENDER_ID_MISMATCH"]);

/**
 * Kirim satu pesan. Hasil:
 *   { skipped:"no_credentials" }
 *   { ok:true }
 *   { ok:false, invalidToken:true }   → token mati, hapus dari database
 *   { ok:false, error:"..." }         → gagal sementara
 * `data` bernilai string (aturan FCM). Layar terkunci: visibility PRIVATE,
 * isi sensitif (nominal) sebaiknya hanya di `data`, bukan title/body.
 */
export async function sendFcm(token, { title, body, data = {}, channelId = "default" } = {}) {
  const cred = readFcmCredentials();
  if (!cred) return { skipped: "no_credentials" };
  try {
    const access = await getAccessToken(cred);
    const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
    const res = await transport.fetch(`https://fcm.googleapis.com/v1/projects/${cred.projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data: stringData,
          android: {
            priority: "HIGH",
            notification: { channel_id: channelId, visibility: "PRIVATE" },
          },
        },
      }),
    });
    if (res.ok) return { ok: true };
    let status = "";
    try { status = (await res.json())?.error?.status || ""; } catch { /* abaikan */ }
    if (res.status === 404 || HARUS_DIHAPUS.has(status)) return { ok: false, invalidToken: true };
    if (res.status === 401) cached = null;
    return { ok: false, error: `FCM ${res.status} ${status}`.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
