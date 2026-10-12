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

test("flag NYALA: customer baru → 1 touch (Ad ID string, UNMAPPED, customerNewAtTouch=true); tabel tanpa PII / clid mentah / isi chat", async () => {
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
  assert.equal(t.customerNewAtTouch, true);
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

test("customer LAMA yang kembali lewat iklan lain: touch BARU terpisah (customerNewAtTouch=false); lead/createdAt customer tidak berubah", async () => {
  const PH = "6285200000002";                                   // sudah ada dari tes flag nyala
  const sebelum = await testPrisma.customer.findUnique({ where: { phone: PH }, select: { id: true, createdAt: true, leadSource: true } });
  const nCust = await testPrisma.customer.count();
  const p = gows({ phone: PH, msgId: "3EB0ATR00004", ad: AD2 });
  await post("message", p);
  assert.ok(await settle(async () => (await touchCount({ customerId: sebelum.id })) === 2));
  const ts = await testPrisma.attributionTouch.findMany({ where: { customerId: sebelum.id }, orderBy: { touchAt: "asc" } });
  assert.deepEqual(ts.map((t) => [t.adId, t.customerNewAtTouch]), [[AD1, true], [AD2, false]]);
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

test("kegagalan atribusi TIDAK menggagalkan inbox: Message + Customer tetap tersimpan, kegagalan tercatat terpisah", async () => {
  const asli = prisma.attributionTouch.create;
  prisma.attributionTouch.create = async () => { throw Object.assign(new Error("simulasi gagal 6285200000008"), { code: "P1001" }); };
  _resetTouchStats();
  const warn = console.warn; const log = []; console.warn = (...a) => log.push(a.join(" "));
  try {
    const PH = "6285200000008";
    const p = gows({ phone: PH, msgId: "3EB0ATR00008", ad: AD1 });
    await post("message", p);
    assert.ok(await settle(async () => (await msgCount(p.id)) === 1), "Message tetap tersimpan");
    assert.ok(await settle(async () => _getTouchStats().gagal === 1));
    assert.equal(await testPrisma.customer.count({ where: { phone: PH } }), 1);
    assert.equal(await testPrisma.conversation.count({ where: { customer: { phone: PH } } }), 1);
    assert.ok(log.every((l) => !l.includes("6285200000008")), "log tidak memuat nomor/pesan galat");
  } finally { console.warn = warn; prisma.attributionTouch.create = asli; }
});

test("constraint DB: Ad ID bukan digit, pemetaan tidak konsisten, tanggal WIB tidak cocok, sumber tak dikenal → ditolak", async () => {
  const c = await testPrisma.customer.findFirst({ select: { id: true } });
  const dasar = { customer_id: c.id, ad_id: AD3, touch_at: "2026-10-05T03:00:00Z", touch_date_wib: "2026-10-05", evidence_source: "CTWA_AD", source_type: "ad", mapping_status_at_touch: "UNMAPPED", customer_new_at_touch: true };
  const masuk = (o, key) => testPrisma.$executeRawUnsafe(
    `insert into attribution_touches (id, customer_id, ad_id, ad_set_id, campaign_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_new_at_touch, dedupe_key)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6::timestamp, $7::date, $8, $9, $10, $11)`,
    o.customer_id, o.ad_id, o.ad_set_id ?? null, o.campaign_id ?? null, o.mapping_status_at_touch, o.touch_at, o.touch_date_wib, o.evidence_source, o.source_type, o.customer_new_at_touch, key);
  await masuk(dasar, "uji:ok-1");                                                           // baris sah
  await assert.rejects(masuk({ ...dasar, ad_id: "abc12345" }, "uji:2"), /attribution_touches_ad_id_check/);
  await assert.rejects(masuk({ ...dasar, mapping_status_at_touch: "MAPPED" }, "uji:3"), /attribution_touches_mapping_check/);
  await assert.rejects(masuk({ ...dasar, touch_date_wib: "2026-10-06" }, "uji:4"), /attribution_touches_date_wib_check/);
  await assert.rejects(masuk({ ...dasar, evidence_source: "TEBAKAN_NAMA" }, "uji:5"), /attribution_touches_evidence_check/);
  await assert.rejects(masuk({ ...dasar, touch_at: "2026-10-05T18:00:00Z", touch_date_wib: "2026-10-05" }, "uji:6"), /attribution_touches_date_wib_check/, "18:00 UTC = 01:00 WIB hari berikutnya");
  await assert.rejects(masuk(dasar, "uji:ok-1"), /dedupe_key/);
  await testPrisma.attributionTouch.deleteMany({ where: { dedupeKey: "uji:ok-1" } });
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
      mappingStatusAtTouch: "UNMAPPED", evidenceSource: "CTWA_AD", sourceType: "ad", customerNewAtTouch: true, dedupeKey: `uji:${++urutanTouch}`, ...o,
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
  await sentuh(c7.id, AD1, "2026-10-05T03:00:00Z", { customerNewAtTouch: false });
  // C8: status LUNAS tetapi ledger hanya menutup Rp2 jt dari tagihan Rp2,2 jt (value + ongkir): KONFLIK
  const c8 = await cust("6285300000008", "2026-10-05T03:00:00Z");
  const o8 = await order(c8.id, "2026-10-06T03:00:00Z", M(2), { ongkir: 200_000, paymentStatus: "LUNAS", paidAt: T("2026-10-06T05:00:00Z") });
  await bayar(o8.id, "2026-10-06T05:00:00Z", M(2));
  await sentuh(c8.id, AD3, "2026-10-05T03:01:00Z");
  // C9: multi-touch: akuisisi AD2 lebih dulu; touch AD1 sesudahnya (customer sudah lama) → hanya touch berikutnya
  const c9 = await cust("6285300000009", "2026-10-07T03:00:00Z");
  await sentuh(c9.id, AD2, "2026-10-07T03:01:00Z");
  await sentuh(c9.id, AD1, "2026-10-08T03:00:00Z", { customerNewAtTouch: false });
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

  const g2 = kunci(j, CAMP2);       // C8
  assert.equal(g2.lead.unik, 1);
  assert.equal(g2.lunasMenurutCrm.jumlah, 1, "konflik tetap lunas menurut CRM");
  assert.equal(g2.lunasTerbuktiLedger.jumlah, 0, "tetapi bukan lunas terbukti ledger");
  assert.equal(g2.buktiPelunasan.konflikLunasTersimpanLedgerTidakCukup, 1);
  assert.equal(g2.buktiPelunasan.kekuranganRupiahKonflik, 200_000);
  assert.equal(g2.uangLedger, M(2));
  assert.equal(g2.bookedValue, M(2), "booked = Order.value (tanpa ongkir)");

  const u = kunci(j, "UNMAPPED");   // C4
  assert.deepEqual([u.lead.unik, u.status, u.campaign, u.adSet], [1, "UNMAPPED", null, null]);
  assert.deepEqual(j.tidakTerpetakan.adIds.map((x) => x.adId), [AD9]);

  // multi-touch & customer lama: touch berikutnya terpisah, lead tidak berpindah
  assert.deepEqual(g1.sentuhanBerikutnya, { touch: 2, customerUnik: 2, padaCustomerBaru: 0, padaCustomerLama: 2 }, "C7 (lama) dan C9 (touch kedua)");
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

test("sinyal: AD_REPLY_UNMARKED direkam tetapi hanya masuk laporan bila sinyal=SEMUA", async () => {
  const c = await testPrisma.customer.create({ data: { name: "Pelanggan Uji", phone: "6285300000099", createdAt: T("2026-10-08T03:00:00Z"), leadSource: "META_ADS" } });
  await testPrisma.attributionTouch.create({ data: {
    customerId: c.id, adId: AD3, touchAt: T("2026-10-08T03:01:00Z"), touchDateWib: T("2026-10-08T00:00:00Z"), mappingStatusAtTouch: "UNMAPPED",
    evidenceSource: "AD_REPLY_UNMARKED", sourceType: "ad", customerNewAtTouch: true, dedupeKey: "uji:unmarked-1",
  } });
  const biasa = await api("GET", `/?${P}&level=campaign`);
  const semua = await api("GET", `/?${P}&level=campaign&sinyal=SEMUA`);
  assert.equal(semua.json.jumlahTeratribusi.leadUnik - biasa.json.jumlahTeratribusi.leadUnik, 1);
  assert.equal(biasa.json.atribusi.sinyalDipakai.join(), "CTWA_AD");
  assert.equal(semua.json.rekonsiliasi.ok, true);
});
