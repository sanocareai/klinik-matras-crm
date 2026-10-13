// Tes unit Fase 2 atribusi: penangkapan touch (murni + penulis dengan db palsu) dan referensi/impor pemetaan Ad ID. Tanpa DB.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { bangunTouch, siapkanTouch, simpanPesanDenganTouch, kunciDedupe, _getTouchStats, _resetTouchStats } from "../src/services/attribution/touchCapture.js";
import { buildObservation } from "../src/services/ctwaCapture.js";
import { barisDariCsv, rencanaImpor, validasiBaris, jalankanImpor, parseCsv } from "../src/services/attribution/adReferensi.js";
import { ENAM_PEMETAAN, csvAdsManager, barisJson } from "./fixtures/metaAdsFixture.js";

const SALT = "salt-uji-atribusi-0123456789abcdef";
const CLID = "AfhKBK8ZBWyKw3p49jW-KFh_rNlyzXmCKW0eSdHULJZtXqZk";
const TEKS = "keluhan pinggang rahasia canary";
const NAMA = "Budi Canary Santoso";
const PHONE = "6285100000009";

function payload({ msgId = "3EB0UNIT0001", ad = "52694481763484", sourceType = "ad", clid = CLID, penanda = true, url = "https://www.instagram.com/p/DcgquCfg3_4/", tanpaEar = false, phone = PHONE } = {}) {
  const ear = tanpaEar ? undefined : {
    sourceURL: url, ...(ad !== null ? { sourceID: ad } : {}), ...(sourceType !== null ? { sourceType } : {}), ...(clid ? { ctwaClid: clid } : {}),
  };
  return {
    id: `false_${phone}@c.us_${msgId}`, from: `${phone}@c.us`, fromMe: false, body: TEKS, hasMedia: false, timestamp: Math.floor(Date.now() / 1000),
    _data: {
      Info: { Chat: `${phone}@c.us`, Sender: `${phone}@c.us`, PushName: NAMA, Type: "text" },
      Message: { extendedTextMessage: { text: TEKS, contextInfo: {
        ...(penanda ? { conversionSource: "FB_Ads", entryPointConversionSource: "ctwa_ad", entryPointConversionApp: "instagram" } : {}),
        ...(ear ? { externalAdReply: ear } : {}),
      } } },
    },
  };
}

// ── bangunTouch ────────────────────────────────────────────────────────────────────────────────────────────────────────
test("touch valid: Ad ID = sourceID persis sebagai STRING; bukan dari URL; clid hanya hash 16 hex yang SAMA dengan hash capture Fase 0", () => {
  const p = payload();
  const b = bangunTouch(p, { externalId: p.id, event: "message", engine: "GOWS", salt: SALT });
  assert.equal(b.valid, true);
  assert.equal(b.touch.adId, "52694481763484");
  assert.equal(typeof b.touch.adId, "string");
  assert.equal(b.touch.evidenceSource, "CTWA_AD");
  assert.ok(!("customerNewAtTouch" in b.touch) && !("customerStatusAtTouch" in b.touch), "status customer BUKAN urusan builder: ditentukan dari bukti kausal saat penyimpanan");
  assert.equal(b.touch.entryPointApp, "instagram");
  assert.match(b.touch.ctwaClidHash, /^[0-9a-f]{16}$/);
  const obs = buildObservation(p, { event: "message", engine: "GOWS", externalId: p.id, salt: SALT });
  assert.equal(b.touch.ctwaClidHash, obs.ctwaClid.hash, "hash dapat dijoin dengan JSONL Fase 0");
  const teks = JSON.stringify(b.touch);
  for (const s of [CLID, TEKS, NAMA, PHONE, "@c.us", "instagram.com", "DcgquCfg3_4"]) assert.ok(!teks.includes(s), `bocor di touch: ${s}`);
});

test("tanpa salt valid: touch tetap valid tetapi hash clid null (tidak pernah menyimpan clid, tidak memakai salt tebakan)", () => {
  const p = payload();
  const b = bangunTouch(p, { externalId: p.id, salt: null });
  assert.equal(b.valid, true);
  assert.equal(b.touch.ctwaClidHash, null);
});

test("Ad ID TIDAK PERNAH disimpulkan dari URL postingan: tanpa sourceID = bukan touch", () => {
  const p = payload({ ad: null });
  const b = bangunTouch(p, { externalId: p.id, salt: SALT });
  assert.deepEqual([b.valid, b.alasan], [false, "TANPA_SOURCE_ID"]);
});

test("sourceID bukan digit / sourceType bukan ad / bukan sinyal iklan / tanpa id pesan → ditolak dengan alasan", () => {
  const alasan = (p, ext = p.id) => bangunTouch(p, { externalId: ext, salt: SALT }).alasan;
  assert.equal(alasan(payload({ ad: "act_12345678" })), "TANPA_SOURCE_ID");
  assert.equal(alasan(payload({ ad: "1.2E+13" })), "TANPA_SOURCE_ID");
  assert.equal(alasan(payload({ sourceType: "post" })), "SOURCE_TYPE_BUKAN_AD");
  assert.equal(alasan(payload({ sourceType: null })), "SOURCE_TYPE_BUKAN_AD");
  assert.equal(alasan(payload({ ad: "123" })), "SOURCE_ID_BENTUK_TIDAK_VALID");
  assert.equal(alasan(payload({ tanpaEar: true, penanda: false })), "BUKAN_SINYAL_IKLAN");
  assert.equal(alasan(payload(), ""), "TANPA_ID_PESAN");
});

test("AD_REPLY_UNMARKED (balasan iklan tanpa clid/penanda) valid dengan evidenceSource sendiri", () => {
  const p = payload({ penanda: false, clid: null, url: "https://wa.me/wamo/xyz" });
  const b = bangunTouch(p, { externalId: p.id, salt: SALT });
  assert.equal(b.valid, true);
  assert.equal(b.touch.evidenceSource, "AD_REPLY_UNMARKED");
});

test("kunci dedupe: event message dan message.any, bentuk ID berbeda, dan retry = kunci SAMA; pesan lain beda", () => {
  const inti = "3EB0DEDUPE0001";
  const a = kunciDedupe(`false_${PHONE}@c.us_${inti}`);
  const b = kunciDedupe(`false_${PHONE}@c.us_${inti}_6285999@c.us`);
  assert.equal(a, b);
  assert.notEqual(a, kunciDedupe(`false_${PHONE}@c.us_3EB0DEDUPE0002`));
  assert.match(a, /^msg:[0-9a-f]{40}$/);
  assert.equal(kunciDedupe(""), null);
  assert.ok(!a.includes(inti), "ID pesan tidak disimpan polos");
});

// ── penyimpanan touch (simpanPesanDenganTouch) dengan db palsu ──────────────────────────────────────────────────────────────
function dbPalsu({ ref = null, createError = null } = {}) {
  const dibuat = [];
  const klien = () => ({
    $queryRaw: async () => [],
    $executeRawUnsafe: async () => {},
    message: { count: async () => 0, create: async () => ({ id: "msg-1", createdAt: dbPalsu.waktu }) },
    metaAdReference: { findUnique: async ({ where }) => (ref && ref.adId === where.adId ? ref : null) },
    attributionTouch: { create: async ({ data }) => { if (createError) throw createError; dibuat.push(data); return data; } },
  });
  return { dibuat, ...klien(), $transaction: async (fn) => fn(klien()) };
}
dbPalsu.waktu = new Date("2026-10-12T05:00:00Z");
const buatPesan = (c) => c.message.create({});
const jalan = (db, o = {}, rencana) => simpanPesanDenganTouch(db, { rencana: rencana ?? siapkanTouch({ payload: payload(o), event: "message", engine: "GOWS", externalId: payload(o).id }), buatPesan, customer: { id: "cust-1", createdAt: new Date() }, customerSudahAda: false, mulaiProses: new Date(Date.now() - 1000), tunggu: true });

test("flag MATI (default; hanya persis \"true\" menyalakan) → siapkanTouch null, DB tidak disentuh untuk touch", async () => {
  delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED;
  const db = dbPalsu();
  assert.equal(siapkanTouch({ payload: payload(), event: "message", engine: "GOWS", externalId: payload().id }), null);
  const r = await jalan(db, {}, null);
  assert.equal(r.touch.status, "TANPA_TOUCH");
  assert.equal(db.dibuat.length, 0);
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "TRUE";
  assert.equal(siapkanTouch({ payload: payload(), event: "message", engine: "GOWS", externalId: payload().id }), null);
  delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED;
});

test("terpetakan → snapshot ad set/campaign; tidak terpetakan → null + UNMAPPED; hari WIB eksplisit (18:00 UTC = hari berikutnya)", async () => {
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  process.env.CTWA_CAPTURE_HASH_SALT = SALT;
  _resetTouchStats();
  try {
    const db1 = dbPalsu({ ref: { adId: "52694481763484", adSetId: "52694481763284", campaignId: "52694481763084" } });
    const r1 = await jalan(db1);
    assert.equal(r1.touch.status, "REKAM");
    assert.deepEqual([db1.dibuat[0].adSetId, db1.dibuat[0].campaignId, db1.dibuat[0].mappingStatusAtTouch], ["52694481763284", "52694481763084", "MAPPED"]);
    assert.equal(db1.dibuat[0].touchDateWib.toISOString(), "2026-10-12T00:00:00.000Z");
    const db2 = dbPalsu();
    await jalan(db2, { ad: "52699999999999" });
    assert.deepEqual([db2.dibuat[0].adSetId, db2.dibuat[0].campaignId, db2.dibuat[0].mappingStatusAtTouch], [null, null, "UNMAPPED"]);
    const db3 = dbPalsu();
    dbPalsu.waktu = new Date("2026-10-12T18:00:00Z");
    await jalan(db3);
    dbPalsu.waktu = new Date("2026-10-12T05:00:00Z");
    assert.equal(db3.dibuat[0].touchDateWib.toISOString(), "2026-10-13T00:00:00.000Z");
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; }
});

test("duplikat (P2002) → DUPLIKAT; galat DB → GAGAL tanpa melempar dan tanpa pesan galat di log; bukan touch → tidak ada rencana", async () => {
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  _resetTouchStats();
  try {
    const dup = Object.assign(new Error("Unique constraint failed on dedupe_key"), { code: "P2002" });
    assert.equal((await jalan(dbPalsu({ createError: dup }))).touch.status, "DUPLIKAT");
    const boom = Object.assign(new Error("connection reset NOMOR 6285100000009"), { code: "P1001" });
    const warn = console.warn; const baris = []; console.warn = (...a) => baris.push(a.join(" "));
    try { assert.equal((await jalan(dbPalsu({ createError: boom }))).touch.status, "GAGAL"); } finally { console.warn = warn; }
    assert.ok(baris.every((l) => !l.includes("6285100000009")), "pesan error tidak boleh masuk log");
    assert.match(baris.join(" | "), /atribusi-touch.*P1001/);
    assert.equal(siapkanTouch({ payload: payload({ ad: null }), event: "message", engine: "GOWS", externalId: payload().id }), null);
    const st = _getTouchStats();
    assert.deepEqual([st.duplikat, st.gagal, st.bukanTouch], [1, 1, 1]);
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; }
});

// ── referensi / impor ──────────────────────────────────────────────────────────────────────────────────────────────────────
test("parse CSV: kolom Inggris/Indonesia, pemisah ; atau TAB, BOM, kutip berisi koma", () => {
  const a = barisDariCsv(csvAdsManager(ENAM_PEMETAAN, { bom: true }));
  assert.equal(a.galat, null);
  assert.equal(a.baris.length, 6);
  assert.equal(a.baris[0].adId, "52694481763484");
  assert.equal(a.baris[0].campaignName, "Jabo IG Oktober");
  const b = barisDariCsv(csvAdsManager(ENAM_PEMETAAN, { pemisah: ";" }));
  assert.equal(b.baris.length, 6);
  const c = barisDariCsv(csvAdsManager(ENAM_PEMETAAN, { pemisah: "\t" }));
  assert.equal(c.baris[5].adSetId, "52694481763284");
  const id = barisDariCsv('ID iklan,ID set iklan,ID kampanye,Nama kampanye\n52694481763484,52694481763284,52694481763084,"Promo, Oktober ""baru"""\n');
  assert.equal(id.baris[0].campaignName, 'Promo, Oktober "baru"');
  assert.equal(barisDariCsv("Ad ID,Nama\n123,x\n").galat, "KOLOM_WAJIB_HILANG:adSetId");
  assert.equal(barisDariCsv("").galat, "BERKAS_KOSONG");
  assert.equal(parseCsv("a,b\n1,2\n\n3,4").length, 3);
});

test("validasi: notasi ilmiah/desimal/bukan digit/ID bertingkat sama ditolak; ID tetap string; nama dibersihkan", () => {
  const ok = validasiBaris({ adId: " 52694481763484 ", adSetId: "52694481763284", campaignId: "52694481763084", adName: "  Teardown\tUntuk   Ibu\u0000 " });
  assert.equal(ok.ok, true);
  assert.equal(ok.ref.adName, "Teardown Untuk Ibu");
  const alasan = (b) => validasiBaris({ adSetId: "52694481763284", campaignId: "52694481763084", adId: "52694481763484", ...b }).alasan;
  assert.equal(alasan({ adId: "5.2694481763484E+13" }), "AD_ID_NOTASI_ILMIAH_ATAU_DESIMAL");
  assert.equal(alasan({ adId: "5269448176348.4" }), "AD_ID_NOTASI_ILMIAH_ATAU_DESIMAL");
  assert.equal(alasan({ adId: "ad_526944" }), "AD_ID_BUKAN_ID_DIGIT");
  assert.equal(alasan({ adId: "" }), "AD_ID_KOSONG");
  assert.equal(alasan({ campaignId: "" }), "CAMPAIGN_ID_KOSONG");
  assert.equal(alasan({ adSetId: "52694481763484" }), "ID_BERTINGKAT_SAMA");
  assert.equal(alasan({ adId: "12" }), "AD_ID_BUKAN_ID_DIGIT");
});

test("rencana impor: enam pemetaan fixture → 6 baru; dua iklan berbagi ad set/campaign yang sama konsisten", () => {
  const r = rencanaImpor(barisJson(), new Map());
  assert.equal(r.baru.length, 6);
  assert.equal(r.ditolak.length + r.konflik.length, 0);
  const sama = r.baru.filter((x) => x.adSetId === "52694481763284").map((x) => x.adId).sort();
  assert.deepEqual(sama, ["52694481763484", "52694485574084"]);
});

test("rencana impor: tidak berubah / nama berubah / orang tua berbeda = KONFLIK kecuali izinkanKoreksi / duplikat bertentangan / ad set di dua campaign", () => {
  const ada = new Map(ENAM_PEMETAAN.map((r) => [r.adId, { ...r }]));
  const sama = rencanaImpor(barisJson(), ada);
  assert.equal(sama.sama.length, 6);
  const nama = rencanaImpor([{ ...ENAM_PEMETAAN[0], campaignName: "Jabo IG Oktober v2" }], ada);
  assert.equal(nama.berubahNama.length, 1);
  const pindah = { ...ENAM_PEMETAAN[2], campaignId: "52690000000001" };
  const k = rencanaImpor([pindah], ada);
  assert.deepEqual(k.konflik.map((x) => x.alasan), ["AD_SET_SUDAH_DI_CAMPAIGN_LAIN"]);
  const pindahAdSet = { ...ENAM_PEMETAAN[2], adSetId: "52696131903999" };   // ad set baru, campaign sama → orang tua berbeda
  assert.deepEqual(rencanaImpor([pindahAdSet], ada).konflik.map((x) => x.alasan), ["ORANG_TUA_BERBEDA_DARI_REFERENSI"]);
  const koreksi = rencanaImpor([pindah], ada, { izinkanKoreksi: true });
  assert.equal(koreksi.koreksi.length, 1);
  assert.deepEqual(koreksi.koreksi[0].sebelumnya, { adSetId: "52696131903484", campaignId: "52696131903884" });
  const dup = rencanaImpor([ENAM_PEMETAAN[0], { ...ENAM_PEMETAAN[0], campaignId: "52690000000002" }], new Map());
  assert.equal(dup.ditolak.filter((x) => x.alasan === "DUPLIKAT_BERTENTANGAN").length, 2);
  const duaCamp = rencanaImpor([
    { adId: "52694400000001", adSetId: "52694400000100", campaignId: "52694400009001" },
    { adId: "52694400000002", adSetId: "52694400000100", campaignId: "52694400009002" },
  ], new Map());
  assert.equal(duaCamp.ditolak.filter((x) => x.alasan === "AD_SET_DI_DUA_CAMPAIGN_DALAM_BERKAS").length, 2);
  const keAdSetLama = rencanaImpor([{ adId: "52694400000003", adSetId: "52694481763284", campaignId: "52694400009009" }], ada);
  assert.deepEqual(keAdSetLama.konflik.map((x) => x.alasan), ["AD_SET_SUDAH_DI_CAMPAIGN_LAIN"]);
});

test("jalankanImpor: dryRun default tidak menulis; MARKETING_API ditolak (tidak ada kredensial); maksimum baris; tulis dalam transaksi", async () => {
  const tulis = [];
  const db = {
    metaAdReference: {
      findMany: async () => [],
      upsert: async (a) => { tulis.push(["upsert", a.where.adId]); },
      updateMany: async () => {},
    },
    metaAdReferenceImport: { create: async ({ data }) => { tulis.push(["import", data.rowsNew]); return { id: "imp-1" }; } },
    $transaction: async (fn) => fn(db),
  };
  const dry = await jalankanImpor(db, { rows: barisJson() });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.ringkasan.baru, 6);
  assert.equal(tulis.length, 0);
  const nyata = await jalankanImpor(db, { rows: barisJson(), dryRun: false, userId: "u1" });
  assert.equal(nyata.importId, "imp-1");
  assert.equal(tulis.filter((x) => x[0] === "upsert").length, 6);
  await assert.rejects(jalankanImpor(db, { rows: barisJson(), sumber: "MARKETING_API", dryRun: false }), /kredensial/);
  await assert.rejects(jalankanImpor(db, { rows: [] }), /tidak ada baris/);
});

test("fixture: ID tidak pernah dipetakan dari kemiripan angka/nama — ad yang tidak ada di referensi tetap tak terpetakan", () => {
  const ada = new Map(ENAM_PEMETAAN.map((r) => [r.adId, r]));
  assert.equal(ada.has("52694481763485"), false);   // satu digit beda
  assert.equal(ada.has("52694481763284"), false);   // ad set ID bukan Ad ID
  assert.equal(crypto.createHash("sha256").update("x").digest("hex").length, 64);
});
