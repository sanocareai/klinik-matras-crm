// Unit: penulisan touch ATOMIK bersama Message (touchCapture.simpanPesanDenganTouch) dengan db palsu yang merekam urutan statement,
// serta tabel keputusan STATUS CUSTOMER (NEW / EXISTING / UNKNOWN) dari bukti kausal.
import test from "node:test";
import assert from "node:assert/strict";

process.env.CTWA_CAPTURE_HASH_SALT = "salt-unit-atomik-0123456789abcdef";
const T = await import("../src/services/attribution/touchCapture.js");
const { siapkanTouch, simpanPesanDenganTouch, tentukanStatusCustomer, _getTouchStats, _resetTouchStats, TOLERANSI_CREATED_AT_MS } = T;

const AD = "52694481763484";
const CLID = "AfhKBK8ZBWyKw3p49jW-KFh_rNlyzXmCKW0eSdHULJZtXqZk";
const EXT = "false_6285100000001@c.us_3EB0UNITATOM01";
const payload = (o = {}) => ({
  id: EXT,
  _data: { Message: { extendedTextMessage: { text: "x", contextInfo: {
    conversionSource: "FB_Ads", entryPointConversionSource: "ctwa_ad", entryPointConversionApp: "instagram",
    externalAdReply: { sourceID: o.ad ?? AD, sourceType: o.sourceType ?? "ad", sourceURL: "https://www.instagram.com/p/XYZ/", ctwaClid: o.clid === undefined ? CLID : o.clid },
  } } } },
});
const dapat = (o) => siapkanTouch({ payload: payload(o), event: "message", engine: "GOWS", externalId: EXT });
const nyala = async (fn) => { process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true"; try { return await fn(); } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; } };

/** db palsu: mencatat urutan panggilan; opsi gagal per langkah. */
function fakeDb(o = {}) {
  const log = [];
  const msg = { id: "m1", createdAt: new Date("2026-10-13T03:00:00Z") };
  const buat = (nama, fn) => async (...a) => { log.push(nama); return fn ? fn(...a) : undefined; };
  const klien = (tx) => ({
    $queryRaw: buat("kunci-customer", async () => { if (o.gagalKunci) throw new Error("kunci gagal"); return []; }),
    $executeRawUnsafe: async (sql) => { log.push(sql); if (o.gagalSavepoint && /^SAVEPOINT/.test(sql)) throw new Error("savepoint rusak"); if (o.gagalRollbackSavepoint && /^ROLLBACK TO/.test(sql)) throw new Error("rollback rusak"); },
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
const SEKARANG = new Date("2026-10-13T03:00:00Z");
const cust = (o = {}) => ({ id: "c1", createdAt: new Date(SEKARANG.getTime() - 500), ctwaClid: null, ...o });
const buatPesan = (c) => c.message.create({});
const simpan = (db, o = {}) => simpanPesanDenganTouch(db, { rencana: o.rencana === undefined ? dapat() : o.rencana, buatPesan, customer: o.customer ?? cust(), customerSudahAda: o.sudahAda ?? false, mulaiProses: o.mulai ?? new Date(SEKARANG.getTime() - 1000), tunggu: o.tunggu });

test("tanpa rencana: tidak ada transaksi (jalur lama persis)", async () => {
  _resetTouchStats();
  const { db, log } = fakeDb();
  const r = await simpan(db, { rencana: null });
  assert.deepEqual(baris(log), ["message.create"]);
  assert.equal(r.touch.status, "TANPA_TOUCH");
});

test("flag MATI atau sinyal bukan iklan → siapkanTouch null; flag NYALA + sinyal valid → rencana (clid mentah hanya di memori)", async () => {
  delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED;
  assert.equal(dapat(), null);
  await nyala(async () => {
    const r = dapat();
    assert.equal(r.touch.adId, AD);
    assert.equal(r.clidPayload, CLID);
    assert.ok(!JSON.stringify(r.touch).includes(CLID), "baris touch tidak memuat clid mentah");
    assert.equal(dapat({ sourceType: "post" }), null);
    assert.equal(siapkanTouch({ payload: { id: "x" }, event: "message", engine: "GOWS", externalId: "false_a@c.us_3EB0Y" }), null);
  });
});

test("urutan atomik: kunci customer → hitung pesan → Message → SAVEPOINT → referensi → touch → RELEASE → commit", async () => {
  await nyala(async () => {
    _resetTouchStats();
    const { db, log } = fakeDb({ ref: { adSetId: "52694481763284", campaignId: "52694481763084" } });
    const r = await simpan(db);
    assert.deepEqual(baris(log), ["TX:mulai", "kunci-customer", "message.count", "message.create", "SAVEPOINT atribusi_touch", "ref.find", "touch.create", "RELEASE SAVEPOINT atribusi_touch", "TX:commit"]);
    assert.equal(r.touch.status, "REKAM");
    const d = data(log);
    assert.deepEqual([d.customerId, d.messageId, d.adId, d.adSetId, d.campaignId, d.mappingStatusAtTouch, d.customerStatusAtTouch, d.customerBasisAtTouch],
      ["c1", "m1", AD, "52694481763284", "52694481763084", "MAPPED", "NEW", "WEBHOOK_MEMBUAT"]);
    assert.equal(_getTouchStats().direkam, 1);
    assert.equal(_getTouchStats().statusNew, 1);
  });
});

test("insert touch ditolak DB → ROLLBACK TO SAVEPOINT, Message TETAP commit; tidak ada fallback; gagal tercatat", async () => {
  await nyala(async () => {
    _resetTouchStats();
    const { db, log } = fakeDb({ touchGagal: "23514" });
    const r = await simpan(db);
    assert.ok(baris(log).includes("ROLLBACK TO SAVEPOINT atribusi_touch"));
    assert.equal(baris(log).at(-1), "TX:commit");
    assert.equal(r.message.id, "m1");
    assert.equal(r.touch.status, "GAGAL");
    const s = _getTouchStats();
    assert.deepEqual([s.gagal, s.fallbackTransaksi], [1, 0]);
  });
});

test("kunci dedupe sudah ada (P2002 pada touch) → DUPLIKAT, Message commit, tidak dihitung gagal", async () => {
  await nyala(async () => {
    _resetTouchStats();
    const r = await simpan(fakeDb({ touchGagal: "P2002" }).db);
    assert.equal(r.touch.status, "DUPLIKAT");
    assert.deepEqual([_getTouchStats().gagal, _getTouchStats().duplikat], [0, 1]);
  });
});

test("P2002 dari PESAN dilempar apa adanya (pemanggil → skip-dupe); tidak ada fallback, tidak ada touch", async () => {
  await nyala(async () => {
    _resetTouchStats();
    const { db, log } = fakeDb({ pesanGagal: "P2002" });
    await assert.rejects(simpan(db), (e) => e.code === "P2002");
    assert.ok(!baris(log).includes("touch.create"));
    assert.equal(_getTouchStats().fallbackTransaksi, 0);
  });
});

test("SAVEPOINT tak bisa dipakai (transaksi rusak) → fallback: pesan dibuat TANPA transaksi, touch dipulihkan sekali (di-await di tes)", async () => {
  await nyala(async () => {
    _resetTouchStats();
    const { db, log } = fakeDb({ gagalSavepoint: true });
    const r = await simpan(db, { tunggu: true });
    assert.equal(r.message.id, "m1");
    assert.equal(r.touch.status, "DIPULIHKAN");
    const s = _getTouchStats();
    assert.deepEqual([s.fallbackTransaksi, s.dipulihkan, s.gagalPulih, s.tertunda], [1, 1, 0, 0]);
    assert.ok(!baris(log).includes("TX:commit"));
  });
});

test("kunci customer gagal (transaksi tak sehat) → fallback, bukan galat ke webhook", async () => {
  await nyala(async () => {
    _resetTouchStats();
    const r = await simpan(fakeDb({ gagalKunci: true }).db, { tunggu: true });
    assert.equal(r.message.id, "m1");
    assert.equal(_getTouchStats().fallbackTransaksi, 1);
    assert.equal(r.touch.status, "DIPULIHKAN");
  });
});

test("transaksi P2028/P2034 → fallback; percobaan susulan gagal → gagalPulih; tetap tidak melempar", async () => {
  await nyala(async () => {
    for (const kode of ["P2028", "P2034"]) {
      _resetTouchStats();
      const r = await simpan(fakeDb({ txError: kode, touchGagal: "P1001" }).db, { tunggu: true });
      assert.equal(r.message.id, "m1");
      assert.equal(r.touch.status, "GAGAL");
      const s = _getTouchStats();
      assert.deepEqual([s.fallbackTransaksi, s.dipulihkan, s.gagalPulih, s.tertunda], [1, 0, 1, 0], kode);
    }
  });
});

test("galat transaksi lain (mis. koneksi putus) dilempar apa adanya — sama seperti Message.create lama", async () => {
  await nyala(async () => {
    await assert.rejects(simpan(fakeDb({ txError: "P1001" }).db), (e) => e.code === "P1001");
  });
});

// ── STATUS CUSTOMER: tabel keputusan dari bukti kausal ──────────────────────────────────────────────────────────────────────────
const status = (o) => tentukanStatusCustomer(
  { message: { count: async () => o.pesanSebelumnya ?? 0 } },
  { customer: o.customer ?? cust(), customerSudahAda: o.sudahAda ?? false, mulaiProses: o.mulai ?? new Date(SEKARANG.getTime() - 1000), clidPayload: o.clid ?? null });
const ringkas = (r) => `${r.status}/${r.basis}`;

test("STATUS: customer dibuat oleh webhook ini (tidak ada baris sebelum handler mulai, belum ada pesan) → NEW/WEBHOOK_MEMBUAT", async () => {
  assert.equal(ringkas(await status({ sudahAda: false })), "NEW/WEBHOOK_MEMBUAT");
});

test("STATUS: customer ada dan sudah punya pesan (inbound/outbound) → EXISTING/RIWAYAT_PESAN, termasuk webhook paralel yang menang lebih dulu", async () => {
  assert.equal(ringkas(await status({ sudahAda: true, pesanSebelumnya: 3 })), "EXISTING/RIWAYAT_PESAN");
  assert.equal(ringkas(await status({ sudahAda: false, pesanSebelumnya: 1 })), "EXISTING/RIWAYAT_PESAN");
});

test("STATUS: customer dibuat MANUAL sebelum pesan pertama (ada, tanpa pesan, tanpa clid) → UNKNOWN/TANPA_BUKTI — bukan NEW walau baru dibuat", async () => {
  assert.equal(ringkas(await status({ sudahAda: true, customer: cust({ createdAt: new Date(SEKARANG.getTime() - 5_000) }) })), "UNKNOWN/TANPA_BUKTI");
  assert.equal(ringkas(await status({ sudahAda: true, customer: cust({ ctwaClid: null }), clid: CLID })), "UNKNOWN/TANPA_BUKTI", "ada clid di payload tetapi customer tak punya clid tersimpan");
  assert.equal(ringkas(await status({ sudahAda: true, customer: cust({ ctwaClid: "clid-lain-yang-berbeda" }), clid: CLID })), "UNKNOWN/TANPA_BUKTI", "clid customer berbeda dari payload");
});

test("STATUS: customer sudah ada tanpa pesan TETAPI clid tersimpan = clid payload (retry sesudah proses mati) → NEW/CLID_COCOK", async () => {
  assert.equal(ringkas(await status({ sudahAda: true, customer: cust({ ctwaClid: CLID }), clid: CLID })), "NEW/CLID_COCOK");
});

test("STATUS: clid cocok TIDAK cukup bila customer sudah punya pesan → EXISTING (urutan bukti: riwayat dulu)", async () => {
  assert.equal(ringkas(await status({ sudahAda: true, pesanSebelumnya: 2, customer: cust({ ctwaClid: CLID }), clid: CLID })), "EXISTING/RIWAYAT_PESAN");
});

test("STATUS: 'baru' tetapi createdAt jauh sebelum handler mulai / tanpa createdAt / penghitungan galat → UNKNOWN/TIDAK_KONSISTEN (tidak mengarang NEW)", async () => {
  const lama = cust({ createdAt: new Date(SEKARANG.getTime() - TOLERANSI_CREATED_AT_MS - 5_000 - 1000) });
  assert.equal(ringkas(await status({ sudahAda: false, customer: lama })), "UNKNOWN/TIDAK_KONSISTEN");
  assert.equal(ringkas(await status({ sudahAda: false, customer: cust({ createdAt: undefined }) })), "UNKNOWN/TIDAK_KONSISTEN");
  const r = await tentukanStatusCustomer({ message: { count: async () => { throw new Error("db"); } } }, { customer: cust(), customerSudahAda: false, mulaiProses: SEKARANG });
  assert.equal(ringkas(r), "UNKNOWN/TIDAK_KONSISTEN");
});

test("STATUS ikut tertulis pada touch dan terhitung per status; jumlah touch TIDAK berubah oleh status", async () => {
  await nyala(async () => {
    _resetTouchStats();
    const kasus = [
      [{ sudahAda: false }, "NEW"], [{ sudahAda: true, pesanSebelumnya: 2 }, "EXISTING"], [{ sudahAda: true }, "UNKNOWN"],
      [{ sudahAda: true, customer: cust({ ctwaClid: CLID }) }, "NEW"],
    ];
    for (const [o, st] of kasus) {
      const { db, log } = fakeDb({ pesanSebelumnya: o.pesanSebelumnya });
      const r = await simpan(db, o);
      assert.equal(r.touch.status, "REKAM");
      assert.equal(data(log).customerStatusAtTouch, st);
    }
    const s = _getTouchStats();
    assert.deepEqual([s.direkam, s.statusNew, s.statusExisting, s.statusUnknown], [4, 2, 1, 1]);
  });
});
