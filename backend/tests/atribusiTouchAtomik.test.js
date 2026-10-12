// Unit: penulisan touch ATOMIK bersama Message (touchCapture.simpanPesanDenganTouch) dengan db palsu yang merekam urutan statement.
import test from "node:test";
import assert from "node:assert/strict";

process.env.CTWA_CAPTURE_HASH_SALT = "salt-unit-atomik-0123456789abcdef";
const T = await import("../src/services/attribution/touchCapture.js");
const { siapkanTouch, simpanPesanDenganTouch, _getTouchStats, _resetTouchStats, JENDELA_CUSTOMER_BARU_MS } = T;

const AD = "52694481763484";
const payload = (o = {}) => ({
  id: "false_6285100000001@c.us_3EB0UNITATOM01",
  _data: { Message: { extendedTextMessage: { text: "x", contextInfo: {
    conversionSource: "FB_Ads", entryPointConversionSource: "ctwa_ad", entryPointConversionApp: "instagram",
    externalAdReply: { sourceID: o.ad ?? AD, sourceType: o.sourceType ?? "ad", sourceURL: "https://www.instagram.com/p/XYZ/" },
  } } } },
});
const dapat = () => siapkanTouch({ payload: payload(), event: "message", engine: "GOWS", externalId: "false_6285100000001@c.us_3EB0UNITATOM01" });

/** db palsu: mencatat urutan panggilan; opsi gagal per langkah. */
function fakeDb(o = {}) {
  const log = [];
  const msg = { id: "m1", createdAt: new Date("2026-10-13T03:00:00Z") };
  const buat = (nama, fn) => async (...a) => { log.push(nama); return fn ? fn(...a) : undefined; };
  const klien = (tx) => ({
    $executeRawUnsafe: buat(`raw:${tx ? "tx" : "db"}`, async (sql) => { log.push(sql); if (o.gagalSavepoint && /^SAVEPOINT/.test(sql)) throw new Error("savepoint rusak"); if (o.gagalRollbackSavepoint && /^ROLLBACK TO/.test(sql)) throw new Error("rollback rusak"); }),
    message: { create: buat("message.create", async () => { if (o.pesanGagal) throw Object.assign(new Error("dup"), { code: o.pesanGagal }); return msg; }), count: buat("message.count", async () => o.pesanSebelumnya ?? 0) },
    metaAdReference: { findUnique: buat("ref.find", async () => o.ref ?? null) },
    attributionTouch: { create: buat("touch.create", async (a) => { if (o.touchGagal) throw Object.assign(new Error("x"), { code: o.touchGagal }); log.push(a.data); }) },
  });
  const db = {
    ...klien(false),
    $transaction: async (fn) => {
      log.push("TX:mulai");
      if (o.txError) { log.push("TX:error"); throw Object.assign(new Error("tx"), { code: o.txError }); }
      const r = await fn(klien(true));
      log.push("TX:commit");
      return r;
    },
  };
  return { db, log, msg };
}
const baris = (log) => log.filter((x) => typeof x === "string");
const data = (log) => log.find((x) => x && typeof x === "object");
const cust = (o = {}) => ({ id: "c1", createdAt: new Date(), ...o });
const buatPesan = (c) => c.message.create({});

test("tanpa rencana: tidak ada transaksi (jalur lama persis)", async () => {
  _resetTouchStats();
  const { db, log } = fakeDb();
  const r = await simpanPesanDenganTouch(db, { rencana: null, buatPesan, customer: cust(), customerSudahAda: true });
  assert.deepEqual(baris(log), ["message.create"]);
  assert.equal(r.touch.status, "TANPA_TOUCH");
});

test("flag MATI atau sinyal bukan iklan → siapkanTouch null; flag NYALA + sinyal valid → rencana", () => {
  delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED;
  assert.equal(dapat(), null);
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  try {
    assert.equal(dapat().touch.adId, AD);
    assert.equal(siapkanTouch({ payload: payload({ sourceType: "post" }), event: "message", engine: "GOWS", externalId: "false_6285100000001@c.us_3EB0X" }), null);
    assert.equal(siapkanTouch({ payload: { id: "x" }, event: "message", engine: "GOWS", externalId: "false_a@c.us_3EB0Y" }), null);
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; }
});

test("urutan atomik: Message dibuat DI DALAM transaksi, lalu SAVEPOINT → baca referensi → insert touch → RELEASE → commit", async () => {
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  try {
    _resetTouchStats();
    const { db, log } = fakeDb({ ref: { adSetId: "52694481763284", campaignId: "52694481763084" } });
    const r = await simpanPesanDenganTouch(db, { rencana: dapat(), buatPesan, customer: cust(), customerSudahAda: false });
    assert.deepEqual(baris(log), ["TX:mulai", "message.create", "raw:tx", "SAVEPOINT atribusi_touch", "ref.find", "touch.create", "raw:tx", "RELEASE SAVEPOINT atribusi_touch", "TX:commit"]);
    assert.equal(r.touch.status, "REKAM");
    const d = data(log);
    assert.deepEqual([d.customerId, d.messageId, d.adId, d.adSetId, d.campaignId, d.mappingStatusAtTouch, d.customerNewAtTouch], ["c1", "m1", AD, "52694481763284", "52694481763084", "MAPPED", true]);
    assert.equal(_getTouchStats().direkam, 1);
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; }
});

test("insert touch ditolak DB → ROLLBACK TO SAVEPOINT, Message TETAP commit; tidak ada fallback; gagal tercatat", async () => {
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  try {
    _resetTouchStats();
    const { db, log } = fakeDb({ touchGagal: "23514" });
    const r = await simpanPesanDenganTouch(db, { rencana: dapat(), buatPesan, customer: cust(), customerSudahAda: false });
    assert.ok(baris(log).includes("ROLLBACK TO SAVEPOINT atribusi_touch"));
    assert.equal(baris(log).at(-1), "TX:commit");
    assert.equal(r.message.id, "m1");
    assert.equal(r.touch.status, "GAGAL");
    const s = _getTouchStats();
    assert.deepEqual([s.gagal, s.fallbackTransaksi], [1, 0]);
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; }
});

test("kunci dedupe sudah ada (P2002 pada touch) → DUPLIKAT, Message commit, tidak dihitung gagal", async () => {
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  try {
    _resetTouchStats();
    const { db } = fakeDb({ touchGagal: "P2002" });
    const r = await simpanPesanDenganTouch(db, { rencana: dapat(), buatPesan, customer: cust(), customerSudahAda: false });
    assert.equal(r.touch.status, "DUPLIKAT");
    assert.deepEqual([_getTouchStats().gagal, _getTouchStats().duplikat], [0, 1]);
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; }
});

test("P2002 dari PESAN dilempar apa adanya (pemanggil → skip-dupe); tidak ada fallback, tidak ada touch", async () => {
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  try {
    _resetTouchStats();
    const { db, log } = fakeDb({ pesanGagal: "P2002" });
    await assert.rejects(simpanPesanDenganTouch(db, { rencana: dapat(), buatPesan, customer: cust(), customerSudahAda: false }), (e) => e.code === "P2002");
    assert.ok(!baris(log).includes("touch.create"));
    assert.equal(_getTouchStats().fallbackTransaksi, 0);
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; }
});

test("SAVEPOINT tak bisa dipakai (transaksi rusak) → fallback: pesan dibuat TANPA transaksi, touch dipulihkan sekali (di-await di tes)", async () => {
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  try {
    _resetTouchStats();
    const { db, log } = fakeDb({ gagalSavepoint: true });
    const r = await simpanPesanDenganTouch(db, { rencana: dapat(), buatPesan, customer: cust(), customerSudahAda: false, tunggu: true });
    assert.equal(r.message.id, "m1");
    assert.equal(r.touch.status, "DIPULIHKAN");
    const s = _getTouchStats();
    assert.deepEqual([s.fallbackTransaksi, s.dipulihkan, s.gagalPulih, s.tertunda], [1, 1, 0, 0]);
    // pesan dibuat DUA kali di jalur db (sekali di tx yang dibatalkan, sekali di luar tx) — transaksi pertama tidak ter-commit
    assert.ok(!baris(log).includes("TX:commit"));
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; }
});

test("transaksi P2028/P2034 → fallback; percobaan susulan gagal → gagalPulih; tetap tidak melempar", async () => {
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  try {
    for (const kode of ["P2028", "P2034"]) {
      _resetTouchStats();
      const { db } = fakeDb({ txError: kode, touchGagal: "P1001" });
      const r = await simpanPesanDenganTouch(db, { rencana: dapat(), buatPesan, customer: cust(), customerSudahAda: false, tunggu: true });
      assert.equal(r.message.id, "m1");
      assert.equal(r.touch.status, "GAGAL");
      const s = _getTouchStats();
      assert.deepEqual([s.fallbackTransaksi, s.dipulihkan, s.gagalPulih, s.tertunda], [1, 0, 1, 0], kode);
    }
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; }
});

test("galat transaksi lain (mis. koneksi putus) dilempar apa adanya — sama seperti Message.create lama", async () => {
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  try {
    const { db } = fakeDb({ txError: "P1001" });
    await assert.rejects(simpanPesanDenganTouch(db, { rencana: dapat(), buatPesan, customer: cust(), customerSudahAda: false }), (e) => e.code === "P1001");
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; }
});

test("customerNewAtTouch: baru dibuat → true; ada, tanpa pesan, dibuat ≤ jendela → true; ada dengan pesan → false; lama → false", async () => {
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  try {
    const hasil = async (o, customer, sudahAda) => {
      const { db, log } = fakeDb(o);
      await simpanPesanDenganTouch(db, { rencana: dapat(), buatPesan, customer, customerSudahAda: sudahAda, sekarang: new Date("2026-10-13T03:00:00Z") });
      return data(log).customerNewAtTouch;
    };
    const baru = new Date("2026-10-13T02:30:00Z");
    assert.equal(await hasil({}, cust({ createdAt: baru }), false), true, "dibuat oleh pemrosesan ini");
    assert.equal(await hasil({ pesanSebelumnya: 0 }, cust({ createdAt: baru }), true), true, "terbentuk sebelum proses mati; belum punya pesan");
    assert.equal(await hasil({ pesanSebelumnya: 3 }, cust({ createdAt: baru }), true), false, "sudah punya riwayat pesan");
    assert.equal(await hasil({ pesanSebelumnya: 0 }, cust({ createdAt: new Date(new Date("2026-10-13T03:00:00Z").getTime() - JENDELA_CUSTOMER_BARU_MS - 1000) }), true), false, "dibuat di luar jendela");
    assert.equal(await hasil({ pesanSebelumnya: 0 }, cust({ createdAt: undefined }), true), false, "tanpa bukti waktu → bukan akuisisi");
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; }
});
