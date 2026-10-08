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
} from "../src/services/ctwaCapture.js";
import { summarize, igShortcodeToMediaId } from "../src/services/ctwaCaptureAnalysis.js";

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

test("entry point non-iklan (QR/profil) tanpa externalAdReply = CONTEXT_NON_AD, bukan CTWA", () => {
  const p = plainPayload();
  p._data.Message = { extendedTextMessage: { contextInfo: { conversionSource: "qr_code", entryPointConversionSource: "profile_link" } } };
  assert.equal(buildObservation(p, ctx()).verdict, "CONTEXT_NON_AD");
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
const ENV_KEYS = ["CTWA_ATTRIBUTION_CAPTURE_ENABLED", "CTWA_CAPTURE_HASH_SALT", "CTWA_CAPTURE_DIR", "CTWA_CAPTURE_RETENTION_DAYS"];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctwa-cap-"));
  process.env.CTWA_CAPTURE_DIR = path.join(tmp, "cap");
  delete process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED;
  delete process.env.CTWA_CAPTURE_HASH_SALT;
  delete process.env.CTWA_CAPTURE_RETENTION_DAYS;
  _resetForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const settle = async (cond, ms = 2000) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10)); };
const capDir = () => process.env.CTWA_CAPTURE_DIR;
const lines = () => (fs.existsSync(capDir()) ? fs.readdirSync(capDir()).flatMap((f) => fs.readFileSync(path.join(capDir(), f), "utf8").split("\n").filter(Boolean)) : []);
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

test("payload non-CTWA tercatat sebagai non-CTWA, tanpa data atribusi", async () => {
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true";
  process.env.CTWA_CAPTURE_HASH_SALT = SALT;
  call({ payload: plainPayload(), externalId: "false_a@c.us_3EB0BBBB2222" });
  await settle(() => _getStats().written === 1);
  const o = JSON.parse(lines()[0]);
  assert.equal(o.verdict, "NO_CONTEXT_INFO");
  assert.equal(o.ctwaClid, undefined);
  assert.equal(o.values, undefined);
  assertNoCanary(lines()[0]);
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
