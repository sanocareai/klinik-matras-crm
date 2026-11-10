// HPP PER ORDER — aturan murni (jalur SO, status unit, sidik, dasar harga, identitas ganda, jembatan laba jurnal → hasil manajemen).
import test from "node:test";
import assert from "node:assert/strict";
import { tentukanJalur, statusUnitHpp, statusOrderHpp, sidikBaris, hasilManajemen, klasifikasiBarisJurnal, dasarHargaBiaya, pisahkanGanda, normalRujukan, sidikKandidat } from "../src/lib/domain/hppOrder.js";

const b = (id, status = "DIBEKUKAN", subtotal = 1000, sumber = "STOK") => ({ id, status, subtotal: status === "DIBEKUKAN" ? subtotal : null, sumber });

test("jalur: pada/sebelum SO → biaya tanpa stok; sesudah SO atau tanpa tautan → stok resmi", () => {
  assert.equal(tentukanJalur({ tanggal: "2026-11-03", soTanggal: "2026-11-04" }).key, "BIAYA_TANPA_STOK");
  assert.equal(tentukanJalur({ tanggal: "2026-11-04", soTanggal: "2026-11-04" }).key, "BIAYA_TANPA_STOK", "tanggal SAMA dengan SO dianggap tercakup SO");
  assert.equal(tentukanJalur({ tanggal: "2026-11-05", soTanggal: "2026-11-04" }).key, "STOK");
  assert.equal(tentukanJalur({ tanggal: "2026-11-01", soTanggal: null }).key, "STOK");
  assert.throws(() => tentukanJalur({ tanggal: "3 Nov" }));
});

test("ada pemakaian ≠ HPP lengkap: baris bernilai tanpa konfirmasi = SIAP_DIKONFIRMASI, bukan LENGKAP", () => {
  const s = statusUnitHpp({ baris: [b("m1"), b("m2")] });
  assert.equal(s.key, "SIAP_DIKONFIRMASI"); assert.equal(s.lengkap, false); assert.equal(s.nilaiLengkap, null); assert.equal(s.nilaiDiketahui, 2000);
});

test("status unit: urutan penghalang dan nilai kosong tetap null (bukan Rp0)", () => {
  const kosong = statusUnitHpp({});
  assert.equal(kosong.key, "BELUM_ADA_PEMAKAIAN"); assert.equal(kosong.nilaiDiketahui, null); assert.equal(kosong.nilaiLengkap, null);
  assert.equal(statusUnitHpp({ pernyataanTanpaBahan: true }).key, "TANPA_BAHAN_BARU");
  assert.equal(statusUnitHpp({ pernyataanTanpaBahan: true }).nilaiLengkap, 0, "pernyataan tanpa bahan baru = nol yang berbukti");
  assert.equal(statusUnitHpp({ pernyataanTanpaBahan: true, catatanTertahan: 1 }).key, "BELUM_LENGKAP", "pernyataan tidak menutupi catatan tertahan");
  const tanpaHarga = statusUnitHpp({ baris: [b("m1"), b("m2", "TANPA_HARGA")] });
  assert.equal(tanpaHarga.key, "BELUM_LENGKAP"); assert.equal(tanpaHarga.barisTanpaNilai, 1); assert.equal(tanpaHarga.nilaiDiketahui, 1000, "hanya bagian yang diketahui");
  assert.equal(statusUnitHpp({ baris: [b("m1"), b("e1", "PERLU_KEPUTUSAN", 0, "BIAYA_TANPA_STOK")] }).key, "BELUM_LENGKAP", "harga menunggu keputusan = biaya kosong");
  assert.equal(statusUnitHpp({ baris: [b("m1")], catatanTertahan: 3 }).key, "BELUM_LENGKAP", "catatan historis tertahan menahan kelengkapan");
  assert.equal(statusUnitHpp({ catatanTertahan: 2 }).key, "BELUM_LENGKAP", "catatan tertahan tanpa baris tetap bukan 'belum ada pemakaian'");
  assert.equal(statusUnitHpp({ baris: [b("m1")], biayaDiajukan: 1 }).key, "MENUNGGU_PERSETUJUAN");
  assert.equal(statusUnitHpp({ baris: [b("m1", "BELUM_DIBEKUKAN")], biayaDiajukan: 1 }).key, "BELUM_LENGKAP");
});

test("konfirmasi: LENGKAP hanya bila sidik sama; baris berubah sesudah konfirmasi → BASI", () => {
  const baris = [b("m1"), b("e1", "DIBEKUKAN", 500, "BIAYA_TANPA_STOK")];
  const sidik = sidikBaris(baris);
  const s = statusUnitHpp({ baris, konfirmasi: { sidik } });
  assert.equal(s.key, "LENGKAP"); assert.equal(s.lengkap, true); assert.equal(s.nilaiLengkap, 1500);
  assert.equal(statusUnitHpp({ baris: [...baris, b("m3")], konfirmasi: { sidik } }).key, "KONFIRMASI_BASI");
  assert.equal(statusUnitHpp({ baris: [b("m1", "DIBEKUKAN", 999), baris[1]], konfirmasi: { sidik } }).key, "KONFIRMASI_BASI", "nominal berubah → basi");
  assert.equal(sidikBaris([baris[1], baris[0]]), sidik, "urutan tidak berpengaruh");
});

test("status order: LENGKAP hanya bila semua unit lengkap; PARSIAL bila sebagian bernilai", () => {
  const L = statusUnitHpp({ baris: [b("a")], konfirmasi: { sidik: sidikBaris([b("a")]) } });
  const S = statusUnitHpp({ baris: [b("c")] });
  const K = statusUnitHpp({});
  assert.equal(statusOrderHpp([L]).key, "LENGKAP"); assert.equal(statusOrderHpp([L]).nilaiLengkap, 1000);
  assert.equal(statusOrderHpp([L, S]).key, "PARSIAL"); assert.equal(statusOrderHpp([L, S]).nilaiLengkap, null);
  assert.equal(statusOrderHpp([K]).key, "BELUM_DIKETAHUI"); assert.equal(statusOrderHpp([K]).nilaiDiketahui, null);
});

const ctx = (o = {}) => ({ unitDiakui: new Set(["uD"]), kelompokBernilai: new Map([["k-ok", true], ["k-part", false]]), batasSO: "2026-11-04", ...o });
const kl = (r, c) => klasifikasiBarisJurnal({ tanggal: "2026-11-10", membalik: null, unitId: null, kunciKelompok: null, ...r }, ctx(c)).kelompok;

test("klasifikasi: akun 5-1150/5-1900/5-1950/5-1960 TIDAK dikeluarkan utuh — per baris menurut bukti", () => {
  assert.equal(kl({ akunKode: "5-1100", sumber: "PEMAKAIAN_BAHAN", unitId: "uD", kunciKelompok: "k-ok" }), "TERWAKILI_HPP_OPERASIONAL");
  assert.equal(kl({ akunKode: "5-1100", sumber: "PEMAKAIAN_BAHAN", unitId: "uD", kunciKelompok: "k-part" }), "BEBAN_TETAP_DIHITUNG", "pergerakan belum bernilai → nilai jurnal dipakai");
  assert.equal(kl({ akunKode: "5-1100", sumber: "PEMAKAIAN_BAHAN", unitId: "uD", kunciKelompok: "k-hilang" }), "BEBAN_TETAP_DIHITUNG", "pergerakan tak ditemukan → tetap dihitung");
  assert.equal(kl({ akunKode: "5-1100", sumber: "PEMAKAIAN_BAHAN", unitId: "uX", kunciKelompok: "k-ok" }), "ORDER_BELUM_DIAKUI");
  assert.equal(kl({ akunKode: "5-1100", sumber: "REVERSAL", membalik: { sumber: "PEMAKAIAN_BAHAN" }, unitId: "uD", kunciKelompok: "k-ok" }), "TERWAKILI_HPP_OPERASIONAL", "pembalik mengikuti sumber aslinya");
  assert.equal(kl({ akunKode: "5-1900", sumber: "PEMAKAIAN_BAHAN", unitId: "uD", kunciKelompok: "k-ok" }), "BEBAN_TETAP_DIHITUNG", "susut unit tetap dihitung dari jurnal");
  assert.equal(kl({ akunKode: "5-1900", sumber: "PEMAKAIAN_BAHAN" }), "BEBAN_TETAP_DIHITUNG", "susut opname/rusak tetap dihitung");
  assert.equal(kl({ akunKode: "5-1150", sumber: "PEMBELIAN" }), "BEBAN_TETAP_DIHITUNG");
  assert.equal(kl({ akunKode: "5-1950", sumber: "TAGIHAN_SUPPLIER" }), "BEBAN_TETAP_DIHITUNG");
  assert.equal(kl({ akunKode: "5-1960", sumber: "PEMAKAIAN_BAHAN", tanggal: "2026-11-04" }), "KOREKSI_SALDO_LAMA", "selisih opname pada/sebelum SO bertaut");
  assert.equal(kl({ akunKode: "5-1960", sumber: "PEMAKAIAN_BAHAN", tanggal: "2026-11-05" }), "PERLU_KLASIFIKASI", "selisih sesudah SO tetap dihitung, ditandai");
  assert.equal(kl({ akunKode: "5-1960", sumber: "PEMAKAIAN_BAHAN", tanggal: "2026-11-01" }, { batasSO: null }), "PERLU_KLASIFIKASI", "tanpa SO bertaut tidak ada yang dianggap saldo lama");
  assert.equal(kl({ akunKode: "5-1100", sumber: "PERSEDIAAN_AWAL" }), "KOREKSI_SALDO_LAMA");
  assert.equal(kl({ akunKode: "5-1200", sumber: "PENGELUARAN" }), "BEBAN_TETAP_DIHITUNG");
});

test("jembatan: laba jurnal → hasil manajemen cocok, tidak ada biaya hilang atau ganda", () => {
  const baris = [
    { akunKode: "5-1100", nilai: 300, kelompok: "TERWAKILI_HPP_OPERASIONAL", peran: "BAHAN" },
    { akunKode: "5-1100", nilai: 120, kelompok: "BEBAN_TETAP_DIHITUNG", peran: "BAHAN_NILAI_JURNAL" },
    { akunKode: "5-1100", nilai: 80, kelompok: "ORDER_BELUM_DIAKUI", peran: "BAHAN" },
    { akunKode: "5-1960", nilai: 5000.5, kelompok: "KOREKSI_SALDO_LAMA", peran: "SALDO_LAMA" },
    { akunKode: "5-1960", nilai: 40, kelompok: "PERLU_KLASIFIKASI", peran: "SELISIH_STOK" },
    { akunKode: "5-1900", nilai: 25, kelompok: "BEBAN_TETAP_DIHITUNG", peran: "SUSUT" },
    { akunKode: "5-1950", nilai: 15, kelompok: "BEBAN_TETAP_DIHITUNG", peran: "LAIN" },
    { akunKode: "5-1200", nilai: 800, kelompok: "BEBAN_TETAP_DIHITUNG", peran: "UPAH" },
    { akunKode: "5-1300", nilai: 70, kelompok: "BEBAN_TETAP_DIHITUNG", peran: "OVERHEAD" },
  ];
  const bebanPokok = baris.reduce((a, x) => a + x.nilai, 0);
  const pendapatan = 100000; const ops = 4000; const labaJurnal = pendapatan - bebanPokok - ops;
  const h = hasilManajemen({ jurnal: { pendapatanBersih: pendapatan, bebanPokok, bebanOperasional: ops, labaBersih: labaJurnal, baris },
    operasional: { bahanDiakui: 700, susutBelumDijurnal: 10, orderDiakui: 3, orderLengkap: 1, unitBelumDiketahui: 2 } });
  const v = Object.fromEntries(h.baris.map((x) => [x.kunci, x.nilai]));
  assert.equal(h.kontrol.cocok, true, JSON.stringify(h.kontrol));
  assert.equal(h.kontrol.totalBarisDiklasifikasi, bebanPokok, "setiap baris masuk tepat satu kelompok");
  assert.equal(v.hpp, 700 + 10 + 800 + 70 + 120 + 25 + 15 + 40, "hanya yang terwakili/belum diakui/saldo lama yang dibalik");
  assert.equal(v.laba, pendapatan - v.hpp - ops);
  const j = Object.fromEntries(h.jembatan.map((x) => [x.kunci, x.nilai]));
  assert.equal(Math.round((j.laba_jurnal + j.balik_terwakili + j.balik_belum_diakui + j.balik_saldo_lama + j.kurang_bahan + j.kurang_susut) * 100) / 100, j.hasil);
  assert.equal(j.hasil, v.laba); assert.equal(j.balik_saldo_lama, 5000.5);
  assert.equal(h.status, "SEMENTARA"); assert.equal(h.final, false); assert.match(h.teksStatus, /2 unit belum diketahui/);
  assert.throws(() => hasilManajemen({ jurnal: { baris: [{ kelompok: "ASAL" }] }, operasional: {} }), /tidak dikenal/);
});

test("hasil manajemen: semua order lengkap → LENGKAP tetapi tetap bukan final", () => {
  const h = hasilManajemen({ jurnal: { pendapatanBersih: 100, bebanPokok: 5, bebanOperasional: 10, labaBersih: 85, baris: [{ akunKode: "5-1400", nilai: 5, kelompok: "BEBAN_TETAP_DIHITUNG", peran: "LAIN" }] }, operasional: { bahanDiakui: 30, susutBelumDijurnal: 2, orderDiakui: 1, orderLengkap: 1, unitBelumDiketahui: 0 } });
  assert.equal(h.status, "LENGKAP"); assert.equal(h.final, false); assert.equal(h.kontrol.cocok, true);
  assert.equal(Object.fromEntries(h.baris.map((x) => [x.kunci, x.nilai])).laba, 53);
});

test("dasar harga: jam diketahui → harga jam itu; hanya tanggal & tanpa perubahan → awal hari; berubah hari itu → PERLU_KEPUTUSAN; kosong → TANPA_HARGA", () => {
  const A = { priceId: "pA", harga: "100.0000", mulai: "2026-10-01T00:00:00.000Z" }; const B = { priceId: "pB", harga: "120.0000", mulai: "2026-11-03T06:00:00.000Z" };
  assert.deepEqual(dasarHargaBiaya({ awalHari: A }), { status: "DINILAI", basis: "AWAL_HARI_TANPA_PERUBAHAN", pilihan: A, kandidat: null });
  const k = dasarHargaBiaya({ awalHari: A, berubahPadaHari: [B] });
  assert.equal(k.status, "PERLU_KEPUTUSAN"); assert.equal(k.pilihan, null, "tidak memilih diam-diam");
  assert.deepEqual(k.kandidat.map((x) => [x.priceId, x.jenis]), [["pA", "AWAL_HARI"], ["pB", "BERUBAH_PADA_HARI"]]);
  assert.equal(dasarHargaBiaya({ waktuDiketahui: true, awalHari: A, berubahPadaHari: [B], diWaktu: B }).pilihan, B, "jam diketahui mengalahkan awal hari");
  assert.equal(dasarHargaBiaya({ waktuDiketahui: true, diWaktu: null }).status, "TANPA_HARGA");
  assert.equal(dasarHargaBiaya({}).status, "TANPA_HARGA", "harga historis kosong tetap belum diketahui");
  assert.equal(dasarHargaBiaya({ berubahPadaHari: [B] }).kandidat.length, 1, "tanpa harga awal hari: kandidat hanya perubahan hari itu");
});

test("ganda: identik (tanggal+jumlah sama) dipisah dari mirip; rujukan sumber dinormalkan; sidik tak bergantung urutan", () => {
  const { identik, mirip } = pisahkanGanda([
    { kind: "ISSUE_UNIT", id: "m1", qty: 2, tanggal: "2026-11-03" }, { kind: "ISSUE_UNIT", id: "m2", qty: 1, tanggal: "2026-11-03" },
    { kind: "CATATAN_HISTORIS", id: "n1", qty: 2, tanggal: null }, { kind: "BIAYA_TANPA_STOK", id: "e1", qty: 2, tanggal: "2026-11-03" },
  ], { qty: 2, tanggal: "2026-11-03" });
  assert.deepEqual(identik.map((x) => x.id), ["m1", "e1"]);
  assert.deepEqual(mirip.map((x) => x.id), ["m2", "n1"], "pemakaian kedua dengan jumlah lain pada hari yang sama sah (cukup konfirmasi)");
  assert.equal(normalRujukan("  LAP PIC 05/11   Baris 3 "), "lap pic 05/11 baris 3");
  assert.equal(sidikKandidat([{ kind: "A", id: 1 }, { kind: "B", id: 2 }]), sidikKandidat([{ kind: "B", id: 2 }, { kind: "A", id: 1 }]));
});
