// Tes capture atribusi CTWA FASE 0 (services/ctwaCapture.js).
//
// Prinsip tes: payload di bawah SENGAJA diisi "kanari" — nomor, nama, isi chat,
// teks kesehatan, token — di SEMUA tempat yang mungkin bocor (JID, pushName,
// body, quotedMessage, judul/isi iklan, query sourceURL, path wa.me). Tes
// memastikan TIDAK SATU PUN kanari muncul di observasi maupun di berkas.
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildObservation, captureInbound, describeSourceUrl, purgeCaptures, effectiveRetentionDays,
  _getStats, _resetForTests, MAX_RETENTION_DAYS,
  flushCapture, _queueLength, _hooks, MAX_QUEUE, BREAKER_FAILS, BREAKER_COOLDOWN_MS, SIGNAL_VERDICTS,
} from "../src/services/ctwaCapture.js";
import { summarize, summarizeCounts, igShortcodeToMediaId } from "../src/services/ctwaCaptureAnalysis.js";

const SALT = "salt-uji-0123456789abcdef";
const CLID = "AfhKBK8ZBWyKw3p49jW-KFh_rNlyzXmCKW0eSdHULJZtXqZk"; // ekor "tXqZk" tak boleh muncul

const CANARIES = [
  "6281234567890", "Budi Canary Santoso", "rahasia keluhan pinggang canary",
  "saraf kejepit canary", "sk-canary-token-123", "IklanCanaryJudul", "IklanCanaryIsi",
  "quoted canary text", "fbclid-canary-value", "SAKIT",
];

function ctwaPayload({ sourceId, sourceType, extra = {}, earExtra = {}, wrap = false } = {}) {
  const ear = {
    sourceURL: "https://www.instagram.com/p/DXWbO-EAOeT/?utm_source=ig_ads&fbclid=fbclid-canary-value&phone=6281234567890",
    ctwaClid: CLID,
    containsCtwaFlowsAutoReply: false,
    title: "IklanCanaryJudul",
    body: "IklanCanaryIsi",
    thumbnail: "QkFTRTY0LUNBTkFSWQ==",
    ...(sourceId !== undefined ? { sourceID: sourceId } : {}),
    ...(sourceType !== undefined ? { sourceType } : {}),
    ...earExtra,
  };
  const ctx = {
    conversionSource: "FB_Ads",
    entryPointConversionSource: "ctwa_ad",
    entryPointConversionApp: "facebook",
    entryPointConversionDelaySeconds: 24,
    ctwaSignals: "all,all",
    externalAdReply: ear,
    ...extra,
  };
  const inner = { extendedTextMessage: { text: "rahasia keluhan pinggang canary", contextInfo: ctx } };
  return {
    id: "false_6281234567890@c.us_3EB0AAAA1111",
    from: "6281234567890@c.us",
    body: "rahasia keluhan pinggang canary, saraf kejepit canary, SAKIT",
    timestamp: 1790000000,
    _data: {
      Info: { Chat: "6281234567890@c.us", Sender: "6281234567890@c.us", PushName: "Budi Canary Santoso", Type: "text" },
      Message: wrap ? { ephemeralMessage: { message: inner } } : inner,
      apiKey: "sk-canary-token-123",
    },
  };
}

function plainPayload() {
  return {
    id: "false_6281234567890@c.us_3EB0BBBB2222",
    body: "rahasia keluhan pinggang canary",
    timestamp: 1790000000,
    _data: { Info: { PushName: "Budi Canary Santoso" }, Message: { conversation: "rahasia keluhan pinggang canary" } },
  };
}

function assertNoCanary(text, label = "") {
  for (const c of CANARIES) assert.ok(!text.includes(c), `kanari bocor${label ? " (" + label + ")" : ""}: ${c}`);
  assert.ok(!text.includes("tXqZk"), "ekor ctwa_clid bocor");
  assert.ok(!text.includes(CLID), "ctwa_clid utuh bocor");
  assert.ok(!/@c\.us|@lid|@s\.whatsapp\.net/.test(text), "JID bocor");
}

const ctx = (over = {}) => ({ event: "message", engine: "GOWS", externalId: "false_6281234567890@c.us_3EB0AAAA1111", isNewCustomer: true, salt: SALT, now: 1790000100000, ...over });

// ── builder murni ──────────────────────────────────────────────────────────
test("CTWA lengkap: field terbaca, nilai lolos allowlist, tidak ada kanari", () => {
  const o = buildObservation(ctwaPayload({ sourceId: "120210000000001", sourceType: "ad" }), ctx());
  assert.equal(o.verdict, "CTWA_AD");
  assert.equal(o.customer, "NEW");
  assert.equal(o.messageType, "extendedTextMessage");
  assert.equal(o.fields.sourceId, "present");
  assert.equal(o.fields.sourceType, "present");
  assert.equal(o.fields.ctwaClid, "present");
  assert.equal(o.values.sourceId, "120210000000001");
  assert.equal(o.values.sourceType, "ad");
  assert.equal(o.values.entryPointConversionDelaySeconds, 24);
  assert.equal(o.values.containsCtwaFlowsAutoReply, false);
  assert.equal(o.ctwaClid.len, CLID.length);
  assert.match(o.ctwaClid.hash, /^[0-9a-f]{16}$/);
  assert.equal(o.sourceUrl.kind, "instagram_post");
  assert.equal(o.sourceUrl.idToken, "DXWbO-EAOeT");
  assert.deepEqual(o.sourceUrl.queryParamNames, ["fbclid", "phone", "utm_source"]);
  assertNoCanary(JSON.stringify(o), "observasi");
});

test("payload seperti produksi 13 Agt (tanpa sourceID/sourceType): ditandai 'absent', bukan dikarang", () => {
  const o = buildObservation(ctwaPayload(), ctx());
  assert.equal(o.verdict, "CTWA_AD");
  assert.equal(o.fields.sourceId, "absent");
  assert.equal(o.fields.sourceType, "absent");
  assert.equal(o.values.sourceId, null);
  assert.equal(o.values.sourceType, null);
  assert.ok(o.externalAdReplyKeys.includes("ctwaClid"));
  assert.ok(!o.externalAdReplyKeys.includes("sourceID"));
});

test("bedakan absent / empty / present (termasuk nilai falsy yang sah)", () => {
  const o = buildObservation(
    ctwaPayload({ sourceId: "", sourceType: null, extra: { entryPointConversionDelaySeconds: 0 } }),
    ctx(),
  );
  assert.equal(o.fields.sourceId, "empty");
  assert.equal(o.fields.sourceType, "empty");
  assert.equal(o.fields.entryPointConversionDelaySeconds, "present");
  assert.equal(o.values.entryPointConversionDelaySeconds, 0);
  assert.equal(o.fields.containsCtwaFlowsAutoReply, "present");
  assert.equal(o.values.containsCtwaFlowsAutoReply, false);
});

test("nilai di luar bentuk allowlist TIDAK disimpan, hanya dicatat 'rejected'", () => {
  const o = buildObservation(ctwaPayload({ sourceId: "bukan-angka Budi Canary Santoso", sourceType: "x".repeat(80) }), ctx());
  assert.equal(o.values.sourceId, null);
  assert.equal(o.values.sourceType, null);
  assert.deepEqual(o.rejected.sort(), ["sourceId", "sourceType"]);
  assertNoCanary(JSON.stringify(o));
});

test("payload BUKAN CTWA tidak menghasilkan data atribusi apa pun", () => {
  const a = buildObservation(plainPayload(), ctx());
  assert.equal(a.verdict, "NO_CONTEXT_INFO");
  assert.equal(a.fields, undefined);
  assert.equal(a.ctwaClid, undefined);
  assert.equal(a.sourceUrl, undefined);

  const reply = plainPayload();
  reply._data.Message = { extendedTextMessage: { text: "x", contextInfo: { stanzaId: "ABC", participant: "6281234567890@c.us", quotedMessage: { conversation: "quoted canary text" } } } };
  const b = buildObservation(reply, ctx());
  assert.equal(b.verdict, "CONTEXT_NON_AD");
  assert.equal(b.ctwaClid, null);
  assert.ok(Object.values(b.values).every((v) => v === null));
  assertNoCanary(JSON.stringify(b), "reply");

  const kosong = buildObservation({ id: "false_x_3EB0CCCC", _data: {} }, ctx());
  assert.equal(kosong.verdict, "NO_MESSAGE_BODY");
});

test("entry point non-iklan (QR/profil) tanpa externalAdReply = ENTRY_POINT_OTHER (bersinyal, tapi BUKAN CTWA)", () => {
  const p = plainPayload();
  p._data.Message = { extendedTextMessage: { contextInfo: { conversionSource: "qr_code", entryPointConversionSource: "profile_link" } } };
  const o = buildObservation(p, ctx());
  assert.equal(o.verdict, "ENTRY_POINT_OTHER");
  assert.equal(o.ctwaClid, null);
  assert.ok(SIGNAL_VERDICTS.has(o.verdict));
});

test("key atribusi di luar contextInfo (mis. _data.Info.CtwaContext) = OTHER_ATTRIBUTION_FIELD; nilainya tidak disalin", () => {
  const p = plainPayload();
  p._data.Info.CtwaContext = { headline: "IklanCanaryJudul", phone: "6281234567890" };
  const o = buildObservation(p, ctx());
  assert.equal(o.verdict, "OTHER_ATTRIBUTION_FIELD");
  assert.deepEqual(o.signalKeys, ["CtwaContext"]);
  assertNoCanary(JSON.stringify(o));
});

test("pesan biasa & reply: verdict TIDAK bersinyal (tidak akan ditulis ke JSONL)", () => {
  assert.ok(!SIGNAL_VERDICTS.has(buildObservation(plainPayload(), ctx()).verdict));
  const reply = plainPayload();
  reply._data.Message = { extendedTextMessage: { contextInfo: { stanzaId: "ABC", quotedMessage: { conversation: "x" }, mentionedJid: ["6281234567890@c.us"], expiration: 0 } } };
  const o = buildObservation(reply, ctx());
  assert.equal(o.verdict, "CONTEXT_NON_AD");
  assert.ok(!SIGNAL_VERDICTS.has(o.verdict));
  assert.ok(!SIGNAL_VERDICTS.has(buildObservation({ id: "x", _data: {} }, ctx()).verdict));
});

test("externalAdReply tanpa penanda iklan & tanpa clid = AD_REPLY_UNMARKED (diamati, tidak diklaim iklan)", () => {
  const p = plainPayload();
  p._data.Message = { extendedTextMessage: { contextInfo: { externalAdReply: { sourceURL: "https://example.org/x", title: "IklanCanaryJudul" } } } };
  const o = buildObservation(p, ctx());
  assert.equal(o.verdict, "AD_REPLY_UNMARKED");
  assert.equal(o.sourceUrl.kind, "other_host");
  assert.equal(o.sourceUrl.host, undefined);
  assertNoCanary(JSON.stringify(o));
});

test("contextInfo terbungkus (ephemeralMessage) tetap ditemukan; kedalaman dicatat", () => {
  const o = buildObservation(ctwaPayload({ wrap: true }), ctx());
  assert.equal(o.verdict, "CTWA_AD");
  assert.equal(o.depth, 3); // Message > ephemeralMessage > message > extendedTextMessage
});

test("contextInfo di dalam quotedMessage TIDAK ditelusuri", () => {
  const p = plainPayload();
  p._data.Message = {
    extendedTextMessage: {
      contextInfo: { quotedMessage: { extendedTextMessage: { contextInfo: { conversionSource: "FB_Ads", externalAdReply: { ctwaClid: CLID } } } } },
    },
  };
  const o = buildObservation(p, ctx());
  assert.equal(o.verdict, "CONTEXT_NON_AD");
  assert.equal(o.ctwaClid, null);
});

test("ctwa_clid: hanya hash+panjang; hash stabil, berbeda per salt; tanpa 4 karakter terakhir", () => {
  const a = buildObservation(ctwaPayload(), ctx());
  const b = buildObservation(ctwaPayload(), ctx());
  const c = buildObservation(ctwaPayload(), ctx({ salt: "salt-lain-0123456789abcdef" }));
  assert.equal(a.ctwaClid.hash, b.ctwaClid.hash);
  assert.notEqual(a.ctwaClid.hash, c.ctwaClid.hash);
  assert.deepEqual(Object.keys(a.ctwaClid).sort(), ["charset", "hash", "len"]);
});

test("timestamp provider: detik, milidetik, ISO; di luar akal sehat -> null", () => {
  const mk = (ts, info) => { const p = plainPayload(); p.timestamp = ts; if (info) p._data.Info.Timestamp = info; return buildObservation(p, ctx()).providerTs; };
  assert.equal(mk(1790000000), "2026-09-21T14:13:20.000Z");
  assert.equal(mk(1790000000000), "2026-09-21T14:13:20.000Z");
  assert.equal(mk(undefined, "2026-09-21T14:13:20Z"), "2026-09-21T14:13:20.000Z");
  assert.equal(mk(12), null);
  assert.equal(mk("bukan-waktu"), null);
});

// ── sourceURL ──────────────────────────────────────────────────────────────
test("describeSourceUrl: jenis & token publik; query hanya nama; wa.me tanpa path", () => {
  assert.deepEqual(
    (({ kind, idToken, queryParamNames }) => ({ kind, idToken, queryParamNames }))(describeSourceUrl("https://www.instagram.com/reel/Cabc123xyz_/?igsh=fbclid-canary-value")),
    { kind: "instagram_reel", idToken: "Cabc123xyz_", queryParamNames: ["igsh"] },
  );
  assert.equal(describeSourceUrl("https://fb.me/77pJdJNsy").kind, "fb_short");
  assert.equal(describeSourceUrl("https://fb.me/77pJdJNsy").idToken, "77pJdJNsy");
  const fbPost = describeSourceUrl("https://www.facebook.com/KlinikMatras/posts/122100000000000001");
  assert.equal(fbPost.kind, "facebook_post");
  assert.equal(fbPost.idToken, "122100000000000001");
  assert.equal(describeSourceUrl("https://www.facebook.com/watch/?v=123456789012").idToken, "123456789012");
  const wa = describeSourceUrl("https://wa.me/6281234567890?text=halo");
  assert.equal(wa.kind, "whatsapp_other");
  assert.ok(!JSON.stringify(wa).includes("6281234567890"));
  assert.equal(describeSourceUrl("https://wa.me/wamo/status/123").kind, "whatsapp_status");
  assert.equal(describeSourceUrl("https://contoh-lain.example/x/6281234567890").kind, "other_host");
  assert.ok(!JSON.stringify(describeSourceUrl("https://contoh-lain.example/x/6281234567890")).includes("contoh-lain"));
  assert.equal(describeSourceUrl("javascript:alert(1)").kind, "unparseable");
  assert.equal(describeSourceUrl("").kind, "unparseable");
  assert.equal(describeSourceUrl("x".repeat(3000)).kind, "unparseable");
});

test("igShortcodeToMediaId: basis-64 posisional; karakter asing -> null", () => {
  assert.equal(igShortcodeToMediaId("A"), "0");
  assert.equal(igShortcodeToMediaId("B"), "1");
  assert.equal(igShortcodeToMediaId("BA"), "64");
  assert.equal(igShortcodeToMediaId("B!"), null);
  assert.equal(igShortcodeToMediaId(""), null);
});

// ── penulis, flag, retensi ─────────────────────────────────────────────────
let tmp;
const ENV_KEYS = ["CTWA_ATTRIBUTION_CAPTURE_ENABLED", "CTWA_CAPTURE_HASH_SALT", "CTWA_CAPTURE_DIR", "CTWA_CAPTURE_RETENTION_DAYS", "CTWA_CAPTURE_MIN_FREE_MB"];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctwa-cap-"));
  process.env.CTWA_CAPTURE_DIR = path.join(tmp, "cap");
  delete process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED;
  delete process.env.CTWA_CAPTURE_HASH_SALT;
  delete process.env.CTWA_CAPTURE_RETENTION_DAYS;
  process.env.CTWA_CAPTURE_MIN_FREE_MB = "0"; // guard disk dimatikan kecuali tes yang memang menguji-nya
  _resetForTests();
});
afterEach(() => {
  _resetForTests(); // hentikan timer & kembalikan hook
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const settle = async (cond, ms = 2000) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10)); };
const capDir = () => process.env.CTWA_CAPTURE_DIR;
const lines = () => (fs.existsSync(capDir()) ? fs.readdirSync(capDir()).filter((f) => f.endsWith(".jsonl")).flatMap((f) => fs.readFileSync(path.join(capDir(), f), "utf8").split("\n").filter(Boolean)) : []);
const call = (over = {}) => captureInbound({ payload: ctwaPayload(), event: "message", engine: "GOWS", externalId: "false_6281234567890@c.us_3EB0AAAA1111", isNewCustomer: true, ...over });

test("flag default MATI: tidak ada berkas, tidak ada pekerjaan", async () => {
  assert.equal(call(), false);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(capDir()), false);
  assert.equal(_getStats().observed, 0);
});

test("flag selain persis 'true' dianggap mati", () => {
  process.env.CTWA_CAPTURE_HASH_SALT = SALT;
  for (const v of ["1", "TRUE", "yes", "false", ""]) { process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = v; assert.equal(call(), false, v); }
});

test("flag nyala tanpa salt: menolak menulis", async () => {
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true";
  assert.equal(call(), false);
  assert.equal(_getStats().skippedNoSalt, 1);
  assert.equal(fs.existsSync(capDir()), false);
});

test("flag nyala + salt: satu baris ter-sanitasi, nol kanari di berkas", async () => {
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true";
  process.env.CTWA_CAPTURE_HASH_SALT = SALT;
  assert.equal(call(), true);
  await settle(() => _getStats().written === 1);
  const ls = lines();
  assert.equal(ls.length, 1);
  assertNoCanary(ls[0], "berkas");
  const o = JSON.parse(ls[0]);
  assert.equal(o.verdict, "CTWA_AD");
  assert.equal(o.event, "message");
});

test("message + message.any untuk pesan yang sama (JID/prefix beda) = SATU observasi", async () => {
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true";
  process.env.CTWA_CAPTURE_HASH_SALT = SALT;
  call({ event: "message", externalId: "false_6281234567890@c.us_3EB0AAAA1111" });
  call({ event: "message.any", externalId: "false_201086224863438@lid_3EB0AAAA1111" });
  await settle(() => _getStats().written + _getStats().deduped >= 2);
  assert.equal(lines().length, 1);
  assert.equal(_getStats().deduped, 1);
});

test("customer baru DAN lama sama-sama teramati (pesan berbeda)", async () => {
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true";
  process.env.CTWA_CAPTURE_HASH_SALT = SALT;
  call({ externalId: "false_a@c.us_3EB0AAAA1111", isNewCustomer: true });
  call({ externalId: "false_a@c.us_3EB0AAAA2222", isNewCustomer: false });
  await settle(() => _getStats().written === 2);
  const rows = lines().map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.customer).sort(), ["EXISTING", "NEW"]);
});

test("pesan biasa TIDAK menghasilkan baris JSONL — hanya dihitung agregat (tanpa data customer)", async () => {
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true";
  process.env.CTWA_CAPTURE_HASH_SALT = SALT;
  for (let i = 0; i < 20; i++) call({ payload: plainPayload(), externalId: `false_a@c.us_3EB0PLAIN${i}`, isNewCustomer: i % 2 === 0 });
  const reply = plainPayload();
  reply._data.Message = { extendedTextMessage: { contextInfo: { stanzaId: "ABC", quotedMessage: { conversation: "quoted canary text" } } } };
  call({ payload: reply, externalId: "false_a@c.us_3EB0REPLY1" });
  await settle(() => _getStats().observed === 21);
  assert.equal(_getStats().observed, 21);
  assert.equal(_getStats().written, 0);
  await flushCapture();
  assert.equal(lines().length, 0, "tidak boleh ada satu pun baris per-pesan");
  const berkas = fs.readdirSync(capDir());
  assert.deepEqual(berkas, [`ctwa-capture-counts-${new Date().toISOString().slice(0, 10)}.json`]);
  const c = JSON.parse(fs.readFileSync(path.join(capDir(), berkas[0]), "utf8"));
  assert.equal(c.total, 21);
  assert.equal(c.signal, 0);
  assert.equal(c.verdicts.NO_CONTEXT_INFO, 20);
  assert.equal(c.verdicts.CONTEXT_NON_AD, 1);
  assert.equal(c.customer.NEW.total + c.customer.EXISTING.total, 21);
  // berkas agregat hanya angka: tidak ada ID pesan, hash, nomor, kanari
  const mentah = fs.readFileSync(path.join(capDir(), berkas[0]), "utf8");
  assertNoCanary(mentah, "counts");
  assert.ok(!/3EB0|msgIdHash/.test(mentah));
});

test("campuran: hanya pesan bersinyal yang ditulis; agregat mencatat keduanya", async () => {
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true";
  process.env.CTWA_CAPTURE_HASH_SALT = SALT;
  call({ payload: plainPayload(), externalId: "false_a@c.us_3EB0M1" });
  call({ payload: ctwaPayload(), externalId: "false_a@c.us_3EB0M2" });
  call({ payload: plainPayload(), externalId: "false_a@c.us_3EB0M3" });
  await settle(() => _getStats().written === 1 && _getStats().observed === 3);
  await flushCapture();
  assert.equal(lines().length, 1);
  assert.equal(JSON.parse(lines()[0]).verdict, "CTWA_AD");
  const c = JSON.parse(fs.readFileSync(path.join(capDir(), fs.readdirSync(capDir()).find((f) => f.includes("counts"))), "utf8"));
  assert.equal(c.total, 3);
  assert.equal(c.signal, 1);
  assert.equal(c.signalWritten, 1);
});

test("kegagalan tulis tidak melempar & tidak mengubah apa pun (dir = berkas biasa)", async () => {
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true";
  process.env.CTWA_CAPTURE_HASH_SALT = SALT;
  const berkas = path.join(tmp, "bukan-direktori");
  fs.writeFileSync(berkas, "x");
  process.env.CTWA_CAPTURE_DIR = berkas;
  assert.doesNotThrow(() => call());
  await settle(() => _getStats().failed >= 1);
  assert.equal(_getStats().failed >= 1, true);
  assert.equal(_getStats().written, 0);
});

test("payload yang meledak saat dibaca tidak melempar ke pemanggil", async () => {
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true";
  process.env.CTWA_CAPTURE_HASH_SALT = SALT;
  const jahat = new Proxy({}, { get() { throw new Error("boom"); }, has() { throw new Error("boom"); }, ownKeys() { throw new Error("boom"); } });
  assert.doesNotThrow(() => call({ payload: jahat }));
  await settle(() => _getStats().failed >= 1);
  assert.equal(_getStats().failed >= 1, true);
});

test("retensi: hapus berkas > N hari, simpan sisanya, JANGAN sentuh berkas lain; maksimum dipaksa 7", async () => {
  fs.mkdirSync(capDir(), { recursive: true });
  const now = Date.UTC(2026, 9, 9, 12, 0, 0);
  const tulis = (n) => fs.writeFileSync(path.join(capDir(), n), "{}\n");
  tulis("ctwa-capture-2026-10-09.jsonl"); // hari ini
  tulis("ctwa-capture-2026-10-03.jsonl"); // 6 hari -> simpan
  tulis("ctwa-capture-2026-10-01.jsonl"); // 8 hari -> hapus
  tulis("ctwa-capture-2026-09-01.jsonl"); // hapus
  tulis("catatan-penting.txt");            // bukan pola -> JANGAN disentuh
  tulis("ctwa-capture-2026-09-01.jsonl.bak"); // bukan pola -> JANGAN disentuh

  const dry = await purgeCaptures({ now, dryRun: true });
  assert.equal(dry.removed.length, 2);
  assert.equal(fs.readdirSync(capDir()).length, 6);

  const res = await purgeCaptures({ now });
  assert.deepEqual(res.removed.sort(), ["ctwa-capture-2026-09-01.jsonl", "ctwa-capture-2026-10-01.jsonl"]);
  assert.deepEqual(fs.readdirSync(capDir()).sort(), ["catatan-penting.txt", "ctwa-capture-2026-09-01.jsonl.bak", "ctwa-capture-2026-10-03.jsonl", "ctwa-capture-2026-10-09.jsonl"]);

  process.env.CTWA_CAPTURE_RETENTION_DAYS = "30";
  assert.equal(effectiveRetentionDays(), MAX_RETENTION_DAYS);
  // retentionDays 30 diminta eksplisit pun dipotong ke 7
  tulis("ctwa-capture-2026-10-01.jsonl");
  const res2 = await purgeCaptures({ now, retentionDays: 30 });
  assert.ok(res2.removed.includes("ctwa-capture-2026-10-01.jsonl"));

  const resAll = await purgeCaptures({ now, all: true });
  assert.equal(resAll.removed.length, 2);
  assert.deepEqual(fs.readdirSync(capDir()).sort(), ["catatan-penting.txt", "ctwa-capture-2026-09-01.jsonl.bak"]);
});

test("direktori belum ada: purge no-op, tidak melempar", async () => {
  const r = await purgeCaptures({ dir: path.join(tmp, "tidak-ada") });
  assert.deepEqual(r, { removed: [], kept: 0, errors: 0 });
});

test("purge harian jalan walau flag MATI (berkas lama ikut hilang setelah flag dimatikan)", async () => {
  fs.mkdirSync(capDir(), { recursive: true });
  fs.writeFileSync(path.join(capDir(), "ctwa-capture-2026-01-01.jsonl"), "{}\n");
  call(); // flag mati, tetapi memicu purge harian
  await settle(() => !fs.existsSync(path.join(capDir(), "ctwa-capture-2026-01-01.jsonl")));
  assert.equal(fs.existsSync(path.join(capDir(), "ctwa-capture-2026-01-01.jsonl")), false);
});

// ── ringkasan ──────────────────────────────────────────────────────────────
test("summarize: kesimpulan konservatif, ad-ID tidak pernah disimpulkan otomatis", () => {
  const a = buildObservation(ctwaPayload({ sourceId: "120210000000001", sourceType: "ad" }), ctx({ externalId: "f_a_3EB01" }));
  const b = buildObservation(ctwaPayload(), ctx({ externalId: "f_a_3EB02", isNewCustomer: false }));
  const n = buildObservation(plainPayload(), ctx({ externalId: "f_a_3EB03" }));
  const s = summarize([a, b, n, a]);
  assert.equal(s.totalObserved, 3);
  assert.equal(s.duplicatesIgnored, 1);
  assert.equal(s.ctwaAd.total, 2);
  assert.equal(s.ctwaAd.fieldPresence.sourceId.present, 1);
  assert.equal(s.ctwaAd.fieldPresence.sourceId.absent, 1);
  assert.equal(s.conclusions.sourceIdAvailablePct, 50);
  assert.equal(s.conclusions.enoughSample, false);
  assert.equal(s.conclusions.sourceIdLooksLikeAdId, null);
  assert.equal(s.byCustomer.EXISTING.CTWA_AD, 1);
  assert.equal(s.sourceUrl.instagramComparison.igPostsWithSourceId, 1);
  assert.equal(s.sourceUrl.instagramComparison.sourceIdDiffersFromDerivedPostId, 1);
});

test("performa builder: 5000 observasi jauh di bawah anggaran", () => {
  const p = ctwaPayload({ sourceId: "120210000000001", sourceType: "ad" });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 5000; i++) buildObservation(p, ctx({ externalId: `false_x@c.us_3EB${i}` }));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`# builder: ${(ms / 5000 * 1000).toFixed(1)} µs/observasi`);
  assert.ok(ms < 2000);
});

// ── HARDENING: antrean serial, batas antrean, breaker, disk, flag, restart ──
const hidupkan = () => { process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true"; process.env.CTWA_CAPTURE_HASH_SALT = SALT; };
const sinyal = (i, over = {}) => call({ payload: ctwaPayload(), externalId: `false_a@c.us_3EBX${i}`, ...over });
const hariIni = () => new Date().toISOString().slice(0, 10);
const jsonlHariIni = () => path.join(capDir(), `ctwa-capture-${hariIni()}.jsonl`);
const gerbang = () => { let buka; const p = new Promise((r) => { buka = r; }); return { p, buka }; };

test("append bersamaan: 300 pesan bersinyal serentak -> setiap baris utuh & unik, tidak ada yang menyisip", async () => {
  hidupkan();
  for (let i = 0; i < 300; i++) sinyal(i);
  await settle(() => _getStats().written === 300, 8000);
  assert.equal(_getStats().written, 300);
  const mentah = fs.readFileSync(jsonlHariIni(), "utf8");
  assert.ok(mentah.endsWith("\n"));
  const baris = mentah.split("\n").filter(Boolean);
  assert.equal(baris.length, 300);
  const ids = new Set(baris.map((l) => JSON.parse(l).msgIdHash)); // JSON.parse melempar bila ada baris rusak/bersisipan
  assert.equal(ids.size, 300);
});

test("antrean berbatas: lonjakan saat disk macet -> memori tidak tumbuh, kelebihan di-drop & dihitung, inbox tak terganggu", async () => {
  hidupkan();
  const g = gerbang();
  const asli = _hooks.appendFile;
  _hooks.appendFile = async (...a) => { await g.p; return asli(...a); };
  const total = MAX_QUEUE + 200;
  for (let i = 0; i < total; i++) assert.doesNotThrow(() => sinyal(i));
  await settle(() => _getStats().observed === total, 8000);
  assert.equal(_getStats().observed, total);
  assert.ok(_queueLength() <= MAX_QUEUE, `antrean ${_queueLength()} melebihi batas`);
  // 1 item sedang ditulis (tertahan) + MAX_QUEUE mengantre; sisanya di-drop
  assert.equal(_getStats().droppedQueueFull, total - (MAX_QUEUE + 1));
  g.buka();
  await settle(() => _getStats().written === MAX_QUEUE + 1, 8000);
  assert.equal(_getStats().written, MAX_QUEUE + 1);
  assert.equal(_queueLength(), 0);
  await flushCapture();
  const c = JSON.parse(fs.readFileSync(path.join(capDir(), `ctwa-capture-counts-${hariIni()}.json`), "utf8"));
  assert.equal(c.total, total, "volume agregat tetap lengkap walau baris di-drop");
  assert.equal(c.dropped.queueFull, total - (MAX_QUEUE + 1));
});

test("disk penuh (ENOSPC): breaker terbuka, penulisan berhenti tanpa menghantam disk, pulih sesudah jeda", async () => {
  hidupkan();
  let t = Date.now();
  _hooks.now = () => t;
  const asli = _hooks.appendFile;
  let panggilan = 0;
  _hooks.appendFile = async () => { panggilan++; throw Object.assign(new Error("disk penuh"), { code: "ENOSPC" }); };
  sinyal(1);
  await settle(() => _getStats().failed === 1);
  assert.equal(panggilan, 1);
  for (let i = 2; i < 12; i++) sinyal(i);
  await settle(() => _getStats().droppedBreaker === 10);
  assert.equal(_getStats().droppedBreaker, 10);
  assert.equal(panggilan, 1, "selama breaker terbuka appendFile tidak dipanggil lagi");
  assert.equal(_getStats().written, 0);

  _hooks.appendFile = asli;           // disk lega kembali
  t += BREAKER_COOLDOWN_MS + 1;       // lewat masa jeda
  sinyal(99);
  await settle(() => _getStats().written === 1);
  assert.equal(_getStats().written, 1);
  for (const l of lines()) JSON.parse(l); // semua baris yang ada utuh
});

test("kegagalan umum berturut-turut (folder tak writable): berhenti setelah BREAKER_FAILS, bukan tiap pesan", async () => {
  hidupkan();
  let panggilan = 0;
  _hooks.appendFile = async () => { panggilan++; throw Object.assign(new Error("x"), { code: "EACCES" }); };
  for (let i = 0; i < 30; i++) sinyal(i);
  await settle(() => _getStats().observed === 30);
  await settle(() => _getStats().failed + _getStats().droppedBreaker === 30);
  assert.equal(panggilan, BREAKER_FAILS);
  assert.equal(_getStats().failed, BREAKER_FAILS);
  assert.equal(_getStats().droppedBreaker, 30 - BREAKER_FAILS);
});

test("ruang disk di bawah ambang: tidak menulis (disk dipakai bersama Postgres/uploads); pulih setelah lega", async () => {
  hidupkan();
  process.env.CTWA_CAPTURE_MIN_FREE_MB = "500";
  let t = Date.now();
  _hooks.now = () => t;
  _hooks.statfs = async () => ({ bavail: 1000, bsize: 4096 }); // ~4 MB bebas
  sinyal(1);
  await settle(() => _getStats().droppedLowDisk === 1);
  assert.equal(_getStats().droppedLowDisk, 1);
  assert.equal(_getStats().written, 0);
  assert.equal(lines().length, 0);

  _hooks.statfs = async () => ({ bavail: 10_000_000, bsize: 4096 }); // ~40 GB
  t += 61_000;
  sinyal(2);
  await settle(() => _getStats().written === 1);
  assert.equal(_getStats().written, 1);
});

test("statfs gagal/tidak tersedia: tidak memblokir capture", async () => {
  hidupkan();
  process.env.CTWA_CAPTURE_MIN_FREE_MB = "500";
  _hooks.statfs = async () => { throw Object.assign(new Error("nope"), { code: "ENOSYS" }); };
  sinyal(1);
  await settle(() => _getStats().written === 1);
  assert.equal(_getStats().written, 1);
});

test("berkas harian penuh (5 MB): baris berikutnya di-drop & dihitung, tidak ada tulis", async () => {
  hidupkan();
  fs.mkdirSync(capDir(), { recursive: true });
  fs.writeFileSync(jsonlHariIni(), Buffer.concat([Buffer.alloc(5 * 1024 * 1024 - 10, 0x61), Buffer.from("\n")]));
  sinyal(1);
  await settle(() => _getStats().droppedFileCap === 1);
  assert.equal(_getStats().droppedFileCap, 1);
  assert.equal(_getStats().written, 0);
});

test("flag dimatikan saat antrean berisi: sisa antrean dibuang, tidak ditulis; panggilan baru langsung berhenti", async () => {
  hidupkan();
  const g = gerbang();
  const asli = _hooks.appendFile;
  _hooks.appendFile = async (...a) => { await g.p; return asli(...a); };
  for (let i = 0; i < 6; i++) sinyal(i);
  await settle(() => _getStats().observed === 6);
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "false";
  assert.equal(sinyal(100), false);
  g.buka();
  await settle(() => _queueLength() === 0 && _getStats().droppedFlagOff === 5);
  assert.equal(_getStats().droppedFlagOff, 5);
  assert.ok(_getStats().written <= 1, "hanya item yang sudah in-flight boleh selesai");
  await flushCapture(); // flag mati: agregat dibuang, tidak ditulis
  assert.equal(fs.readdirSync(capDir()).filter((f) => f.includes("counts")).length, 0);
});

test("salt tidak valid (kosong / terlalu pendek): tidak menulis apa pun, tidak membuat folder", async () => {
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true";
  for (const salt of [undefined, "", "pendek"]) {
    if (salt === undefined) delete process.env.CTWA_CAPTURE_HASH_SALT; else process.env.CTWA_CAPTURE_HASH_SALT = salt;
    assert.equal(sinyal(1), false);
  }
  await new Promise((r) => setTimeout(r, 50));
  await flushCapture();
  assert.equal(fs.existsSync(capDir()), false);
  assert.equal(_getStats().observed, 0);
  assert.equal(_getStats().skippedNoSalt, 3);
});

test("ekor berkas terpotong (crash/disk penuh) tidak merekat ke baris berikutnya", async () => {
  hidupkan();
  fs.mkdirSync(capDir(), { recursive: true });
  fs.writeFileSync(jsonlHariIni(), '{"v":1,"verdict":"CTWA_AD","msgIdHash":"terpoto'); // tanpa newline
  sinyal(1);
  await settle(() => _getStats().written === 1);
  const semua = fs.readFileSync(jsonlHariIni(), "utf8").split("\n").filter(Boolean);
  assert.equal(semua.length, 2);
  assert.throws(() => JSON.parse(semua[0]));    // sisa terpotong tetap berdiri sendiri
  assert.equal(JSON.parse(semua[1]).verdict, "CTWA_AD"); // baris baru utuh
});

test("restart proses: agregat digabung dengan berkas hari itu, bukan ditimpa; tanpa .tmp tersisa", async () => {
  hidupkan();
  for (let i = 0; i < 3; i++) call({ payload: plainPayload(), externalId: `false_a@c.us_3EB0R${i}` });
  await settle(() => _getStats().observed === 3);
  await flushCapture();
  _resetForTests(); // = proses baru: memori kosong, berkas tetap
  for (let i = 3; i < 7; i++) call({ payload: plainPayload(), externalId: `false_a@c.us_3EB0R${i}` });
  await settle(() => _getStats().observed === 4);
  await flushCapture();
  const f = path.join(capDir(), `ctwa-capture-counts-${hariIni()}.json`);
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).total, 7);
  assert.deepEqual(fs.readdirSync(capDir()).filter((n) => n.endsWith(".tmp")), []);
});

test("berkas agregat rusak tidak menggagalkan flush (mulai dari nol)", async () => {
  hidupkan();
  fs.mkdirSync(capDir(), { recursive: true });
  fs.writeFileSync(path.join(capDir(), `ctwa-capture-counts-${hariIni()}.json`), "{bukan json");
  call({ payload: plainPayload(), externalId: "false_a@c.us_3EB0Z1" });
  await settle(() => _getStats().observed === 1);
  await flushCapture();
  assert.equal(JSON.parse(fs.readFileSync(path.join(capDir(), `ctwa-capture-counts-${hariIni()}.json`), "utf8")).total, 1);
});

test("purge menjangkau berkas agregat & .tmp lama, tapi tidak berkas lain; --all membersihkan semuanya", async () => {
  fs.mkdirSync(capDir(), { recursive: true });
  const now = Date.UTC(2026, 9, 9, 12, 0, 0);
  const tulis = (n) => fs.writeFileSync(path.join(capDir(), n), "{}");
  tulis("ctwa-capture-counts-2026-09-01.json");
  tulis("ctwa-capture-counts-2026-09-01.json.tmp");
  tulis("ctwa-capture-counts-2026-10-09.json");
  tulis("ctwa-capture-2026-10-09.jsonl");
  tulis("ctwa-capture-counts-2026-09-01.json.bak"); // bukan pola
  tulis("README.txt");
  const r = await purgeCaptures({ now });
  assert.deepEqual(r.removed.sort(), ["ctwa-capture-counts-2026-09-01.json", "ctwa-capture-counts-2026-09-01.json.tmp"]);
  const rAll = await purgeCaptures({ now, all: true });
  assert.deepEqual(rAll.removed.sort(), ["ctwa-capture-2026-10-09.jsonl", "ctwa-capture-counts-2026-10-09.json"]);
  assert.deepEqual(fs.readdirSync(capDir()).sort(), ["README.txt", "ctwa-capture-counts-2026-09-01.json.bak"]);
});

test("summarizeCounts: volume per hari & persen bersinyal; sidik salt ganda diperingatkan", () => {
  const v = summarizeCounts([
    { day: "2026-10-09", total: 1000, signal: 90, signalWritten: 90, customer: { NEW: { total: 300 }, EXISTING: { total: 700 } }, dropped: { queueFull: 2 } },
    { day: "2026-10-10", total: 3000, signal: 110, signalWritten: 110, customer: { NEW: { total: 500 }, EXISTING: { total: 2500 } }, dropped: {} },
  ]);
  assert.equal(v.inboundPerDay.avg, 2000);
  assert.equal(v.inboundPerDay.max, 3000);
  assert.equal(v.totals.dropped.queueFull, 2);
  assert.equal(v.signalPct, 5);
  const a = buildObservation(ctwaPayload(), ctx({ externalId: "f_a_3EB01" }));
  const b = buildObservation(ctwaPayload(), ctx({ externalId: "f_a_3EB02", salt: "salt-lain-0123456789abcdef" }));
  assert.ok(summarize([a, b]).saltWarning);
  assert.equal(summarize([a]).saltWarning, null);
});
