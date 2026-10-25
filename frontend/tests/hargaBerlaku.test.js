// HARGA BERLAKU (HPP operasional) — logika murni UI + kontrak pemisahan angka. Pola proyek: fungsi murni dites langsung, berkas JSX diperiksa lewat teks sumber.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bacaHarga, rp, rpNilai, periksaIsian, susunMasukan, dariInputLokal, keInputLokal, TEKS, GAP_TEKS, BASIS_TEKS } from "../src/features/warehouse/stok/hargaBerlakuLogic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

test("bacaHarga: id-ID dan titik desimal diterima; ambigu/nol/negatif ditolak (tidak ada Rp0 diam-diam)", () => {
  assert.equal(bacaHarga("6350"), "6350"); assert.equal(bacaHarga("6.350"), "6350"); assert.equal(bacaHarga("6.350,5"), "6350.5"); assert.equal(bacaHarga("36000,25"), "36000.25"); assert.equal(bacaHarga("Rp 36.000"), "36000"); assert.equal(bacaHarga("100.5"), "100.5");
  for (const salah of ["", "0", "0,0", "-5", "abc", "1.2.3", "12,34,5", null, undefined]) assert.equal(bacaHarga(salah), null, String(salah));
});
test("rp/rpNilai: tampil 4/2 desimal tanpa pembulatan diam-diam; kosong = em dash (bukan Rp0)", () => {
  assert.equal(rp(6350), "Rp6.350"); assert.equal(rp(6350.1234), "Rp6.350,1234"); assert.equal(rp(null), "—"); assert.equal(rpNilai(null), "—"); assert.equal(rpNilai(25400), "Rp25.400");
});
test("susunMasukan: satuan SELALU satuan stok; mode SEKARANG tidak mengirim waktu (server memakai waktu simpan); JADWAL/koreksi membawa waktu; catatan bukti kosong tidak dikirim", () => {
  const bahan = { id: "m1", satuan: "KG" };
  const m = susunMasukan({ bahan, harga: "36.000", mulaiLokal: "2026-10-30T00:00", alasan: "  alasan uji  ", catatanBukti: "   " });
  assert.equal(m.satuan, "KG"); assert.equal(m.hargaBaru, "36000"); assert.equal(m.alasan, "alasan uji"); assert.equal(m.catatanBukti, undefined); assert.equal("koreksiId" in m, false); assert.equal("berlakuMulai" in m, false, "SEKARANG = tanpa waktu (klien tidak pernah mengirim tanggal mundur)");
  const j = susunMasukan({ bahan, harga: "1", mode: "JADWAL", mulaiLokal: "2026-10-30T08:00", alasan: "xxxxx" }); assert.ok(j.berlakuMulai.endsWith("Z"));
  const k = susunMasukan({ bahan, harga: "1", mulaiLokal: "2026-10-20T00:00", alasan: "xxxxxxxxxx", koreksiId: "k1" }); assert.equal(k.koreksiId, "k1"); assert.ok(k.berlakuMulai);
});
test("periksaIsian: harga & alasan wajib; JADWAL harus masa depan; koreksi butuh alasan ≥10 dan waktu", () => {
  const nanti = new Date("2026-10-26T10:00:00Z");
  assert.deepEqual(Object.keys(periksaIsian({ harga: "", alasan: "x", sekarang: nanti })).sort(), ["alasan", "harga"]);
  assert.deepEqual(periksaIsian({ harga: "100", alasan: "alasan cukup", sekarang: nanti }), {});
  assert.ok(periksaIsian({ harga: "100", mode: "JADWAL", mulaiLokal: "", alasan: "alasan cukup", sekarang: nanti }).mulai);
  assert.match(periksaIsian({ harga: "100", mode: "JADWAL", mulaiLokal: "2026-10-01T00:00", alasan: "alasan cukup", sekarang: nanti }).mulai, /masa depan/);
  assert.deepEqual(periksaIsian({ harga: "100", mode: "JADWAL", mulaiLokal: "2030-10-01T00:00", alasan: "alasan cukup", sekarang: nanti }), {});
  assert.ok(periksaIsian({ harga: "100", koreksi: true, mulaiLokal: "2026-10-20T00:00", alasan: "pendek", sekarang: nanti }).alasan, "koreksi: min 10");
  assert.deepEqual(periksaIsian({ harga: "100", koreksi: true, mulaiLokal: "2026-10-20T00:00", alasan: "alasan cukup panjang", sekarang: nanti }), {}, "koreksi boleh waktu lampau");
});
test("waktu lokal ↔ ISO bolak-balik", () => { const l = keInputLokal(new Date("2026-10-30T01:30:00Z")); assert.match(l, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/); assert.equal(dariInputLokal(""), null); assert.equal(dariInputLokal("bukan"), null); });
test("teks pemisah: HPP operasional ≠ nilai buku ≠ HPP final Finance; aturan waktu pemakaian aktual", () => {
  assert.match(TEKS.bukan, /Bukan nilai buku dan bukan HPP final Finance/); assert.match(TEKS.finance, /biaya perolehan Persediaan Awal\/GR/); assert.match(TEKS.aturanWaktu, /waktu pemakaian aktual, bukan tanggal order dibuat/); assert.match(TEKS.belumBukti, /Belum didukung bukti/); assert.ok(GAP_TEKS.BELUM_ADA_HARGA_PADA_WAKTU_PEMAKAIAN.includes("tidak diberi harga rekaan"));
});
test("teks aturan baru: tanpa mundur, izin eksplisit, basis harga retur/waste", () => {
  assert.match(TEKS.aturanTanpaMundur, /tidak boleh mundur/); assert.match(TEKS.izinLihat, /Finance dan Owner/); assert.match(TEKS.izinLihat, /keputusan Owner/);
  assert.match(BASIS_TEKS.HARGA_ISSUE_ASAL, /bukan harga saat retur/); assert.match(BASIS_TEKS.WAKTU_WASTE, /saat waste dicatat/); assert.ok(GAP_TEKS.ISSUE_ASAL_BELUM_BERHARGA);
});
test("kontrak sumber: panel di drawer Stok; modal tampil di atas drawer (portalToBody); kartu jejak terpisah dari biaya persediaan Finance; satuan tidak dapat diganti", () => {
  assert.match(src("features/warehouse/components/ItemDetailDrawer.jsx"), /<HargaBerlakuPanel materialId=\{materialId\} \/>/);
  assert.match(src("features/warehouse/stok/UbahHargaModal.jsx"), /<Modal portalToBody open/); assert.match(src("features/warehouse/stok/PenerapanLamaModal.jsx"), /<Modal portalToBody open/);
  const modal = src("features/warehouse/stok/UbahHargaModal.jsx"); assert.match(modal, /data-testid="satuan-tetap"/); assert.doesNotMatch(modal, /<select/); assert.match(modal, /Idempotency|kunci\.current/); assert.match(modal, /hashPratinjau: pra\.hash/);
  const jejak = src("features/finance/JejakBiayaBahan.jsx"); assert.match(jejak, /HppOperasionalKartu/); assert.match(jejak, /Finance — biaya perolehan PSA\/GR/);
  assert.match(src("features/finance/HppOperasionalKartu.jsx"), /Belum ada/); assert.doesNotMatch(src("features/finance/HppOperasionalKartu.jsx"), /\|\| ?0\b/);
  const api = src("api.js"); for (const f of ["getHargaBerlaku", "pratinjauHargaBerlaku", "simpanHargaBerlaku", "ajukanPenerapanHarga", "setujuiPenerapanHarga"]) assert.match(api, new RegExp(f));
  assert.match(api, /simpanHargaBerlaku: \(data, key = mutationKey\("harga-berlaku"\)\)/);
});
