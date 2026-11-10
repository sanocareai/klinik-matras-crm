// HPP PER ORDER — aturan murni (jalur SO, status unit, sidik, hasil manajemen tanpa hitung ganda).
import test from "node:test";
import assert from "node:assert/strict";
import { tentukanJalur, statusUnitHpp, statusOrderHpp, sidikBaris, hasilManajemen, AKUN_BAHAN_JURNAL } from "../src/lib/domain/hppOrder.js";

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
  const tanpaHarga = statusUnitHpp({ baris: [b("m1"), b("m2", "TANPA_HARGA")] });
  assert.equal(tanpaHarga.key, "BELUM_LENGKAP"); assert.equal(tanpaHarga.barisTanpaNilai, 1); assert.equal(tanpaHarga.nilaiDiketahui, 1000, "hanya bagian yang diketahui");
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

test("hasil manajemen: beban bahan jurnal dikeluarkan (tidak dihitung dua kali), upah/overhead/ops dari jurnal, status SEMENTARA bila belum lengkap", () => {
  const h = hasilManajemen({
    jurnal: { pendapatanBersih: 100000000, bebanOperasional: 40000000, akunBebanPokok: [{ kode: "5-1100", nilai: 50000 }, { kode: "5-1960", nilai: 45000000.5 }, { kode: "5-1200", nilai: 800000 }, { kode: "5-1300", nilai: 70000 }] },
    operasional: { bahanDiakui: 700000, susutPeriode: 0, orderDiakui: 40, orderLengkap: 0, unitDiakui: 40, unitLengkap: 0, unitBelumDiketahui: 40 },
  });
  const v = Object.fromEntries(h.baris.map((x) => [x.kunci, x.nilai]));
  assert.equal(v.upah, 800000); assert.equal(v.overhead, 70000); assert.equal(v.bahan, 700000);
  assert.equal(v.hpp, 1570000, "5-1100 dan 5-1960 TIDAK ikut HPP manajemen");
  assert.equal(v.laba, 100000000 - 1570000 - 40000000);
  assert.deepEqual(h.dikeluarkan.akun.map((a) => a.kode).sort(), ["5-1100", "5-1960"]);
  assert.equal(h.dikeluarkan.total, 45050000.5);
  assert.equal(h.status, "SEMENTARA"); assert.equal(h.final, false); assert.match(h.teksStatus, /40 unit belum diketahui/);
  assert.ok(Object.keys(AKUN_BAHAN_JURNAL).includes("5-1150"));
});

test("hasil manajemen: semua order lengkap → LENGKAP tetapi tetap bukan final (bukan jurnal)", () => {
  const h = hasilManajemen({ jurnal: { pendapatanBersih: 100, bebanOperasional: 10, akunBebanPokok: [{ kode: "5-1400", nama: "Lain", nilai: 5 }] }, operasional: { bahanDiakui: 30, susutPeriode: 2, orderDiakui: 1, orderLengkap: 1, unitDiakui: 1, unitLengkap: 1, unitBelumDiketahui: 0 } });
  assert.equal(h.status, "LENGKAP"); assert.equal(h.final, false);
  const v = Object.fromEntries(h.baris.map((x) => [x.kunci, x.nilai]));
  assert.equal(v.beban_pokok_lain, 5); assert.equal(v.hpp, 37); assert.equal(v.laba, 53);
});
