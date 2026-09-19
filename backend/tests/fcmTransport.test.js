import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { readFcmCredentials, fcmConfigured, sendFcm, setFcmTransportForTests } from "../src/services/fcmTransport.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const ENV_KEYS = ["FCM_SERVICE_ACCOUNT_JSON", "FCM_PROJECT_ID", "FCM_CLIENT_EMAIL", "FCM_PRIVATE_KEY"];

function bersih() { for (const k of ENV_KEYS) delete process.env[k]; }
function pasangEnv() {
  process.env.FCM_PROJECT_ID = "proyek-uji";
  process.env.FCM_CLIENT_EMAIL = "svc@proyek-uji.iam.gserviceaccount.com";
  process.env.FCM_PRIVATE_KEY = privateKey.replace(/\n/g, "\\n"); // bentuk umum di file .env
}
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("Tanpa kredensial: tidak dikonfigurasi, sendFcm = no-op tanpa menyentuh jaringan", async () => {
  bersih();
  let dipanggil = 0;
  setFcmTransportForTests({ fetch: async () => { dipanggil++; return resp(200, {}); } });
  assert.equal(fcmConfigured(), false);
  assert.deepEqual(await sendFcm("token", { title: "t", body: "b" }), { skipped: "no_credentials" });
  assert.equal(dipanggil, 0);
});

test("Kredensial lengkap dari 3 env (backslash-n literal) atau JSON (mentah/base64) terbaca; JSON rusak = tidak terkonfigurasi", () => {
  bersih(); pasangEnv();
  const c = readFcmCredentials();
  assert.equal(c.projectId, "proyek-uji");
  assert.ok(c.privateKey.includes("BEGIN PRIVATE KEY") && c.privateKey.includes("\n"));

  bersih();
  const json = JSON.stringify({ project_id: "p2", client_email: "x@y", private_key: privateKey });
  process.env.FCM_SERVICE_ACCOUNT_JSON = json;
  assert.equal(readFcmCredentials().projectId, "p2");
  process.env.FCM_SERVICE_ACCOUNT_JSON = Buffer.from(json).toString("base64");
  assert.equal(readFcmCredentials().projectId, "p2");
  process.env.FCM_SERVICE_ACCOUNT_JSON = "{rusak";
  assert.equal(fcmConfigured(), false);
  bersih();
});

test("Kirim: tukar JWT RS256 → access token → POST FCM v1 dengan channel, data string, visibility PRIVATE; token OAuth di-cache", async () => {
  bersih(); pasangEnv();
  const panggilan = [];
  setFcmTransportForTests({
    now: () => 1_800_000_000_000,
    fetch: async (url, opts) => {
      panggilan.push({ url, opts });
      if (String(url).includes("oauth2.googleapis.com")) return resp(200, { access_token: "AT-1", expires_in: 3600 });
      return resp(200, { name: "projects/x/messages/1" });
    },
  });
  const r1 = await sendFcm("TOKEN-1", { title: "Judul", body: "Isi", data: { id: 7, type: "approval_requested" }, channelId: "approval" });
  assert.deepEqual(r1, { ok: true });
  assert.equal(panggilan.length, 2);

  const assertion = new URLSearchParams(panggilan[0].opts.body).get("assertion");
  const claims = jwt.verify(assertion, publicKey, { algorithms: ["RS256"], clockTimestamp: 1_800_000_000 });
  assert.equal(claims.iss, "svc@proyek-uji.iam.gserviceaccount.com");
  assert.equal(claims.scope, "https://www.googleapis.com/auth/firebase.messaging");

  assert.equal(panggilan[1].url, "https://fcm.googleapis.com/v1/projects/proyek-uji/messages:send");
  assert.equal(panggilan[1].opts.headers.Authorization, "Bearer AT-1");
  const msg = JSON.parse(panggilan[1].opts.body).message;
  assert.equal(msg.token, "TOKEN-1");
  assert.deepEqual(msg.data, { id: "7", type: "approval_requested" });
  assert.equal(msg.android.notification.channel_id, "approval");
  assert.equal(msg.android.notification.visibility, "PRIVATE");

  await sendFcm("TOKEN-2", { title: "a", body: "b" });
  assert.equal(panggilan.filter((p) => String(p.url).includes("oauth2")).length, 1, "access token dipakai ulang");
  bersih();
});

test("Token mati (404/UNREGISTERED) ditandai invalidToken; galat sementara bukan; jaringan putus tidak melempar", async () => {
  bersih(); pasangEnv();
  let mode = "ok";
  setFcmTransportForTests({
    now: () => Date.now(),
    fetch: async (url) => {
      if (String(url).includes("oauth2")) return resp(200, { access_token: "AT", expires_in: 3600 });
      if (mode === "404") return resp(404, { error: { status: "UNREGISTERED" } });
      if (mode === "500") return resp(500, { error: { status: "INTERNAL" } });
      if (mode === "throw") throw new Error("ECONNRESET");
      return resp(200, {});
    },
  });
  mode = "404";
  assert.deepEqual(await sendFcm("t", { title: "a", body: "b" }), { ok: false, invalidToken: true });
  mode = "500";
  const r = await sendFcm("t", { title: "a", body: "b" });
  assert.equal(r.ok, false);
  assert.equal(r.invalidToken, undefined);
  mode = "throw";
  const t = await sendFcm("t", { title: "a", body: "b" });
  assert.equal(t.ok, false);
  bersih();
});
