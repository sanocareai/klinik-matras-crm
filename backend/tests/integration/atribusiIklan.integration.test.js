// Tes integrasi ATRIBUSI CTWA FASE 2 — router webhook ASLI + PostgreSQL sekali pakai + endpoint laporan/referensi, lewat HTTP.
// Membuktikan: touch hanya lahir dari inbound tersimpan; idempoten (message + message.any bersamaan, retry); customer lama = touch terpisah;
// kegagalan atribusi tidak menggagalkan inbox; tidak ada PII/clid mentah di tabel; pemetaan baru tanpa perubahan kode; laporan per
// campaign/ad set/ad rekonsiliasi (tidak ada customer/order ganda) dengan DP→lunas lintas bulan, payment batal/pengganti, LUNAS historis tanpa ledger.
import fs from "fs";
import os from "os";
import path from "path";

process.env.WAHA_BASE_URL = "http://127.0.0.1:9";           // WAHA tak terjangkau: lookup nama/foto gagal cepat
const SALT = "salt-integrasi-atribusi-0123456789abcdef";
process.env.CTWA_CAPTURE_HASH_SALT = SALT;
process.env.CTWA_CAPTURE_DIR = path.join(os.tmpdir(), "atribusi-int-cap");   // capture Fase 0 tetap OFF; hanya agar jalur tidak menulis ke data nyata
delete process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED;
delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED;
process.env.JWT_SECRET ||= "rahasia-uji-atribusi-iklan";

await import("./setup/env.js");
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { default: jwt } = await import("jsonwebtoken");
const { testPrisma, truncateAll } = await import("./setup/testDb.js");
const { startTestServer } = await import("./setup/testApp.js");
const { prisma } = await import("../../src/db.js");
const { webhookRouter } = await import("../../src/routes/webhooks.js");
const { attributionAdsRouter } = await import("../../src/routes/attributionAds.js");
const { _getTouchStats, _resetTouchStats } = await import("../../src/services/attribution/touchCapture.js");
const { hitungLaporanIklan, parseParameterIklan } = await import("../../src/services/attribution/iklanReport.js");
const { ENAM_PEMETAAN, csvAdsManager } = await import("../fixtures/metaAdsFixture.js");

const CLID = "AfhKBK8ZBWyKw3p49jW-KFh_rNlyzXmCKW0eSdHULJZtXqZk";
const TEXT_CANARY = "rahasia keluhan pinggang canary";
const NAME_CANARY = "Budi Canary Santoso";
const AD1 = "52694481763484", AD2 = "52689767293284", AD3 = "52696131903684", AD9 = "52699999999999";
const M = (n) => n * 1_000_000;
const T = (s) => new Date(s);

let server, admin, sales, tokenAdmin, tokenSales;
test.before(async () => {
  await truncateAll();
  await testPrisma.metaAdReference.deleteMany({});
  await testPrisma.metaAdReferenceImport.deleteMany({});
  admin = await testPrisma.user.create({ data: { name: "Admin Atribusi", email: `adm-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  sales = await testPrisma.user.create({ data: { name: "Sales Atribusi", email: `sls-${Date.now()}@example.test`, passwordHash: "x", role: "SALES" } });
  const tok = (u, roles) => jwt.sign({ id: u.id, name: u.name, role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: "1h" });
  tokenAdmin = tok(admin, ["ADMIN"]); tokenSales = tok(sales, ["SALES"]);
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/webhooks", webhookRouter);
  app.use("/api/atribusi/iklan", attributionAdsRouter);
  server = await startTestServer(app);
});
test.after(async () => {
  // tabel Fase 3 tidak ikut truncateAll(): bersihkan agar berkas tes lain pada DB yang sama tidak melihat spend/target/alarm sisa
  for (const m of ["metaAdSpendRevision", "metaAdDailySpend", "metaSpendImport", "attributionKpiTarget", "attributionAlertState"]) await testPrisma[m].deleteMany({}).catch(() => {});
  await server?.close?.();
  await testPrisma.$disconnect();
  fs.rmSync(process.env.CTWA_CAPTURE_DIR, { recursive: true, force: true });
});

function gows({ phone, msgId, ad = null, sourceType = "ad", clid = CLID, penanda = true, url = "https://www.instagram.com/p/DcgquCfg3_4/", ctwa = true }) {
  const ctx = ctwa ? {
    ...(penanda ? { conversionSource: "FB_Ads", entryPointConversionSource: "ctwa_ad", entryPointConversionApp: "instagram", entryPointConversionDelaySeconds: 18 } : {}),
    externalAdReply: { sourceURL: url, ...(ad ? { sourceID: ad, sourceType } : {}), ...(clid ? { ctwaClid: clid } : {}) },
  } : undefined;
  return {
    id: `false_${phone}@c.us_${msgId}`, from: `${phone}@c.us`, fromMe: false, body: TEXT_CANARY, hasMedia: false, timestamp: Math.floor(Date.now() / 1000),
    _data: { Info: { Chat: `${phone}@c.us`, Sender: `${phone}@c.us`, PushName: NAME_CANARY, Type: "text" }, Message: { extendedTextMessage: { text: TEXT_CANARY, ...(ctx ? { contextInfo: ctx } : {}) } } },
  };
}
async function post(event, payload) {
  const res = await fetch(`${server.baseUrl}/api/webhooks/waha`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, session: "default", engine: "GOWS", payload }) });
  assert.equal(res.status, 200);
}
const api = async (method, p, { token = tokenAdmin, body } = {}) => {
  const res = await fetch(`${server.baseUrl}/api/atribusi/iklan${p}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const teks = await res.text();
  let json = null; try { json = JSON.parse(teks); } catch { /* bukan JSON (csv) */ }
  return { status: res.status, json, teks, headers: res.headers };
};
const settle = async (cond, ms = 8000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
};
// tunggu sampai jumlah touch tidak berubah selama jendela diam (penulisan touch asinkron dari event sebelumnya sudah selesai)
const tenang = async (jendelaMs = 500, maksMs = 10_000) => {
  const mulai = Date.now(); let terakhir = await testPrisma.attributionTouch.count(); let sejak = Date.now();
  while (Date.now() - mulai < maksMs) {
    await new Promise((r) => setTimeout(r, 50));
    const n = await testPrisma.attributionTouch.count();
    if (n !== terakhir) { terakhir = n; sejak = Date.now(); }
    else if (Date.now() - sejak >= jendelaMs) return n;
  }
  return terakhir;
};
const msgCount = (externalId) => testPrisma.message.count({ where: { externalId } });
const touchCount = (where = {}) => testPrisma.attributionTouch.count({ where });
const hapusTouch = () => testPrisma.attributionTouch.deleteMany({});

// ── 1. jalur webhook ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test("flag MATI (default): inbox normal, customer ber-ctwa_clid seperti sebelumnya, TIDAK ada touch", async () => {
  const p = gows({ phone: "6285200000001", msgId: "3EB0ATR00001", ad: AD1 });
  await post("message", p);
  assert.ok(await settle(async () => (await msgCount(p.id)) === 1));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await touchCount(), 0);
  const c = await testPrisma.customer.findUnique({ where: { phone: "6285200000001" }, select: { leadSource: true, ctwaClid: true } });
  assert.equal(c.leadSource, "META_ADS");
  assert.equal(c.ctwaClid, CLID);
});

test("flag NYALA: customer baru → 1 touch (Ad ID string, UNMAPPED, status NEW/WEBHOOK_MEMBUAT); tabel tanpa PII / clid mentah / isi chat", async () => {
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  _resetTouchStats();
  const PH = "6285200000002";
  const p = gows({ phone: PH, msgId: "3EB0ATR00002", ad: AD1 });
  await post("message", p);
  assert.ok(await settle(async () => (await touchCount()) === 1));
  const c = await testPrisma.customer.findUnique({ where: { phone: PH }, select: { id: true, createdAt: true } });
  const m = await testPrisma.message.findFirst({ where: { externalId: p.id }, select: { id: true, createdAt: true } });
  const [t] = await testPrisma.attributionTouch.findMany();
  assert.equal(t.customerId, c.id);
  assert.equal(t.messageId, m.id);
  assert.equal(t.adId, AD1);
  assert.equal(typeof t.adId, "string");
  assert.equal(t.mappingStatusAtTouch, "UNMAPPED");
  assert.deepEqual([t.adSetId, t.campaignId], [null, null]);
  assert.deepEqual([t.customerStatusAtTouch, t.customerBasisAtTouch], ["NEW", "WEBHOOK_MEMBUAT"]);
  assert.equal(t.evidenceSource, "CTWA_AD");
  assert.equal(t.entryPointApp, "instagram");
  assert.match(t.ctwaClidHash, /^[0-9a-f]{16}$/);
  assert.equal(t.touchAt.getTime(), m.createdAt.getTime(), "touch_at = waktu pesan tersimpan (UTC)");
  assert.equal(t.touchDateWib.toISOString().slice(0, 10), new Date(m.createdAt.getTime() + 7 * 3600e3).toISOString().slice(0, 10));
  const baris = JSON.stringify(await testPrisma.$queryRawUnsafe("select * from attribution_touches"));
  for (const s of [CLID, TEXT_CANARY, NAME_CANARY, PH, "@c.us", "instagram.com", "DcgquCfg3_4"]) assert.ok(!baris.includes(s), `bocor di attribution_touches: ${s}`);
  const kolom = (await testPrisma.$queryRawUnsafe("select column_name from information_schema.columns where table_name='attribution_touches' order by 1")).map((r) => r.column_name);
  for (const larangan of ["phone", "name", "content", "text", "body", "payload", "clid", "jid"]) assert.ok(!kolom.some((k) => k === larangan), `kolom terlarang: ${larangan}`);
});

test("event `message` + `message.any` BERSAMAAN + retry untuk pesan yang sama = 1 Message & 1 touch", async () => {
  const PH = "6285200000003";
  const p = gows({ phone: PH, msgId: "3EB0ATR00003", ad: AD2 });
  const sebelum = await touchCount();
  await Promise.all([post("message", p), post("message.any", p), post("message.any", p)]);
  assert.ok(await settle(async () => (await msgCount(p.id)) === 1));
  // touch ditulis di luar jalur kritis (tidak di-await) → tunggu sampai muncul, lalu pastikan TIDAK bertambah lagi
  assert.ok(await settle(async () => (await touchCount()) - sebelum >= 1), "touch harus muncul");
  await tenang();
  assert.equal(await msgCount(p.id), 1);
  assert.equal(await touchCount() - sebelum, 1);
  await post("message", p);                                    // retry setelah tersimpan
  await tenang();
  assert.equal(await touchCount() - sebelum, 1);
  const dedupe = await testPrisma.attributionTouch.findMany({ select: { dedupeKey: true } });
  assert.equal(new Set(dedupe.map((x) => x.dedupeKey)).size, dedupe.length);
});

test("customer LAMA yang kembali lewat iklan lain: touch BARU terpisah (status EXISTING/RIWAYAT_PESAN); lead/createdAt customer tidak berubah", async () => {
  const PH = "6285200000002";                                   // sudah ada dari tes flag nyala
  const sebelum = await testPrisma.customer.findUnique({ where: { phone: PH }, select: { id: true, createdAt: true, leadSource: true } });
  const nCust = await testPrisma.customer.count();
  const p = gows({ phone: PH, msgId: "3EB0ATR00004", ad: AD2 });
  await post("message", p);
  assert.ok(await settle(async () => (await touchCount({ customerId: sebelum.id })) === 2));
  const ts = await testPrisma.attributionTouch.findMany({ where: { customerId: sebelum.id }, orderBy: { touchAt: "asc" } });
  assert.deepEqual(ts.map((t) => [t.adId, t.customerStatusAtTouch, t.customerBasisAtTouch]), [[AD1, "NEW", "WEBHOOK_MEMBUAT"], [AD2, "EXISTING", "RIWAYAT_PESAN"]]);
  const sesudah = await testPrisma.customer.findUnique({ where: { phone: PH }, select: { id: true, createdAt: true, leadSource: true } });
  assert.deepEqual(sesudah, sebelum);
  assert.equal(await testPrisma.customer.count(), nCust);
});

test("bukan touch: pesan biasa, iklan TANPA sourceID (URL postingan saja), sourceType bukan ad → inbox normal, 0 touch; Ad ID tidak dikarang dari URL", async () => {
  await tenang();                                                // tak ada penulisan touch tertunda dari tes sebelumnya
  const sebelum = await touchCount();
  const a = gows({ phone: "6285200000005", msgId: "3EB0ATR00005", ctwa: false });
  const b = gows({ phone: "6285200000006", msgId: "3EB0ATR00006", ad: null });                 // URL IG ada, sourceID tidak
  const c = gows({ phone: "6285200000007", msgId: "3EB0ATR00007", ad: AD3, sourceType: "post" });
  for (const p of [a, b, c]) await post("message", p);
  for (const p of [a, b, c]) assert.ok(await settle(async () => (await msgCount(p.id)) === 1));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await touchCount() - sebelum, 0);
});

test("DB MENOLAK insert touch (di dalam transaksi pesan): Message + Customer tetap commit; hanya hitungan `gagal` naik; log tanpa nomor", async () => {
  await tenang();
  _resetTouchStats();
  await testPrisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION atribusi_uji_tolak() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'tolak uji 6285200000008 isi chat rahasia'; END; $$ LANGUAGE plpgsql`);
  await testPrisma.$executeRawUnsafe(`CREATE TRIGGER atribusi_uji_tolak BEFORE INSERT ON attribution_touches FOR EACH ROW EXECUTE FUNCTION atribusi_uji_tolak()`);
  const warn = console.warn; const log = []; console.warn = (...a) => log.push(a.join(" "));
  const sebelum = await touchCount();
  try {
    const PH = "6285200000008";
    const p = gows({ phone: PH, msgId: "3EB0ATR00008", ad: AD1 });
    await post("message", p);
    assert.ok(await settle(async () => (await msgCount(p.id)) === 1), "Message tetap tersimpan");
    assert.ok(await settle(async () => _getTouchStats().gagal === 1));
    assert.equal(await testPrisma.customer.count({ where: { phone: PH } }), 1);
    assert.equal(await testPrisma.conversation.count({ where: { customer: { phone: PH } } }), 1);
    assert.equal(await touchCount(), sebelum, "tidak ada touch tertulis");
    assert.equal(_getTouchStats().fallbackTransaksi, 0, "transaksi tetap sehat: savepoint dipulihkan, bukan fallback");
    assert.ok(log.length >= 1 && log.every((l) => !/6285200000008|rahasia/.test(l)), "log hanya kode, tanpa nomor/pesan galat");
    // pesan berikutnya pada customer yang sama (trigger dilepas) berjalan normal
    await testPrisma.$executeRawUnsafe("DROP TRIGGER atribusi_uji_tolak ON attribution_touches");
    const p2 = gows({ phone: PH, msgId: "3EB0ATR00008B", ad: AD1 });
    await post("message", p2);
    assert.ok(await settle(async () => (await touchCount()) === sebelum + 1));
  } finally {
    console.warn = warn;
    await testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS atribusi_uji_tolak ON attribution_touches");
    await testPrisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS atribusi_uji_tolak()");
  }
});

test("transaksi pesan bermasalah (P2028): Message disimpan tanpa transaksi, touch DIPULIHKAN sekali; penghitung fallback/dipulihkan naik", async () => {
  await tenang();
  _resetTouchStats();
  const asli = prisma.$transaction.bind(prisma);
  let ditolak = 0;
  prisma.$transaction = (fn, o) => {
    if (typeof fn === "function" && ditolak === 0) { ditolak++; return Promise.reject(Object.assign(new Error("Transaction API error 6285200000009"), { code: "P2028" })); }
    return asli(fn, o);
  };
  const sebelum = await touchCount();
  try {
    const PH = "6285200000009";
    const p = gows({ phone: PH, msgId: "3EB0ATR00009", ad: AD2 });
    await post("message", p);
    assert.ok(await settle(async () => (await msgCount(p.id)) === 1), "Message tersimpan walau transaksi bermasalah");
    assert.ok(await settle(async () => (await touchCount()) === sebelum + 1), "touch dipulihkan lewat percobaan susulan");
    await tenang();
    assert.equal(await touchCount(), sebelum + 1, "tepat satu");
    const s = _getTouchStats();
    assert.deepEqual([s.fallbackTransaksi, s.dipulihkan, s.gagalPulih, s.tertunda], [1, 1, 0, 0]);
    const [t] = await testPrisma.attributionTouch.findMany({ where: { customer: { phone: PH } } });
    assert.equal(t.adId, AD2);
    assert.equal(t.customerStatusAtTouch, "NEW");
  } finally { prisma.$transaction = asli; }
});

test("transaksi bermasalah DAN percobaan susulan gagal: inbox tetap tersimpan; gagalPulih tercatat; tidak ada yang tertunda", async () => {
  await tenang();
  _resetTouchStats();
  const asliTx = prisma.$transaction.bind(prisma);
  const asliCreate = prisma.attributionTouch.create.bind(prisma.attributionTouch);
  let ditolak = 0;
  prisma.$transaction = (fn, o) => {
    if (typeof fn === "function" && ditolak === 0) { ditolak++; return Promise.reject(Object.assign(new Error("tx"), { code: "P2034" })); }
    return asliTx(fn, o);
  };
  prisma.attributionTouch.create = async () => { throw Object.assign(new Error("gagal 6285200000010"), { code: "P1001" }); };
  const sebelum = await touchCount();
  const warn = console.warn; const log = []; console.warn = (...a) => log.push(a.join(" "));
  try {
    const PH = "6285200000010";
    const p = gows({ phone: PH, msgId: "3EB0ATR00010", ad: AD1 });
    await post("message", p);
    assert.ok(await settle(async () => (await msgCount(p.id)) === 1));
    assert.ok(await settle(async () => _getTouchStats().gagalPulih === 1));
    const s = _getTouchStats();
    assert.deepEqual([s.fallbackTransaksi, s.dipulihkan, s.tertunda], [1, 0, 0]);
    assert.ok(s.terakhirGagalAt, "waktu kegagalan terakhir tercatat");
    assert.equal(await touchCount(), sebelum);
    assert.ok(log.every((l) => !/6285200000010/.test(l)));
  } finally { console.warn = warn; prisma.$transaction = asliTx; prisma.attributionTouch.create = asliCreate; }
});

test("constraint DB: Ad ID bukan digit, pemetaan tidak konsisten, tanggal WIB tidak cocok, sumber tak dikenal → ditolak", async () => {
  const c = await testPrisma.customer.findFirst({ select: { id: true } });
  const dasar = { customer_id: c.id, ad_id: AD3, touch_at: "2026-10-05T03:00:00Z", touch_date_wib: "2026-10-05", evidence_source: "CTWA_AD", source_type: "ad", mapping_status_at_touch: "UNMAPPED", customer_status_at_touch: "NEW", customer_basis_at_touch: "WEBHOOK_MEMBUAT" };
  const masuk = (o, key) => testPrisma.$executeRawUnsafe(
    `insert into attribution_touches (id, customer_id, ad_id, ad_set_id, campaign_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6::timestamp, $7::date, $8, $9, $10, $11, $12)`,
    o.customer_id, o.ad_id, o.ad_set_id ?? null, o.campaign_id ?? null, o.mapping_status_at_touch, o.touch_at, o.touch_date_wib, o.evidence_source, o.source_type, o.customer_status_at_touch, o.customer_basis_at_touch, key);
  await masuk(dasar, "uji:ok-1");                                                           // baris sah
  await assert.rejects(masuk({ ...dasar, ad_id: "abc12345" }, "uji:2"), /attribution_touches_ad_id_check/);
  await assert.rejects(masuk({ ...dasar, mapping_status_at_touch: "MAPPED" }, "uji:3"), /attribution_touches_mapping_check/);
  await assert.rejects(masuk({ ...dasar, touch_date_wib: "2026-10-06" }, "uji:4"), /attribution_touches_date_wib_check/);
  await assert.rejects(masuk({ ...dasar, evidence_source: "TEBAKAN_NAMA" }, "uji:5"), /attribution_touches_evidence_check/);
  await assert.rejects(masuk({ ...dasar, touch_at: "2026-10-05T18:00:00Z", touch_date_wib: "2026-10-05" }, "uji:6"), /attribution_touches_date_wib_check/, "18:00 UTC = 01:00 WIB hari berikutnya");
  await assert.rejects(masuk({ ...dasar, customer_status_at_touch: "NEW", customer_basis_at_touch: "TANPA_BUKTI" }, "uji:7"), /attribution_touches_customer_status_check/, "NEW tanpa basis kausal ditolak");
  await assert.rejects(masuk({ ...dasar, customer_status_at_touch: "UNKNOWN", customer_basis_at_touch: "WEBHOOK_MEMBUAT" }, "uji:8"), /attribution_touches_customer_status_check/, "UNKNOWN berbasis bukti kausal ditolak");
  await assert.rejects(masuk({ ...dasar, customer_status_at_touch: "MAYBE" }, "uji:9"), /attribution_touches_customer_status_check/);
  await masuk({ ...dasar, customer_status_at_touch: "UNKNOWN", customer_basis_at_touch: "TANPA_BUKTI" }, "uji:ok-2");
  await assert.rejects(masuk(dasar, "uji:ok-1"), /dedupe_key/);
  await testPrisma.attributionTouch.deleteMany({ where: { dedupeKey: { in: ["uji:ok-1", "uji:ok-2"] } } });
  await assert.rejects(testPrisma.$executeRawUnsafe(`insert into meta_ad_references (ad_id, ad_set_id, campaign_id, source, synced_at, updated_at) values ('5.2E+13','52694481763284','52694481763084','MANUAL', now(), now())`), /meta_ad_references_ids_check/);
});

// ── 2. referensi / impor pemetaan ────────────────────────────────────────────────────────────────────────────────────────────
test("impor referensi: ADMIN saja; dryRun DEFAULT tidak menulis; enam pemetaan fixture; konflik; notasi ilmiah ditolak", async () => {
  await testPrisma.metaAdReference.deleteMany({});
  const csv = csvAdsManager(ENAM_PEMETAAN);
  assert.equal((await api("POST", "/referensi", { token: null, body: { csv } })).status, 401);
  assert.equal((await api("POST", "/referensi", { token: tokenSales, body: { csv } })).status, 403);

  const dry = await api("POST", "/referensi", { body: { csv } });                     // dryRun tidak dikirim → true
  assert.equal(dry.status, 200);
  assert.equal(dry.json.dryRun, true);
  assert.equal(dry.json.ringkasan.baru, 6);
  assert.equal(await testPrisma.metaAdReference.count(), 0);
  assert.equal(await testPrisma.metaAdReferenceImport.count(), 0);

  const nyata = await api("POST", "/referensi", { body: { csv, dryRun: false, namaBerkas: "ekspor-ads-manager.csv" } });
  assert.equal(nyata.status, 200);
  assert.equal(nyata.json.dryRun, false);
  assert.equal(await testPrisma.metaAdReference.count(), 6);
  const imp = await testPrisma.metaAdReferenceImport.findFirst();
  assert.deepEqual([imp.rowsNew, imp.rowsRejected, imp.createdById], [6, 0, admin.id]);
  assert.match(imp.contentSha256, /^[0-9a-f]{64}$/);

  // keenam hierarki persis seperti yang diverifikasi Mesa
  for (const r of ENAM_PEMETAAN) {
    const ref = await testPrisma.metaAdReference.findUnique({ where: { adId: r.adId } });
    assert.deepEqual([ref.adSetId, ref.campaignId], [r.adSetId, r.campaignId], r.adId);
  }
  // ulang identik → tidak berubah; nama diperbarui = label saja
  const ulang = await api("POST", "/referensi", { body: { csv, dryRun: false } });
  assert.deepEqual([ulang.json.ringkasan.baru, ulang.json.ringkasan.tidakBerubah], [0, 6]);
  // konflik orang tua → tidak menimpa
  const konflik = await api("POST", "/referensi", { body: { rows: [{ adId: AD3, adSetId: "52696131903484", campaignId: "52690000000001" }], dryRun: false } });
  assert.equal(konflik.json.ringkasan.konflik, 1);
  assert.equal((await testPrisma.metaAdReference.findUnique({ where: { adId: AD3 } })).campaignId, "52696131903884");
  // notasi ilmiah ditolak
  const ilmiah = await api("POST", "/referensi", { body: { csv: "Ad ID,Ad set ID,Campaign ID\n5.2694481763484E+13,52694481763284,52694481763084\n", dryRun: false } });
  assert.equal(ilmiah.json.ringkasan.ditolak, 1);
  assert.equal(ilmiah.json.ditolak[0].alasan, "AD_ID_NOTASI_ILMIAH_ATAU_DESIMAL");
  assert.equal(await testPrisma.metaAdReference.count(), 6);
  // MARKETING_API tidak tersedia (tak ada kredensial)
  assert.equal((await api("POST", "/referensi", { body: { csv, sumber: "MARKETING_API", dryRun: false } })).status, 400);
});

// ── 3. laporan end-to-end ────────────────────────────────────────────────────────────────────────────────────────────────────────
let urutanTouch = 0;
async function benihLaporan() {
  await hapusTouch();
  await testPrisma.payment.deleteMany({}); await testPrisma.order.deleteMany({});
  await testPrisma.customer.deleteMany({ where: { phone: { startsWith: "6285300" } } });
  const cust = (phone, createdAt, o = {}) => testPrisma.customer.create({ data: { name: "Pelanggan Uji", phone, createdAt: T(createdAt), leadSource: "META_ADS", ...o } });
  const order = (customerId, createdAt, value, o = {}) => testPrisma.order.create({ data: { customerId, createdAt: T(createdAt), value, status: "PROCESSING", ...o } });
  const bayar = (orderId, createdAt, amount, o = {}) => testPrisma.payment.create({ data: { orderId, amount, method: "TRANSFER", recordedById: admin.id, createdAt: T(createdAt), ...o } });
  const sentuh = (customerId, adId, touchAt, o = {}) => {
    const at = T(touchAt);
    return testPrisma.attributionTouch.create({ data: {
      customerId, adId, touchAt: at, touchDateWib: T(new Date(at.getTime() + 7 * 3600e3).toISOString().slice(0, 10) + "T00:00:00Z"),
      mappingStatusAtTouch: "UNMAPPED", evidenceSource: "CTWA_AD", sourceType: "ad", customerStatusAtTouch: "NEW", customerBasisAtTouch: "WEBHOOK_MEMBUAT", dedupeKey: `uji:${++urutanTouch}`, ...o,
    } });
  };

  // C1: lead 29 Sep; order 30 Sep Rp4 jt; DP Rp1 jt 30 Sep, pelunasan Rp3 jt 5 Okt (DP→lunas LINTAS BULAN)
  const c1 = await cust("6285300000001", "2026-09-29T03:00:00Z", { pipelineStage: "PROSPECT" });
  const o1 = await order(c1.id, "2026-09-30T03:00:00Z", M(4), { paymentStatus: "LUNAS", paidAt: T("2026-10-05T03:00:00Z") });
  await bayar(o1.id, "2026-09-30T04:00:00Z", M(1)); await bayar(o1.id, "2026-10-05T03:00:00Z", M(3));
  await sentuh(c1.id, AD1, "2026-09-29T03:01:00Z");
  // C2: dua order; O2 lunas Rp2 jt; O3 DP: payment 500 rb DIBATALKAN lalu diganti 750 rb
  const c2 = await cust("6285300000002", "2026-09-30T03:00:00Z");
  const o2 = await order(c2.id, "2026-10-01T03:00:00Z", M(2), { paymentStatus: "LUNAS", paidAt: T("2026-10-01T05:00:00Z") });
  await bayar(o2.id, "2026-10-01T05:00:00Z", M(2));
  const o3 = await order(c2.id, "2026-10-02T03:00:00Z", 1_500_000, { paymentStatus: "DP" });
  const batal = await bayar(o3.id, "2026-10-02T04:00:00Z", 500_000, { cancelledAt: T("2026-10-02T06:00:00Z"), cancelledById: admin.id, cancelReason: "salah input" });
  await bayar(o3.id, "2026-10-02T06:30:00Z", 750_000, { replacesPaymentId: batal.id });
  await sentuh(c2.id, AD1, "2026-09-30T03:01:00Z");
  // C3: LUNAS historis TANPA ledger (tanpa payment sama sekali)
  const c3 = await cust("6285300000003", "2026-10-01T03:00:00Z");
  await order(c3.id, "2026-10-02T03:00:00Z", M(3), { paymentStatus: "LUNAS", paidAt: T("2026-10-02T08:00:00Z") });
  await sentuh(c3.id, AD2, "2026-10-01T03:01:00Z");
  // C4: Ad ID BELUM terpetakan, tanpa order
  const c4 = await cust("6285300000004", "2026-10-02T03:00:00Z");
  await sentuh(c4.id, AD9, "2026-10-02T03:01:00Z");
  // C5: SPAM dengan order berbayar (harus keluar dari metrik closing)
  const c5 = await cust("6285300000005", "2026-10-03T03:00:00Z", { pipelineStage: "SPAM" });
  const o5 = await order(c5.id, "2026-10-04T03:00:00Z", M(5), { paymentStatus: "LUNAS", paidAt: T("2026-10-04T05:00:00Z") });
  await bayar(o5.id, "2026-10-04T05:00:00Z", M(5));
  await sentuh(c5.id, AD1, "2026-10-03T03:01:00Z");
  // C6: organik (tanpa touch)
  await cust("6285300000006", "2026-10-04T03:00:00Z");
  // C7: customer LAMA (September awal) mengklik iklan lagi → touch terpisah, bukan lead
  const c7 = await cust("6285300000007", "2026-09-01T03:00:00Z");
  await sentuh(c7.id, AD1, "2026-10-05T03:00:00Z", { customerStatusAtTouch: "EXISTING", customerBasisAtTouch: "RIWAYAT_PESAN" });
  // C8: status LUNAS tetapi ledger hanya menutup Rp2 jt dari tagihan Rp2,2 jt (value + ongkir): KONFLIK
  const c8 = await cust("6285300000008", "2026-10-05T03:00:00Z");
  const o8 = await order(c8.id, "2026-10-06T03:00:00Z", M(2), { ongkir: 200_000, paymentStatus: "LUNAS", paidAt: T("2026-10-06T05:00:00Z") });
  await bayar(o8.id, "2026-10-06T05:00:00Z", M(2));
  await sentuh(c8.id, AD3, "2026-10-05T03:01:00Z");
  // C9: multi-touch: akuisisi AD2 lebih dulu; touch AD1 sesudahnya (customer sudah lama) → hanya touch berikutnya
  const c9 = await cust("6285300000009", "2026-10-07T03:00:00Z");
  await sentuh(c9.id, AD2, "2026-10-07T03:01:00Z");
  await sentuh(c9.id, AD1, "2026-10-08T03:00:00Z", { customerStatusAtTouch: "EXISTING", customerBasisAtTouch: "RIWAYAT_PESAN" });
  return { c1, c2, c3, c4, c5, c8, c9 };
}
const P = "dari=2026-09-25&sampai=2026-10-10";
const CAMP1 = "52694481763084", CAMP2 = "52696131903884";
const kunci = (j, k) => j.grup.find((g) => g.kunci === k);

test("laporan end-to-end per CAMPAIGN: lead, spam, closing, dua jenis lunas, uang; UNMAPPED; rekonsiliasi; READ ONLY", async () => {
  await benihLaporan();
  const sebelum = { t: await touchCount(), o: await testPrisma.order.count(), p: await testPrisma.payment.count(), c: await testPrisma.customer.count(), r: await testPrisma.metaAdReference.count() };
  const r = await api("GET", `/?${P}&level=campaign&rincian=1`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const j = r.json;
  assert.equal(j.rekonsiliasi.ok, true, JSON.stringify(j.rekonsiliasi.cek.filter((c) => !c.ok)));

  // CAMP1 (Ad AD1): C1, C2, C5(spam). C7 (customer lama) dan touch kedua C9 hanya "sentuhan berikutnya".
  const g1 = kunci(j, CAMP1);
  assert.equal(g1.lead.unik, 3);
  assert.equal(g1.lead.spam, 1);
  assert.equal(g1.lead.bukanSpam, 2);
  assert.equal(g1.customerDenganOrder, 2, "C1 dan C2 (dua order = satu customer); order C5 spam dikecualikan");
  assert.equal(g1.orderEligible, 3, "O1, O2, O3");
  assert.equal(g1.bookedValue, M(4) + M(2) + 1_500_000);
  assert.equal(g1.orderPernahDp, 2, "O1 (DP 1 jt lalu lunas) dan O3 (DP)");
  assert.equal(g1.lunasMenurutCrm.jumlah, 2, "O1, O2");
  assert.equal(g1.lunasTerbuktiLedger.jumlah, 2);
  assert.deepEqual(g1.buktiPelunasan, { lunasTerbuktiLedger: 2, lunasTanpaLedger: 0, konflikLunasTersimpanLedgerTidakCukup: 0, konflikBelumLunasTersimpanLedgerCukup: 0, kekuranganRupiahKonflik: 0 });
  assert.equal(g1.uangLedger, M(4) + M(2) + 750_000, "payment 500 rb yang DIBATALKAN tidak dihitung; pengganti 750 rb dihitung");
  // closing UTAMA = customer dengan order lunas terbukti ledger: C1 (DP Sep + pelunasan Okt) dan C2 (O2); O3 (DP) belum; C5 spam dikecualikan
  assert.equal(g1.closingUtama.customerLunasTerbuktiLedger, 2);
  assert.equal(g1.closingUtama.orderLunasTerbuktiLedger, 2);
  assert.deepEqual(g1.closingUtama.perBulanLunasPertama, { "2026-10": 2 }, "C1 lunas saat pelunasan 5 Okt (bukan DP 30 Sep); C2 lunas 1 Okt");
  assert.equal(g1.customerDenganOrder, 2, "metrik terpisah: customer dengan order");
  // tiga tanggal dipisah
  assert.equal(g1.rincian.perBulanPembayaran["2026-09"].uangLedger, M(1), "DP O1 pada September");
  assert.equal(g1.rincian.perBulanPembayaran["2026-10"].uangLedger, M(3) + M(2) + 750_000, "pelunasan O1 + O2 + pengganti O3 pada Oktober");
  assert.deepEqual(Object.keys(g1.rincian.perBulanLead).sort(), ["2026-09"], "lead Oktober di grup ini hanya C5 (spam) → tidak dihitung sebagai lead sah");
  assert.ok(g1.rincian.perBulanOrder["2026-09"].orders >= 1 && g1.rincian.perBulanOrder["2026-10"].orders >= 1);

  // campaign AD2 ("IG gabungan lama"): C3 (LUNAS historis TANPA ledger) + C9 (akuisisi; touch AD1 kedua tidak memindahkan lead)
  const g3 = kunci(j, "52689735916884");
  assert.equal(g3.lead.unik, 2);
  assert.equal(g3.customerDenganOrder, 1);
  assert.equal(g3.orderEligible, 1);
  assert.equal(g3.bookedValue, M(3));
  assert.equal(g3.lunasMenurutCrm.jumlah, 1, "LUNAS menurut status tersimpan");
  assert.equal(g3.lunasTerbuktiLedger.jumlah, 0, "LUNAS historis tanpa ledger BUKAN lunas terbukti");
  assert.equal(g3.buktiPelunasan.lunasTanpaLedger, 1);
  assert.equal(g3.uangLedger, 0, "tanpa payment = tidak ada uang diterima");
  assert.equal(g3.closingUtama.customerLunasTerbuktiLedger, 0, "LUNAS historis tanpa ledger BUKAN closing utama");

  const g2 = kunci(j, CAMP2);       // C8
  assert.equal(g2.lead.unik, 1);
  assert.equal(g2.lunasMenurutCrm.jumlah, 1, "konflik tetap lunas menurut CRM");
  assert.equal(g2.lunasTerbuktiLedger.jumlah, 0, "tetapi bukan lunas terbukti ledger");
  assert.equal(g2.buktiPelunasan.konflikLunasTersimpanLedgerTidakCukup, 1);
  assert.equal(g2.buktiPelunasan.kekuranganRupiahKonflik, 200_000);
  assert.equal(g2.uangLedger, M(2));
  assert.equal(g2.closingUtama.customerLunasTerbuktiLedger, 0, "LUNAS CRM dengan ledger kurang BUKAN closing utama");
  assert.equal(g2.bookedValue, M(2), "booked = Order.value (tanpa ongkir)");

  const u = kunci(j, "UNMAPPED");   // C4
  assert.deepEqual([u.lead.unik, u.status, u.campaign, u.adSet], [1, "UNMAPPED", null, null]);
  assert.deepEqual(j.tidakTerpetakan.adIds.map((x) => x.adId), [AD9]);

  // multi-touch & customer lama: touch berikutnya terpisah, lead tidak berpindah
  assert.deepEqual(g1.sentuhanBerikutnya, { touch: 2, customerUnik: 2, padaCustomerBaru: 0, padaCustomerLama: 2, padaCustomerTidakDiketahui: 0 }, "C7 (lama) dan C9 (touch kedua)");
  // cakupan jujur: C6 organik tanpa touch; C7 bukan lead baru di rentang? (dibuat 1 Sep < 25 Sep)
  assert.equal(j.cakupan.denganTouchAkuisisi, 7);
  assert.equal(j.cakupan.tanpaTouch, 1);
  assert.equal(j.cakupan.terpetakan + j.cakupan.tidakTerpetakan, 7);
  assert.equal(j.biaya.cpa, null); assert.equal(j.biaya.roas, null);

  // baca-saja: tidak ada tulis; tidak ada pengenal pribadi / clid / kunci terlarang
  assert.deepEqual({ t: await touchCount(), o: await testPrisma.order.count(), p: await testPrisma.payment.count(), c: await testPrisma.customer.count(), r: await testPrisma.metaAdReference.count() }, sebelum);
  for (const s of ["6285300", "Pelanggan Uji", CLID, TEXT_CANARY]) assert.ok(!r.teks.includes(s), `bocor: ${s}`);
  assert.ok(!/"(phone|name|customerId|orderId|ctwaClid|messageId)"\s*:/.test(r.teks));
  // contoh respons untuk dokumentasi (data sintetis; hanya bila diminta)
  if (process.env.ATRIBUSI_SAMPLE_OUT) fs.writeFileSync(process.env.ATRIBUSI_SAMPLE_OUT, JSON.stringify(j, null, 2));
});

test("level adset dan ad: total teratribusi identik dengan campaign; tidak ada customer/order ganda; rekonsiliasi OK", async () => {
  // rute sengaja membatasi satu perhitungan sekaligus (429) → berurutan
  const c = await api("GET", `/?${P}&level=campaign`);
  const s = await api("GET", `/?${P}&level=adset`);
  const a = await api("GET", `/?${P}&level=ad`);
  for (const x of [c, s, a]) { assert.equal(x.status, 200); assert.equal(x.json.rekonsiliasi.ok, true); }
  assert.deepEqual(s.json.jumlahTeratribusi, c.json.jumlahTeratribusi);
  assert.deepEqual(a.json.jumlahTeratribusi, c.json.jumlahTeratribusi);
  const jum = (j, f) => j.grup.reduce((t, g) => t + f(g), 0);
  for (const x of [c, s, a]) {
    assert.equal(jum(x.json, (g) => g.lead.unik), 7);
    assert.equal(jum(x.json, (g) => g.orderEligible), c.json.jumlahTeratribusi.orderEligible);
    assert.equal(jum(x.json, (g) => g.uangLedger), c.json.jumlahTeratribusi.uangLedger);
  }
  const ad1 = kunci(a.json, AD1);
  assert.deepEqual([ad1.status, ad1.campaign.id, ad1.adSet.id, ad1.ad.id], ["MAPPED", CAMP1, "52694481763284", AD1]);
  assert.equal(kunci(a.json, AD9).status, "UNMAPPED");
  // dua iklan dalam satu ad set yang sama (fixture Mesa) → pada level adset digabung
  assert.ok(s.json.grup.some((g) => g.kunci === "52694481763284"));
});

test("Ad ID baru dipetakan TANPA perubahan kode: UNMAPPED → MAPPED di laporan; snapshot touch lama tidak diubah; impor lalu ekspor ID", async () => {
  const sebelum = await api("GET", `/?${P}&level=campaign`);
  assert.ok(kunci(sebelum.json, "UNMAPPED"));
  const imp = await api("POST", "/referensi", { body: { rows: [{ adId: AD9, adSetId: "52699999990001", campaignId: "52699999990002", campaignName: "Kampanye baru Okt" }], dryRun: false } });
  assert.equal(imp.json.ringkasan.baru, 1);
  const sesudah = await api("GET", `/?${P}&level=campaign`);
  assert.equal(kunci(sesudah.json, "UNMAPPED"), undefined);
  const baru = kunci(sesudah.json, "52699999990002");
  assert.equal(baru.lead.unik, 1);
  assert.equal(baru.campaign.nama, "Kampanye baru Okt");
  assert.equal(sesudah.json.cakupan.tidakTerpetakan, 0);
  // snapshot di baris touch tetap null (append-only; laporan memakai referensi terkini)
  const t = await testPrisma.attributionTouch.findFirst({ where: { adId: AD9 } });
  assert.deepEqual([t.campaignId, t.mappingStatusAtTouch], [null, "UNMAPPED"]);

  const eks = await api("GET", "/ekspor-id");
  assert.equal(eks.status, 200);
  assert.ok(eks.json.iklan.every((x) => /^\d+$/.test(x.adId)));
  const csv = await api("GET", "/ekspor-id?format=csv");
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.teks.split("\n")[0], /^campaignId,adSetId,adId,status,/);
  assert.ok(!/62853|customer|phone/i.test(csv.teks));
  const ref = await api("GET", "/referensi");
  assert.equal(ref.json.jumlah, 7);
  assert.deepEqual(ref.json.tidakTerpetakan, []);
});

test("RBAC dan parameter: tanpa token 401; SALES 403 (semua rute); parameter salah 400; satu perhitungan sekaligus", async () => {
  for (const [m, p] of [["GET", "/"], ["GET", "/referensi"], ["POST", "/referensi"], ["GET", "/ekspor-id"]]) {
    assert.equal((await api(m, p, { token: null })).status, 401, `${m} ${p}`);
    assert.equal((await api(m, p, { token: tokenSales })).status, 403, `${m} ${p}`);
  }
  for (const q of ["dari=2026-13-01", "dari=2026-10-10&sampai=2026-10-01", "level=pixel", "sinyal=x", "sampai=2999-01-01", "dari=2020-01-01&sampai=2026-10-01"]) {
    assert.equal((await api("GET", `/?${q}`)).status, 400, q);
  }
  assert.equal((await api("POST", "/referensi", { body: {} })).status, 400);
});

test("transaksi laporan dipaksa READ ONLY oleh Postgres: penulisan pada transaksi yang sama ditolak", async () => {
  const hasil = { ditolak: false, pesan: null };
  const dbPembungkus = {
    $transaction: (fn, opts) => testPrisma.$transaction(async (tx) => {
      const keluar = await fn(tx);
      try { await tx.customer.create({ data: { name: "Tidak Boleh Tertulis" } }); } catch (e) { hasil.ditolak = true; hasil.pesan = String(e.message); }
      throw Object.assign(new Error("selesai"), { keluar });
    }, opts),
  };
  await assert.rejects(hitungLaporanIklan(dbPembungkus, parseParameterIklan({ dari: "2026-09-25", sampai: "2026-10-10" })), /selesai/);
  assert.equal(hasil.ditolak, true);
  assert.match(hasil.pesan, /read-only/i);
  assert.equal(await testPrisma.customer.count({ where: { name: "Tidak Boleh Tertulis" } }), 0);
});

test("AD_REPLY_UNMARKED hanya AUDIT: direkam, muncul di blok audit, TIDAK menambah lead/closing; sinyal=SEMUA ditolak", async () => {
  const sebelum = await api("GET", `/?${P}&level=campaign`);
  const c = await testPrisma.customer.create({ data: { name: "Pelanggan Uji", phone: "6285300000099", createdAt: T("2026-10-08T03:00:00Z"), leadSource: "META_ADS" } });
  await testPrisma.attributionTouch.create({ data: {
    customerId: c.id, adId: AD3, touchAt: T("2026-10-08T03:01:00Z"), touchDateWib: T("2026-10-08T00:00:00Z"), mappingStatusAtTouch: "UNMAPPED",
    evidenceSource: "AD_REPLY_UNMARKED", sourceType: "ad", customerStatusAtTouch: "NEW", customerBasisAtTouch: "WEBHOOK_MEMBUAT", dedupeKey: "uji:unmarked-1",
  } });
  const sesudah = await api("GET", `/?${P}&level=campaign`);
  assert.deepEqual(sesudah.json.jumlahTeratribusi, sebelum.json.jumlahTeratribusi, "audit tidak mengubah angka atribusi");
  assert.equal(sesudah.json.atribusi.sinyalDipakai.join(), "CTWA_AD");
  assert.deepEqual(sesudah.json.audit.adReplyTanpaPenanda, {
    touch: 1, customerUnik: 1, padaCustomerBaru: 1, masukAtribusi: false, keterangan: sesudah.json.audit.adReplyTanpaPenanda.keterangan,
  });
  assert.equal(sesudah.json.cakupan.denganTouchAkuisisi, sebelum.json.cakupan.denganTouchAkuisisi, "customer ini tanpa touch CTWA → tetap 'tanpa touch'");
  assert.equal(sesudah.json.rekonsiliasi.ok, true);
  assert.equal((await api("GET", `/?${P}&level=campaign&sinyal=SEMUA`)).status, 400);
});

test("rentang: kosong = 7 hari bawaan; sebelah saja 400; dibatasi 93 hari; /kesehatan: agregat tanpa identitas (rekam, gagal, dipulihkan, pending pemetaan + usia)", async () => {
  const bawaan = await api("GET", "/");
  assert.equal(bawaan.status, 200, "tanpa dari/sampai = 7 hari terakhir");
  assert.equal(bawaan.json.rentangLead.bawaan, true);
  assert.equal(bawaan.json.rentangLead.hariBawaan, 7);
  assert.equal((await api("GET", "/?sampai=2026-10-10")).status, 400, "sebelah saja");
  assert.equal((await api("GET", "/?dari=2026-10-01")).status, 400);
  assert.equal((await api("GET", "/?dari=2026-06-01&sampai=2026-10-10")).status, 400, "lebih dari 93 hari");
  const h = await api("GET", "/kesehatan");
  assert.equal(h.status, 200);
  assert.equal(h.headers.get("cache-control"), "no-store");
  assert.equal(h.json.captureAktif, true);
  for (const k of ["direkam", "duplikat", "bukanTouch", "gagal", "fallbackTransaksi", "dipulihkan", "gagalPulih", "tertunda", "usiaTertundaTertuaDetik"]) assert.equal(typeof h.json.proses[k], "number", k);
  assert.ok(h.json.db.touchTotal >= 1);
  assert.equal(typeof h.json.db.pendingPemetaan.touch, "number");
  assert.ok(h.json.db.auditAdReplyTanpaPenanda >= 1);
  for (const s of ["6285", "Pelanggan", CLID, TEXT_CANARY]) assert.ok(!h.teks.includes(s), `bocor: ${s}`);
  assert.ok(!/"(phone|name|customerId|messageId)"\s*:/.test(h.teks));
  assert.equal((await api("GET", "/kesehatan", { token: tokenSales })).status, 403);
  assert.equal((await api("GET", "/kesehatan", { token: null })).status, 401);
});


// ══════════════════════ FASE 3: spend harian, KPI biaya, target, monitoring ══════════════════════
const AKUN = "1234567890123";
const A4 = "52696128519084";   // referensi ada, TANPA lead (spend-only)
const kolomCsv = "Day,Account ID,Campaign name,Campaign ID,Ad set name,Ad set ID,Ad name,Ad ID,Amount spent (IDR),Impressions,Reach,Link clicks,Messaging conversations started";
const HIER = { [AD1]: ["52694481763084", "52694481763284"], [AD2]: ["52689735916884", "52689767293084"], [AD3]: ["52696131903884", "52696131903484"], [AD9]: ["52699999999001", "52699999999002"], [A4]: ["52696128518884", "52696128519284"] };
const barisCsv = (tgl, ad, spend, o = {}) => `${tgl},${AKUN},"${o.camp ?? "Nama Campaign"}",${HIER[ad][0]},"Set",${HIER[ad][1]},"Iklan",${ad},${spend},${o.imp ?? 1000},${o.reach ?? 800},${o.klik ?? 20},${o.konv ?? 5}`;
const csvSpend = (baris, kolom = kolomCsv) => [kolom, ...baris].join("\n");
const SPEND_UJI = [
  ["2026-09-30", AD1, "400000"], ["2026-09-30", AD2, "200000"], ["2026-09-30", AD9, "50000"],
  ["2026-10-01", AD1, "500000"], ["2026-10-01", AD2, "100000"], ["2026-10-01", AD3, "300000"], ["2026-10-10", A4, "120000"],
];
const TOTAL_UJI = 1_670_000;
// Kelengkapan spend (Fase 3.2): KPI CRM hanya dihitung bila SETIAP hari WIB di rentang punya baris spend. Fixture di bawah sengaja jarang (30 Sep, 1 Okt, 10 Okt) —
// tes yang mengukur CPL/CPA memakai pengisi Rp0 pada hari kosong (tidak mengubah total/percakapan), lalu dibersihkan.
async function isiHariSpendKosong(dari, sampai) {
  const imp = await testPrisma.metaSpendImport.findFirst(); const ada = new Set((await testPrisma.metaAdDailySpend.findMany({ select: { dateWib: true } })).map((r) => r.dateWib.toISOString().slice(0, 10)));
  const ids = []; let n = 0;
  for (let t = Date.parse(`${dari}T00:00:00Z`); t <= Date.parse(`${sampai}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10); if (ada.has(d)) continue;
    ids.push((await testPrisma.metaAdDailySpend.create({ data: { dateWib: new Date(`${d}T00:00:00Z`), accountId: AKUN, campaignId: HIER[AD1][0], adSetId: HIER[AD1][1], adId: AD1, currency: "IDR", spend: 0, source: "ADS_MANAGER_CSV", importedAt: new Date(), importId: imp.id, rowChecksum: String(++n).padStart(64, "f") } })).id);
  }
  return () => testPrisma.metaAdDailySpend.deleteMany({ where: { id: { in: ids } } });
}
const spendPost = (body, o = {}) => api("POST", "/spend", { body, ...o });
const bersihSpend = async () => {
  await testPrisma.metaAdSpendRevision.deleteMany({}); await testPrisma.metaAdDailySpend.deleteMany({}); await testPrisma.metaSpendImport.deleteMany({});
  await testPrisma.attributionKpiTarget.deleteMany({}); await testPrisma.attributionAlertState.deleteMany({});
};
async function pastikanReferensi() {
  await testPrisma.metaAdReference.deleteMany({ where: { adId: AD9 } });   // AD9 harus tetap UNMAPPED (tes sebelumnya sempat memetakannya)
  const nama = { [AD1]: "KM | ACQ | WA | JABO | IG ONLY | OCT26", [AD2]: "KM | ACQ | IG-Only | Jabodetabek-Bandung", [AD3]: "KM | TEST | FB BROAD | WA | JABO | OCT26", [A4]: "KM | PROMO 10.10" };
  for (const ad of [AD1, AD2, AD3, A4]) {
    await testPrisma.metaAdReference.upsert({ where: { adId: ad }, create: { adId: ad, adSetId: HIER[ad][1], campaignId: HIER[ad][0], campaignName: nama[ad], source: "MANUAL", syncedAt: new Date() }, update: { adSetId: HIER[ad][1], campaignId: HIER[ad][0], campaignName: nama[ad] } });
  }
}

test("SPEND: RBAC (tanpa token 401, SALES 403) untuk /spend /target /monitor; parameter salah 400", async () => {
  for (const [m, p] of [["GET", "/spend"], ["POST", "/spend"], ["GET", "/target"], ["PUT", "/target"], ["GET", "/monitor"]]) {
    assert.equal((await api(m, p, { token: null, body: m === "GET" ? undefined : {} })).status, 401, `${m} ${p} tanpa token`);
    assert.equal((await api(m, p, { token: tokenSales, body: m === "GET" ? undefined : {} })).status, 403, `${m} ${p} SALES`);
  }
  assert.equal((await api("GET", "/spend?dari=2026-01-01&sampai=2026-12-31")).status, 400);
  assert.equal((await api("GET", "/spend?dari=bukan&sampai=2026-10-10")).status, 400);
  assert.equal((await api("POST", "/spend", { body: {} })).status, 400);
});

test("SPEND impor CSV: dry-run default tidak menulis; commit wajib zona WIB; zona lain 422; total sumber salah → 409 tanpa tulis; benar → tersimpan; ID tetap string", async () => {
  await bersihSpend(); await pastikanReferensi();
  const csv = csvSpend(SPEND_UJI.map(([t, a, s]) => barisCsv(t, a, s)));
  const hitung = async () => ({ s: await testPrisma.metaAdDailySpend.count(), i: await testPrisma.metaSpendImport.count() });
  const dry = await spendPost({ csv, accountId: AKUN, totalSumber: String(TOTAL_UJI) });
  assert.equal(dry.status, 200);
  assert.equal(dry.json.dryRun, true);
  assert.deepEqual([dry.json.ringkasan.baru, dry.json.ringkasan.ditolak, dry.json.ringkasan.konflik, dry.json.ringkasan.adIdTidakTerpetakan], [7, 0, 0, 1]);
  assert.deepEqual(dry.json.rekonsiliasi, { totalImpor: TOTAL_UJI, totalSumber: TOTAL_UJI, selisih: 0, cocok: true });
  assert.deepEqual(await hitung(), { s: 0, i: 0 }, "dry-run tidak menulis apa pun");
  assert.equal((await spendPost({ csv, accountId: AKUN, dryRun: false })).json.code, "ZONA_WAKTU_WAJIB");
  const la = await spendPost({ csv, accountId: AKUN, dryRun: false, zonaWaktuAkun: "America/Los_Angeles" });
  assert.deepEqual([la.status, la.json.code], [422, "ZONA_WAKTU_BUKAN_WIB"]);
  const salah = await spendPost({ csv, accountId: AKUN, dryRun: false, zonaWaktuAkun: "Asia/Jakarta", totalSumber: String(TOTAL_UJI - 1) });
  assert.deepEqual([salah.status, salah.json.code], [409, "TOTAL_TIDAK_COCOK"]);
  assert.deepEqual(await hitung(), { s: 0, i: 0 }, "total tidak cocok → tidak ada yang ditulis");
  const ok = await spendPost({ csv, accountId: AKUN, dryRun: false, zonaWaktuAkun: "Asia/Jakarta", totalSumber: String(TOTAL_UJI), namaBerkas: "uji.csv" });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.json.dryRun, ok.json.ringkasan.baru, ok.json.rekonsiliasi.cocok], [false, 7, true]);
  assert.deepEqual(await hitung(), { s: 7, i: 1 });
  const imp = await testPrisma.metaSpendImport.findFirst();
  assert.deepEqual([imp.rowsNew, imp.rowsRejected, Number(imp.spendTotal), Number(imp.declaredTotal), imp.accountTimezone, imp.source], [7, 0, TOTAL_UJI, TOTAL_UJI, "Asia/Jakarta", "ADS_MANAGER_CSV"]);
  const baris = await testPrisma.metaAdDailySpend.findMany({ orderBy: [{ dateWib: "asc" }, { adId: "asc" }] });
  assert.ok(baris.every((b) => typeof b.adId === "string" && b.currency === "IDR" && b.revision === 1));
  assert.deepEqual(Object.keys(imp).filter((k) => /csv|raw|payload|token/i.test(k)), [], "audit impor tidak menyimpan isi berkas/token/respons mentah");
});

test("SPEND impor ulang: identik = tidak berubah; nilai berubah = snapshot diperbarui + revisi audit; nama campaign berubah (ID sama) tidak menggandakan; Ad ID baru masuk SPEND_UNMAPPED", async () => {
  const csv0 = csvSpend(SPEND_UJI.map(([t, a, s]) => barisCsv(t, a, s)));
  const h = (o) => spendPost({ accountId: AKUN, dryRun: false, zonaWaktuAkun: "Asia/Jakarta", ...o });
  const sama = await h({ csv: csv0 });
  assert.deepEqual([sama.json.ringkasan.baru, sama.json.ringkasan.berubah, sama.json.ringkasan.tidakBerubah], [0, 0, 7]);
  const rename = await h({ csv: csvSpend(SPEND_UJI.map(([t, a, s]) => barisCsv(t, a, s, { camp: "NAMA CAMPAIGN DIGANTI" }))) });
  assert.deepEqual([rename.json.ringkasan.baru, rename.json.ringkasan.berubah], [0, 0], "nama = label");
  assert.equal(await testPrisma.metaAdDailySpend.count(), 7, "tidak ada baris ganda");
  assert.equal((await testPrisma.metaAdDailySpend.findFirst({ where: { adId: AD1, dateWib: T("2026-09-30T00:00:00Z") } })).campaignName, "Nama Campaign", "nama hanya label; baris tidak ditulis ulang bila angka sama");
  // koreksi platform: spend 30 Sep AD1 400000 → 425000.50
  const ubah = SPEND_UJI.map(([t, a, s]) => (t === "2026-09-30" && a === AD1 ? [t, a, "425000.50"] : [t, a, s]));
  const r = await h({ csv: csvSpend(ubah.map(([t, a, s]) => barisCsv(t, a, s))) });
  assert.deepEqual([r.json.ringkasan.berubah, r.json.ringkasan.tidakBerubah], [1, 6]);
  const row = await testPrisma.metaAdDailySpend.findFirst({ where: { adId: AD1, dateWib: T("2026-09-30T00:00:00Z") } });
  assert.deepEqual([Number(row.spend), row.revision], [425000.5, 2]);
  const rev = await testPrisma.metaAdSpendRevision.findMany({ where: { spendId: row.id } });
  assert.deepEqual([rev.length, Number(rev[0].prevSpend), rev[0].revision], [1, 400000, 1], "nilai lama tersimpan");
  assert.equal(await testPrisma.metaSpendImport.count(), 4);
  // kembalikan ke nilai awal untuk tes berikutnya (revisi bertambah, tetap tanpa baris ganda)
  await h({ csv: csv0 });
  assert.equal(await testPrisma.metaAdDailySpend.count(), 7);
  assert.equal(await testPrisma.metaAdSpendRevision.count({ where: { spendId: row.id } }), 2);
});

test("SPEND impor: baris buruk ditolak per baris tanpa menggagalkan berkas; notasi ilmiah, USD, negatif; hierarki beda dari referensi = konflik", async () => {
  const buruk = csvSpend([
    barisCsv("2026-10-03", AD1, "1000"),                       // sah
    barisCsv("2026-10-03", AD2, "1.5E+5"),                     // notasi ilmiah
    barisCsv("2026-10-03", AD3, "-5"),                         // negatif
    barisCsv("2026-10-03", AD1, "\"1.000,50\""),                  // format ribuan/koma
  ]);
  const d = await spendPost({ csv: buruk, accountId: AKUN });
  assert.deepEqual([d.json.ringkasan.baru, d.json.ringkasan.ditolak], [1, 3]);
  assert.deepEqual(d.json.ditolak.map((x) => x.alasan).sort(), ["SPEND_FORMAT_TIDAK_DIKENAL", "SPEND_NEGATIF", "SPEND_NOTASI_ILMIAH"]);
  const usd = await spendPost({ csv: csvSpend([barisCsv("2026-10-03", AD1, "1000")], kolomCsv.replace("(IDR)", "(USD)")), accountId: AKUN });
  assert.deepEqual([usd.json.ringkasan.baru, usd.json.ditolak[0].alasan], [0, "MATA_UANG_BUKAN_IDR"]);
  const konflik = barisCsv("2026-10-03", AD1, "1000").replace(HIER[AD1][1], "52777777777777");
  const k = await spendPost({ csv: csvSpend([konflik]), accountId: AKUN });
  assert.equal(k.json.konflik[0].alasan, "HIERARKI_BEDA_DARI_REFERENSI");
  assert.equal(await testPrisma.metaAdDailySpend.count(), 7, "tidak ada yang tertulis oleh dry-run");
});

test("SPEND dua impor PARALEL untuk akun yang sama: tidak ada baris ganda; yang kedua 200 (identik) atau 409 SEDANG_DIIMPOR", async () => {
  await bersihSpend();
  const csv = csvSpend(SPEND_UJI.map(([t, a, s]) => barisCsv(t, a, s)));
  const body = { csv, accountId: AKUN, dryRun: false, zonaWaktuAkun: "Asia/Jakarta" };
  const [a, b] = await Promise.all([spendPost(body), spendPost(body)]);
  assert.ok([a.status, b.status].every((s) => s === 200 || s === 409), `${a.status},${b.status}`);
  assert.ok([a.status, b.status].includes(200));
  assert.equal(await testPrisma.metaAdDailySpend.count(), 7, "unik per tanggal+akun+Ad+sumber");
  assert.equal(Number((await testPrisma.$queryRaw`SELECT sum(spend)::text s FROM meta_ad_daily_spend`)[0].s), TOTAL_UJI);
});

test("SPEND: sumber ganda untuk hari+Ad yang sama dipilih SATU menurut prioritas (API > CSV) — tidak pernah dijumlah", async () => {
  const imp = await testPrisma.metaSpendImport.findFirst();
  await testPrisma.metaAdDailySpend.create({ data: { dateWib: T("2026-09-30T00:00:00Z"), accountId: AKUN, campaignId: HIER[AD1][0], adSetId: HIER[AD1][1], adId: AD1, currency: "IDR", spend: 410000, source: "META_MARKETING_API", importedAt: new Date(), importId: imp.id, rowChecksum: "x".repeat(64) } });
  const r = await api("GET", `/?${P}&level=campaign`);
  const g1 = kunci(r.json, CAMP1);
  assert.equal(g1.biaya.spend, 410000 + 500000, "30 Sep dari API (410000), 1 Okt dari CSV (500000): bukan 400000+410000");
  await testPrisma.metaAdDailySpend.deleteMany({ where: { source: "META_MARKETING_API" } });
});

test("LAPORAN + spend: KPI per campaign dari spend/lead/closing/revenue; level ad = adset = campaign; spend-only tampil; SPEND_UNMAPPED; READ ONLY; privasi", async () => {
  await benihLaporan(); await pastikanReferensi();
  const bersihkanPengisi = await isiHariSpendKosong("2026-09-25", "2026-10-10");
  // atribusi sudah "mulai" sebelum rentang uji (touch EXISTING lama, di luar rentang): rentang uji sebanding → KPI dihitung
  const awal = await testPrisma.customer.create({ data: { name: "Awal Atribusi", phone: "6285300000099", createdAt: T("2026-09-01T03:00:00Z"), leadSource: "META_ADS" } });
  await testPrisma.attributionTouch.create({ data: { customerId: awal.id, adId: AD1, touchAt: T("2026-09-20T03:00:00Z"), touchDateWib: T("2026-09-20T00:00:00Z"), mappingStatusAtTouch: "UNMAPPED", evidenceSource: "CTWA_AD", sourceType: "ad", customerStatusAtTouch: "EXISTING", customerBasisAtTouch: "RIWAYAT_PESAN", dedupeKey: "awal-atribusi-uji" } });
  const sebelum = { s: await testPrisma.metaAdDailySpend.count(), i: await testPrisma.metaSpendImport.count(), r: await testPrisma.metaAdSpendRevision.count(), o: await testPrisma.order.count(), p: await testPrisma.payment.count(), t: await testPrisma.attributionTouch.count() };
  const r = await api("GET", `/?${P}&level=campaign`);
  assert.equal(r.status, 200);
  const j = r.json;
  assert.equal(j.rekonsiliasi.ok, true, JSON.stringify(j.rekonsiliasi.cek.filter((c) => !c.ok)));
  assert.ok(j.rekonsiliasi.cek.some((c) => c.id === "spend_baris_vs_total" && c.ok));
  const sql = Number((await testPrisma.$queryRaw`SELECT sum(spend)::text s FROM meta_ad_daily_spend WHERE date_wib BETWEEN '2026-09-25' AND '2026-10-10'`)[0].s);
  assert.equal(j.biaya.spendTotal, sql, "total laporan = SQL independen");
  assert.equal(j.biaya.spendTotal, TOTAL_UJI);
  assert.equal(j.biaya.spendTidakTerpetakan, 50000);
  assert.deepEqual(j.biaya.spendUnmapped, [{ adId: AD9, spend: 50000 }]);

  const g1 = kunci(j, CAMP1);
  assert.equal(g1.biaya.spend, 900000);
  assert.equal(g1.lead.unik, 3);
  assert.equal(g1.biaya.cpl, 300000, "900000 / 3 acquisition lead (spam ikut dihitung sebagai lead unik)");
  assert.equal(g1.biaya.cpa, 450000, "900000 / 2 closing utama (customerLunasTerbuktiLedger)");
  assert.equal(g1.biaya.costPerCustomerOrder, 450000, "900000 / 2 customer ber-order (bukan 3 order)");
  assert.equal(g1.biaya.bookedRoas, Math.round((7_500_000 / 900000) * 100) / 100);
  assert.equal(g1.biaya.cashRoas, Math.round((6_750_000 / 900000) * 100) / 100, "uang ledger bersih (refund 0)");
  assert.equal(g1.biaya.platformConversations, 10, "2 baris x 5 percakapan platform: BUKAN lead");
  assert.notEqual(g1.biaya.cpl, g1.biaya.spend / g1.biaya.platformConversations);

  const g3 = kunci(j, "52689735916884");   // AD2: 300000, 2 lead, 0 closing
  assert.equal(g3.biaya.spend, 300000);
  assert.deepEqual([g3.biaya.cpl, g3.biaya.cpa, g3.biaya.alasanNull.cpa], [150000, null, "BELUM_ADA_KONVERSI"]);
  const g2 = kunci(j, CAMP2);              // AD3: 300000, 1 lead (C8) — LUNAS CRM tapi ledger kurang
  assert.deepEqual([g2.biaya.spend, g2.biaya.cpl, g2.biaya.cpa], [300000, 300000, null]);
  const so = kunci(j, "52696128518884");   // campaign hanya-spend
  assert.deepEqual([so.lead.unik, so.biaya.spend, so.biaya.status, so.biaya.cpl, so.biaya.alasanNull.cpl], [0, 120000, "BELUM_ADA_KONVERSI", null, "BELUM_ADA_KONVERSI"]);
  const un = kunci(j, "UNMAPPED");
  assert.deepEqual([un.biaya.spend, un.biaya.status], [50000, "MAPPING_BELUM_ADA"]);
  assert.ok(j.peringatan.some((w) => w.kode === "SPEND_UNMAPPED"));
  assert.ok(!j.peringatan.some((w) => w.kode === "BIAYA_BELUM_TERHUBUNG"));
  assert.equal(j.biaya.roas, null);
  assert.equal(j.biaya.targetDiatur, false);
  assert.ok(j.grup.every((g) => g.biaya.evaluasi.status === null), "tanpa target tidak ada evaluasi/warna");

  // sum level: ad = adset = campaign
  for (const lvl of ["adset", "ad"]) {
    const x = await api("GET", `/?${P}&level=${lvl}`);
    assert.equal(x.json.biaya.spendTotal, TOTAL_UJI, `level ${lvl}`);
    assert.equal(x.json.rekonsiliasi.ok, true);
    assert.equal(Math.round(x.json.grup.reduce((s, g) => s + (g.biaya.spend ?? 0), 0)), TOTAL_UJI);
  }
  // drilldown: campaign tertentu → hanya spend Ad miliknya (tanpa UNMAPPED)
  const d = await api("GET", `/?${P}&level=ad&campaignId=${CAMP1}`);
  assert.equal(d.json.biaya.spendTotal, 900000);
  assert.deepEqual(d.json.grup.map((g) => g.kunci), [AD1]);

  // READ ONLY + privasi
  assert.deepEqual({ s: await testPrisma.metaAdDailySpend.count(), i: await testPrisma.metaSpendImport.count(), r: await testPrisma.metaAdSpendRevision.count(), o: await testPrisma.order.count(), p: await testPrisma.payment.count(), t: await testPrisma.attributionTouch.count() }, sebelum);
  for (const s of ["6285300", "Pelanggan Uji", CLID, TEXT_CANARY]) assert.ok(!r.teks.includes(s), `bocor: ${s}`);
  assert.ok(!/"(phone|name|customerId|orderId|ctwaClid|messageId|token)"\s*:/.test(r.teks));
});

test("LAPORAN: data terlambat (rentang melewati spend terakhir) → DATA_TERLAMBAT; tanpa spend di DB → BELUM_TERHUBUNG dan semua null (tanpa nol palsu)", async () => {
  const t = await api("GET", "/?dari=2026-09-25&sampai=2026-10-16&level=campaign");
  assert.equal(t.json.biaya.sumber.terlambat, true);
  assert.ok(t.json.peringatan.some((w) => w.kode === "SPEND_TERLAMBAT"));
  assert.ok(t.json.grup.filter((g) => g.status === "MAPPED").every((g) => g.biaya.status === "DATA_TERLAMBAT"));
  const simpan = await testPrisma.metaAdDailySpend.findMany(); const impS = await testPrisma.metaSpendImport.findMany(); const revS = await testPrisma.metaAdSpendRevision.findMany();
  await testPrisma.metaAdSpendRevision.deleteMany({}); await testPrisma.metaAdDailySpend.deleteMany({});
  const kosong = await api("GET", `/?${P}&level=campaign`);
  assert.equal(kosong.json.biaya.status, "BELUM_TERHUBUNG");
  assert.deepEqual([kosong.json.biaya.spend, kosong.json.biaya.cpl, kosong.json.biaya.cpa, kosong.json.biaya.bookedRoas, kosong.json.biaya.cashRoas], [null, null, null, null, null]);
  assert.ok(kosong.json.grup.every((g) => g.biaya.spend === null && g.biaya.cpl === null && g.biaya.cpa === null));
  assert.ok(kosong.json.peringatan.some((w) => w.kode === "BIAYA_BELUM_TERHUBUNG"));
  await testPrisma.metaAdDailySpend.createMany({ data: simpan }); await testPrisma.metaAdSpendRevision.createMany({ data: revS });
  assert.equal(await testPrisma.metaSpendImport.count(), impS.length);
});

test("TARGET: default null; PUT valid mengisi; evaluasi baru muncul setelah target ada; nilai salah 400; GET menampilkan; tidak ada aksi pada iklan", async () => {
  const bersihkanPengisi = await isiHariSpendKosong("2026-09-25", "2026-10-10");
  const g0 = await api("GET", "/target");
  assert.deepEqual([g0.json.diatur, Object.values(g0.json.target).every((v) => v === null)], [false, true]);
  assert.equal((await api("PUT", "/target", { body: { maxCpl: -5 } })).status, 400);
  assert.equal((await api("PUT", "/target", { body: { matikanIklan: true } })).status, 400);
  const p = await api("PUT", "/target", { body: { maxCpl: 200000, minAcquisitionLeads: 2, minCohortAgeDays: 7, maxSpamSharePercent: 50 } });
  assert.equal(p.status, 200);
  assert.equal(p.json.target.maxCpl, 200000);
  const j = (await api("GET", `/?${P}&level=campaign`)).json;
  assert.equal(j.biaya.targetDiatur, true);
  const g1 = kunci(j, CAMP1), g3 = kunci(j, "52689735916884"), g2 = kunci(j, CAMP2);
  assert.equal(g1.biaya.evaluasi.status, "PERLU_REVIEW", "CPL 300000 > 200000");
  assert.equal(g3.biaya.evaluasi.status, "BAIK", "CPL 150000 <= 200000, 2 lead >= minimum, spam 0%");
  assert.equal(g2.biaya.evaluasi.status, "DATA_KURANG", "1 lead < minimum 2");
  assert.equal(kunci(j, "UNMAPPED").biaya.evaluasi.status, "DATA_KURANG");
  assert.ok((await testPrisma.attributionKpiTarget.count()) === 1);
  await bersihkanPengisi();
});

test("MONITOR: endpoint ADMIN, baca-saja; WAHA tak terjangkau = CRIT; agregat tanpa nomor/JID/chat/clid; state alarm dapat dibaca", async () => {
  const r = await api("GET", "/monitor");
  assert.equal(r.status, 200);
  assert.equal(r.json.alarm.find((a) => a.key === "waha_session").level, "CRIT", "WAHA diarahkan ke port mati di tes");
  assert.equal(r.json.kodeKeluar, 2);
  assert.equal(r.json.status, "KRITIS");
  for (const k of ["waha", "inbound", "touch", "capture", "referensi", "spend"]) assert.ok(k in r.json.snapshot, k);
  assert.deepEqual(r.json.ambang.sampelMinimal, 30);
  assert.doesNotMatch(r.teks, /\b62\d{9,13}\b|@c\.us|@lid|ctwa_clid|6285300|Pelanggan Uji/);
  assert.equal(r.json.snapshot.touch.duplikat, 0);
  assert.equal(r.json.snapshot.touch.unmapped, (await api("GET", "/kesehatan")).json.db.pendingPemetaan.touch);
});

test("ROLLBACK KODE aman: tidak ada jalur kode yang menghapus spend/revisi/touch; migrasi aditif tanpa DROP/DELETE/UPDATE", async () => {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const dir = fileURLToPath(new URL("../../src", import.meta.url));
  const hasil = execFileSync(process.execPath, ["-e", `
    const fs=require("fs"),p=require("path");const out=[];
    (function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else if(/\\.js$/.test(e.name)){const s=fs.readFileSync(f,"utf8");if(/(metaAdDailySpend|metaAdSpendRevision|attributionTouch|metaSpendImport)\\.(delete|deleteMany)\\b/.test(s)||/(DELETE\\s+FROM|DROP\\s+TABLE|TRUNCATE)\\s+"?(meta_ad_daily_spend|meta_ad_spend_revisions|attribution_touches|meta_spend_imports)/i.test(s))out.push(f)}}})(process.argv[1]);
    console.log(JSON.stringify(out));`, dir]).toString();
  assert.equal(hasil.trim(), "[]");
  const mig = fs.readFileSync(fileURLToPath(new URL("../../prisma/migrations/20261201090000_atribusi_spend_kpi/migration.sql", import.meta.url)), "utf8").replace(/--.*$/gm, "").replace(/ON (UPDATE|DELETE) (CASCADE|RESTRICT|SET NULL)/g, "");
  assert.ok(!/\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b|ALTER\s+TABLE\s+"(?!meta_ad_daily_spend|meta_ad_spend_revisions)/i.test(mig), "hanya CREATE + ALTER FK pada tabel baru");
  assert.equal((mig.match(/CREATE TABLE/g) || []).length, 5);
});

test("MONITOR: CTWA_AD valid di capture Fase 0 tanpa touch = CRIT (angka agregat saja); setelah touch ada = OK; berkas capture tak berisi identitas diabaikan", async () => {
  fs.mkdirSync(process.env.CTWA_CAPTURE_DIR, { recursive: true });
  const lalu = new Date(Date.now() - 20 * 60_000);
  const hari = lalu.toISOString().slice(0, 10);
  const berkas = path.join(process.env.CTWA_CAPTURE_DIR, `ctwa-capture-${hari}.jsonl`);
  const obs = (hash, sid, tipe = "ad") => JSON.stringify({ v: 1, observedAt: lalu.toISOString(), event: "message", verdict: "CTWA_AD", msgIdHash: hash, values: { sourceId: sid, sourceType: tipe } });
  fs.writeFileSync(berkas, [obs("aaaa000000000001", AD1), obs("aaaa000000000001", AD1), obs("aaaa000000000002", AD2), obs("aaaa000000000003", "bukan-id"), obs("aaaa000000000004", AD1, "post")].join("\n") + "\n");
  const sejak = encodeURIComponent(new Date(Date.now() - 60 * 60_000).toISOString());
  const m = await api("GET", `/monitor?sejak=${sejak}`);
  const a = m.json.alarm.find((x) => x.key === "ctwa_tanpa_touch");
  assert.equal(m.json.snapshot.capture.ctwaValidTercatat, 2, "dua msgIdHash unik valid (duplikat message+message.any, sourceId salah, sourceType bukan ad diabaikan)");
  const adaTouch = m.json.snapshot.capture.touchCtwaDalamJendela;
  assert.equal(a.level, m.json.snapshot.capture.ctwaValidTanpaTouch > 0 ? "CRIT" : "OK");
  assert.equal(m.json.snapshot.capture.ctwaValidTanpaTouch, Math.max(0, 2 - adaTouch));
  // tambah touch CTWA di jendela sebanyak kekurangan → alarm OK
  const kurang = m.json.snapshot.capture.ctwaValidTanpaTouch;
  const c = await testPrisma.customer.create({ data: { name: "Monitor Uji", phone: "6285311111111", leadSource: "META_ADS" } });
  for (let i = 0; i < kurang; i++) {
    const at = new Date(Date.now() - 15 * 60_000);
    await testPrisma.attributionTouch.create({ data: { customerId: c.id, adId: AD1, touchAt: at, touchDateWib: new Date(new Date(at.getTime() + 7 * 3600e3).toISOString().slice(0, 10) + "T00:00:00Z"), mappingStatusAtTouch: "UNMAPPED", evidenceSource: "CTWA_AD", sourceType: "ad", customerStatusAtTouch: "EXISTING", customerBasisAtTouch: "RIWAYAT_PESAN", createdAt: at, dedupeKey: `mon:${i}:${Date.now()}` } });
  }
  const m2 = await api("GET", `/monitor?sejak=${sejak}`);
  assert.equal(m2.json.alarm.find((x) => x.key === "ctwa_tanpa_touch").level, "OK");
  assert.doesNotMatch(m2.teks, /aaaa00000000|6285311111111|Monitor Uji/);
});

// ══════════════════ Fase 3.1: dataset Windsor 15 Okt (fixture), idempotensi, rekonsiliasi, sebelum atribusi ══════════════════
const { WINDSOR_20261015, CONTROL_TOTAL, CONTROL_CAMPAIGN, csvWindsor } = await import("../fixtures/windsorSpend20261015.js");
test("WINDSOR 15 Okt: dry-run bersih; commit; ulang = unchanged 10; rekonsiliasi Ad = Ad Set = Campaign = akun = Rp1.151.588; Rp0 dengan percakapan diterima; reach tidak dijumlah", async () => {
  await bersihSpend();
  for (const r of WINDSOR_20261015) await testPrisma.metaAdReference.upsert({ where: { adId: r.ad_id }, create: { adId: r.ad_id, adSetId: r.adset_id, campaignId: r.campaign_id, adName: r.ad_name, adSetName: r.adset_name, campaignName: r.campaign_name, source: "MANUAL", syncedAt: new Date() }, update: { adSetId: r.adset_id, campaignId: r.campaign_id } });
  const body = { csv: csvWindsor(), accountId: "2081614415911241", sumber: "WINDSOR_API", zonaWaktuAkun: "Asia/Jakarta", totalSumber: String(CONTROL_TOTAL.spend) };
  const dry = await spendPost({ ...body, dryRun: true });
  assert.equal(dry.status, 200);
  assert.deepEqual([dry.json.ringkasan.diterima, dry.json.ringkasan.baru, dry.json.ringkasan.ditolak, dry.json.ringkasan.konflik, dry.json.ringkasan.adIdTidakTerpetakan], [10, 10, 0, 0, 0]);
  assert.deepEqual(dry.json.rekonsiliasi, { totalImpor: CONTROL_TOTAL.spend, totalSumber: CONTROL_TOTAL.spend, selisih: 0, cocok: true });
  assert.equal(await testPrisma.metaAdDailySpend.count(), 0, "dry-run tidak menulis");
  const komit = await spendPost({ ...body, dryRun: false });
  assert.equal(komit.status, 200);
  assert.equal(await testPrisma.metaAdDailySpend.count(), 10);
  const ulang = await spendPost({ ...body, dryRun: false });
  assert.deepEqual([ulang.json.ringkasan.baru, ulang.json.ringkasan.berubah, ulang.json.ringkasan.tidakBerubah], [0, 0, 10]);
  assert.equal(await testPrisma.metaAdDailySpend.count(), 10, "tidak menggandakan");
  assert.equal(await testPrisma.metaAdSpendRevision.count(), 0);
  const q = async (sql) => (await testPrisma.$queryRawUnsafe(sql))[0];
  const a = await q("select sum(spend)::text s, sum(impressions)::text i, sum(link_clicks)::text l, sum(platform_conversations)::text k, count(*) filter (where spend = 0 and platform_conversations > 0) nol_konv from meta_ad_daily_spend");
  assert.deepEqual([a.s, a.i, a.l, a.k, Number(a.nol_konv)], [String(CONTROL_TOTAL.spend) + ".00", String(CONTROL_TOTAL.impressions), String(CONTROL_TOTAL.link_clicks), String(CONTROL_TOTAL.conversation_started_7d), 1]);
  for (const [col, lvl] of [["ad_id", "Ad"], ["ad_set_id", "Ad Set"], ["campaign_id", "Campaign"]]) {
    const t = await q("select sum(x)::text s from (select sum(spend) x from meta_ad_daily_spend group by " + col + ") z");
    assert.equal(t.s, String(CONTROL_TOTAL.spend) + ".00", "Σ level " + lvl);
  }
  const per = await testPrisma.$queryRawUnsafe("select campaign_id c, sum(spend)::text s, sum(platform_conversations)::text k from meta_ad_daily_spend group by 1");
  for (const p of per) assert.deepEqual([Number(p.s), Number(p.k)], [CONTROL_CAMPAIGN[p.c].spend, CONTROL_CAMPAIGN[p.c].conversations], "campaign " + p.c);
  const reachAd = Number((await q("select sum(reach)::text r from meta_ad_daily_spend")).r);
  assert.ok(reachAd > CONTROL_TOTAL.reach, "Σ reach level Ad (" + reachAd + ") > reach akun (" + CONTROL_TOTAL.reach + ") — non-additive, karena itu tidak pernah dijumlah");
  const sp = await api("GET", "/spend?dari=2026-10-15&sampai=2026-10-15");
  assert.ok(!JSON.stringify(sp.json).toLowerCase().includes("reach"));
  assert.equal(sp.json.totalSpend, CONTROL_TOTAL.spend);
});

test("WINDSOR 15 Okt: laporan sebelum atribusi — spend tersedia, CPL/CPA/ROAS null, evaluasi TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI, RENTANG_SEBELUM_ATRIBUSI, tanpa reach", async () => {
  await testPrisma.attributionTouch.deleteMany({});
  await testPrisma.attributionTouch.create({ data: { customerId: (await testPrisma.customer.findFirst()).id, adId: AD1, touchAt: T("2026-10-16T10:25:43Z"), touchDateWib: T("2026-10-16T00:00:00Z"), mappingStatusAtTouch: "UNMAPPED", evidenceSource: "CTWA_AD", sourceType: "ad", customerStatusAtTouch: "EXISTING", customerBasisAtTouch: "RIWAYAT_PESAN", dedupeKey: "mulai-16okt-uji" } });
  await api("PUT", "/target", { body: { maxCpl: 100000, minAcquisitionLeads: 1 } });
  const r = await api("GET", "/?dari=2026-10-15&sampai=2026-10-15&level=campaign");
  assert.equal(r.status, 200);
  const j = r.json;
  assert.equal(j.rekonsiliasi.ok, true, JSON.stringify(j.rekonsiliasi.cek.filter((c) => !c.ok)));
  assert.ok(j.peringatan.some((w) => w.kode === "RENTANG_SEBELUM_ATRIBUSI") && j.peringatan.some((w) => w.kode === "BIAYA_SEBELUM_ATRIBUSI"));
  assert.equal(j.biaya.status, "SEBELUM_ATRIBUSI");
  assert.deepEqual([j.biaya.spendTotal, j.biaya.cpl, j.biaya.cpa, j.biaya.bookedRoas, j.biaya.cashRoas], [CONTROL_TOTAL.spend, null, null, null, null]);
  assert.equal(j.biaya.evaluasi.status, "TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI", "walau target diisi");
  assert.equal(j.biaya.sumber.terhubung, true);
  const spendCamp = Object.fromEntries(j.grup.map((g) => [g.kunci, g.biaya.spend]));
  for (const [c, v] of Object.entries(CONTROL_CAMPAIGN)) assert.equal(spendCamp[c], v.spend, "campaign " + c);
  assert.equal(Math.round(Object.values(spendCamp).reduce((s, x) => s + x, 0)), CONTROL_TOTAL.spend);
  for (const g of j.grup) {
    assert.equal(g.biaya.status, "SEBELUM_ATRIBUSI");
    assert.equal(g.biaya.evaluasi.status, "TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI");
    assert.deepEqual([g.biaya.cpl, g.biaya.cpa, g.biaya.costPerQualifiedLead, g.biaya.costPerCustomerOrder], [null, null, null, null]);
    assert.equal(g.biaya.platformConversations, CONTROL_CAMPAIGN[g.kunci].conversations);
    assert.equal(g.biaya.impressions, CONTROL_CAMPAIGN[g.kunci].impressions);
    assert.equal(g.biaya.linkClicks, CONTROL_CAMPAIGN[g.kunci].link_clicks);
    const kv = CONTROL_CAMPAIGN[g.kunci].conversations;
    assert.equal(g.biaya.costPerPlatformConversation, kv > 0 ? Math.round((CONTROL_CAMPAIGN[g.kunci].spend / kv) * 100) / 100 : null, "biaya per percakapan platform tersedia walau sebelum atribusi");
  }
  assert.deepEqual([j.biaya.platformConversations, j.biaya.impressions, j.biaya.linkClicks], [CONTROL_TOTAL.conversation_started_7d, CONTROL_TOTAL.impressions, CONTROL_TOTAL.link_clicks], "total = Σ metrik aditif");
  assert.equal(j.biaya.costPerPlatformConversation, Math.round((CONTROL_TOTAL.spend / CONTROL_TOTAL.conversation_started_7d) * 100) / 100);
  assert.ok(spendCamp["52696128518884"] === 0 && j.grup.find((g) => g.kunci === "52696131903884").biaya.platformConversations === 1, "campaign Rp0 dengan percakapan tetap tampil");
  assert.ok(!r.teks.toLowerCase().includes("reach"));
  const parsial = await api("GET", "/?dari=2026-10-16&sampai=2026-10-16&level=campaign");
  assert.equal(parsial.status, 200);
  assert.ok(parsial.json.peringatan.some((w) => w.kode === "BIAYA_HARI_ATRIBUSI_PARSIAL"));
  assert.equal(parsial.json.biaya.evaluasi.status, "TIDAK_DAPAT_DIEVALUASI_HARI_ATRIBUSI_PARSIAL");
  // atribusi dimulai lebih awal (14 Okt): rentang 15 Okt menjadi sebanding → tanpa label sebelum-atribusi, CPL dihitung dari lead (0 lead → BELUM_ADA_KONVERSI)
  await testPrisma.attributionTouch.updateMany({ data: { touchAt: T("2026-10-14T10:00:00Z"), touchDateWib: T("2026-10-14T00:00:00Z") } });
  const sebanding = await api("GET", "/?dari=2026-10-15&sampai=2026-10-15&level=campaign");
  assert.ok(!sebanding.json.peringatan.some((w) => /SEBELUM_ATRIBUSI|HARI_ATRIBUSI_PARSIAL/.test(w.kode)));
  assert.equal(sebanding.json.biaya.status, "BELUM_ADA_KONVERSI");
  await testPrisma.attributionKpiTarget.deleteMany({});
});

// ══════════════════ Backfill 1–14 Okt (SEBELUM atribusi): data SINTETIS uji, bukan data Meta ══════════════════
test("BACKFILL 1–14 Okt (sintetis): dry-run/commit/ulang idempoten; Rp0 diterima; notasi ilmiah & negatif ditolak; setiap hari SEBELUM_ATRIBUSI, CPL/CPA/ROAS null, biaya per percakapan platform tampil; reach tidak dijumlah", async () => {
  await bersihSpend(); await pastikanReferensi();
  await testPrisma.attributionTouch.deleteMany({});
  const c0 = await testPrisma.customer.create({ data: { name: "Mulai Atribusi", phone: "6285300000098", leadSource: "META_ADS" } });
  await testPrisma.attributionTouch.create({ data: { customerId: c0.id, adId: AD1, touchAt: T("2026-10-16T10:25:43Z"), touchDateWib: T("2026-10-16T00:00:00Z"), mappingStatusAtTouch: "UNMAPPED", evidenceSource: "CTWA_AD", sourceType: "ad", customerStatusAtTouch: "EXISTING", customerBasisAtTouch: "RIWAYAT_PESAN", dedupeKey: "mulai-backfill-uji" } });
  const hari = Array.from({ length: 14 }, (_, i) => "2026-10-" + String(i + 1).padStart(2, "0"));
  const kolom = "date,account_id,currency,timezone,campaign_id,adset_id,ad_id,spend,impressions,reach,link_clicks,Messaging conversations started";
  const rows = [];
  hari.forEach((h, i) => { rows.push(`${h},${AKUN},IDR,Asia/Jakarta,${HIER[AD1][0]},${HIER[AD1][1]},${AD1},${100000 + i * 1000},${1000 + i},${900 + i},${10 + i},${i % 4}`); rows.push(`${h},${AKUN},IDR,Asia/Jakarta,${HIER[AD2][0]},${HIER[AD2][1]},${AD2},${i === 3 ? 0 : 50000},${i === 3 ? 0 : 500},${i === 3 ? 0 : 450},${i === 3 ? 0 : 5},${i === 3 ? 1 : 2}`); });
  const csv = [kolom, ...rows].join("\n");
  const total = hari.reduce((s, _, i) => s + 100000 + i * 1000 + (i === 3 ? 0 : 50000), 0);
  const body = { csv, accountId: AKUN, sumber: "WINDSOR_API", zonaWaktuAkun: "Asia/Jakarta", totalSumber: String(total) };
  const dry = await spendPost({ ...body, dryRun: true });
  assert.deepEqual([dry.status, dry.json.ringkasan.baru, dry.json.ringkasan.ditolak, dry.json.ringkasan.konflik, dry.json.ringkasan.adIdTidakTerpetakan], [200, 28, 0, 0, 0]);
  assert.equal(dry.json.rekonsiliasi.cocok, true);
  assert.equal(await testPrisma.metaAdDailySpend.count(), 0);
  await spendPost({ ...body, dryRun: false });
  const ulang = await spendPost({ ...body, dryRun: false });
  assert.deepEqual([ulang.json.ringkasan.baru, ulang.json.ringkasan.berubah, ulang.json.ringkasan.tidakBerubah], [0, 0, 28]);
  assert.equal(await testPrisma.metaAdDailySpend.count(), 28);
  // penolakan
  const buruk = await spendPost({ csv: [kolom, `2026-10-02,${AKUN},IDR,Asia/Jakarta,${HIER[AD1][0]},${HIER[AD1][1]},${AD1},1.0E+5,1,1,1,1`, `2026-10-02,${AKUN},IDR,Asia/Jakarta,${HIER[AD2][0]},${HIER[AD2][1]},${AD2},-5,1,1,1,1`].join("\n"), accountId: AKUN, sumber: "WINDSOR_API" });
  assert.deepEqual(buruk.json.ditolak.map((x) => x.alasan).sort(), ["SPEND_NEGATIF", "SPEND_NOTASI_ILMIAH"]);
  // setiap hari: sebelum atribusi
  for (const [i, h] of hari.entries()) {
    const r = await api("GET", `/?dari=${h}&sampai=${h}&level=campaign`);
    assert.equal(r.status, 200, h);
    const j = r.json;
    assert.equal(j.rekonsiliasi.ok, true, h);
    assert.equal(j.biaya.status, "SEBELUM_ATRIBUSI", h);
    assert.equal(j.biaya.evaluasi.status, "TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI", h);
    assert.deepEqual([j.biaya.cpl, j.biaya.cpa, j.biaya.bookedRoas, j.biaya.cashRoas], [null, null, null, null], h);
    assert.ok(j.grup.every((g) => g.biaya.cpl === null && g.biaya.cpa === null));
    assert.equal(j.biaya.spendTotal, 100000 + i * 1000 + (i === 3 ? 0 : 50000), h);
    assert.ok(j.biaya.costPerPlatformConversation === null || typeof j.biaya.costPerPlatformConversation === "number");
    assert.ok(!r.teks.toLowerCase().includes("reach"), "reach tidak ditampilkan " + h);
  }
  const hari4 = (await api("GET", "/?dari=2026-10-04&sampai=2026-10-04&level=campaign")).json;   // hari ke-4 (i=3): campaign AD2 spend Rp0 dengan percakapan 1
  const c2 = hari4.grup.find((g) => g.kunci === HIER[AD2][0]);
  assert.deepEqual([c2.biaya.spend, c2.biaya.platformConversations, c2.biaya.costPerPlatformConversation], [0, 1, 0]);
  // rentang 1–14 sekaligus tetap sebelum atribusi; rentang yang menyentuh 16 Okt (hari parsial) tidak memberi CPL/CPA
  const semua = (await api("GET", "/?dari=2026-10-01&sampai=2026-10-14&level=ad")).json;
  assert.equal(semua.biaya.status, "SEBELUM_ATRIBUSI");
  assert.equal(semua.biaya.spendTotal, total);
  await bersihSpend();
});
