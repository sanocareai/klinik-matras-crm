// Resi Gabungan Fase 2: klasifikasi bundle lama (MURNI, tanpa DB) — aturan BISA / PERINGATAN / TIDAK_BISA dan agregatnya.
import test from "node:test";
import assert from "node:assert/strict";
import { klasifikasiBundle, agregatKlasifikasi, kelompokkanBundle, SQL_ANGGOTA_BUNDLE, SQL_ANGGOTA_BUNDLE_PRA_MIGRASI, ALASAN, KLAS } from "../src/services/resiBackfill.js";

const m = (o = {}) => ({ root_invoice_id: "r1", is_root: false, punya_anak: false, order_id: "o" + Math.random(), customer_id: "c1", status: "DELIVERED", alamat_fp: "a", alamat_ada: true, tanggal: "2026-09-04", harga: 100, ongkir: null, dp_target: null, group_id: null, payments: 0, units: 1, jobs: 1, ...o });
const bundle = (...a) => ({ rootInvoiceId: "r1", anggota: a });

test("BISA: dua order, customer/alamat/tanggal sama, tanpa ongkir/DP/pembatalan", () => {
  const h = klasifikasiBundle(bundle(m({ is_root: true, punya_anak: true }), m()));
  assert.equal(h.klas, KLAS.BISA);
  assert.deepEqual(h.alasan, []);
  assert.equal(h.ringkas.anggota, 2);
  assert.equal(h.ringkas.subtotal, 200);
});

test("PERINGATAN: alamat berbeda, tanggal berbeda, dibatalkan, ongkir tersebar, dpTarget parsial, alamat anchor kosong", () => {
  const root = (o) => m({ is_root: true, punya_anak: true, ...o });
  assert.deepEqual(klasifikasiBundle(bundle(root(), m({ alamat_fp: "b" }))).alasan, ["ALAMAT_BERBEDA"]);
  assert.deepEqual(klasifikasiBundle(bundle(root(), m({ tanggal: "2026-09-06" }))).alasan, ["TANGGAL_BERBEDA"]);
  assert.deepEqual(klasifikasiBundle(bundle(root(), m({ status: "CANCELLED" }))).alasan, ["ANGGOTA_DIBATALKAN"]);
  assert.deepEqual(klasifikasiBundle(bundle(root({ ongkir: 10 }), m({ ongkir: 20 }))).alasan, ["ONGKIR_TERSEBAR"]);
  assert.deepEqual(klasifikasiBundle(bundle(root({ dp_target: 5 }), m())).alasan, ["DP_TARGET_PARSIAL"]);
  const kosong = klasifikasiBundle(bundle(root({ alamat_ada: false }), m()));
  assert.ok(kosong.alasan.includes("ALAMAT_KOSONG_ANCHOR"));
  assert.equal(kosong.klas, KLAS.PERINGATAN);
  // ongkir hanya pada satu order bukan peringatan
  assert.equal(klasifikasiBundle(bundle(root({ ongkir: 10 }), m())).klas, KLAS.BISA);
});

test("TIDAK_BISA: customer campur, rantai, anggota kurang, tanpa/lebih dari satu anchor, order ganda — meski ada peringatan lain", () => {
  const root = (o) => m({ is_root: true, punya_anak: true, ...o });
  assert.ok(klasifikasiBundle(bundle(root(), m({ customer_id: "c2" }))).alasan.includes("CUSTOMER_CAMPUR"));
  assert.ok(klasifikasiBundle(bundle(root(), m({ punya_anak: true }))).alasan.includes("RANTAI_BUNDLE"));
  assert.ok(klasifikasiBundle(bundle(root())).alasan.includes("ANGGOTA_KURANG"));
  assert.ok(klasifikasiBundle(bundle(m(), m())).alasan.includes("ANCHOR_TIDAK_ADA"));
  assert.ok(klasifikasiBundle(bundle(root(), root())).alasan.includes("ANCHOR_JAMAK"));
  assert.ok(klasifikasiBundle(bundle(root({ order_id: "x" }), m({ order_id: "x" }))).alasan.includes("ORDER_GANDA"));
  const campurDanBatal = klasifikasiBundle(bundle(root(), m({ customer_id: "c2", status: "CANCELLED" })));
  assert.equal(campurDanBatal.klas, KLAS.TIDAK_BISA);
  for (const k of Object.keys(ALASAN)) assert.ok(ALASAN[k].teks.length > 5, "setiap alasan punya teks Indonesia");
});

test("SUDAH_ADA: bundle yang anggotanya sudah punya grup tidak diklasifikasi ulang sebagai BISA (idempotensi)", () => {
  const h = klasifikasiBundle(bundle(m({ is_root: true, punya_anak: true, group_id: "g1" }), m({ group_id: "g1" })));
  assert.equal(h.klas, KLAS.SUDAH_ADA);
});

test("Agregat tidak memuat data pribadi; SQL baca-saja tidak menulis dan tidak memilih nama/alamat/telepon customer", () => {
  const hasil = [klasifikasiBundle(bundle(m({ is_root: true }), m())), klasifikasiBundle(bundle(m({ is_root: true }), m({ alamat_fp: "z" })))];
  const ag = agregatKlasifikasi(hasil);
  assert.deepEqual(Object.keys(ag).sort(), ["anggota", "bundle", "perAlasan", "perKlas"]);
  assert.equal(ag.bundle, 2);
  for (const sql of [SQL_ANGGOTA_BUNDLE, SQL_ANGGOTA_BUNDLE_PRA_MIGRASI]) {
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate)\b/i);
    assert.doesNotMatch(sql, /o\.name|c\.name|phone/i);
    // alamat hanya boleh keluar sebagai sidik jari/penanda, tidak pernah teks mentah
    assert.match(sql, /as alamat_fp/);
    assert.doesNotMatch(sql, /as alamat\b|as delivery_address|as kota/i);
    assert.match(sql, /md5\(/);
  }
  assert.match(SQL_ANGGOTA_BUNDLE_PRA_MIGRASI, /null::text as group_id/);
  assert.equal(kelompokkanBundle([m({ root_invoice_id: "a" }), m({ root_invoice_id: "b" }), m({ root_invoice_id: "a" })]).length, 2);
});
