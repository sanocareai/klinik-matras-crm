// Aturan murni Laporan Produksi: status biaya, agregasi order = Σ unit, kelompok selesai tidak ganda, tanggal WIB, durasi tidak dikarang.
import test from "node:test";
import assert from "node:assert/strict";
import { agregasi, barisPergerakan, gabungAgregasi, hariDalamPeriode, isGuard, kelompokkanSelesai, klasifikasiSelesai, rataDurasi, statusBiaya, tanggalPemakaian, wibKeyDari } from "../src/lib/domain/laporanProduksi.js";

const mov = (o = {}) => ({ id: "m1", type: "ISSUE", qty: -2, createdAt: "2026-10-28T10:00:00Z", note: null, materialId: "b", unitId: "u", materialKode: "BUSA", materialNama: "Busa", materialSatuan: "SHEET", ...o });
const snap = (o = {}) => ({ status: "DINILAI", unitCost: "20000", value: "40000", priceEffectiveFrom: "2026-08-01T00:00:00Z", basisHarga: "WAKTU_PEMAKAIAN", sumber: "BEKU_SAAT_POSTING", evidenceLabel: null, ...o });

test("tanggal WIB: 17:30 UTC = 00:30 WIB hari berikutnya; tanggal dilaporkan mengalahkan waktu pencatatan", () => {
  assert.equal(wibKeyDari("2026-10-28T17:30:00Z"), "2026-10-29"); assert.equal(wibKeyDari("2026-10-28T16:59:59Z"), "2026-10-28");
  assert.deepEqual(tanggalPemakaian(mov({ createdAt: "2026-10-28T10:00:00Z", note: "Pembetulan unit terkirim (X-U1) [dilaporkan 2026-10-10]: a" })), { tanggal: "2026-10-10", dasar: "DILAPORKAN" });
  assert.deepEqual(tanggalPemakaian(mov(), "2026-09-30T20:00:00Z"), { tanggal: "2026-10-01", dasar: "CATATAN_HISTORIS" });
  assert.deepEqual(tanggalPemakaian(mov()), { tanggal: "2026-10-28", dasar: "PENCATATAN" });
  assert.deepEqual(hariDalamPeriode("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
});

test("nilai diketahui hanya dari harga BEKU; belum dibekukan / tanpa harga / gagal = masalah; SANO GUARD: snapshot resmi IKUT dihitung, nilainya terpisah, dan gap perakitan tercatat", () => {
  const b = [barisPergerakan(mov(), snap()), barisPergerakan(mov({ id: "m2" }), null), barisPergerakan(mov({ id: "m3" }), { status: "TANPA_HARGA" }), barisPergerakan(mov({ id: "m4" }), { status: "GAGAL_PEMBEKUAN" }),
    barisPergerakan(mov({ id: "m5", materialKode: "SANO-GUARD-110X190X4" }), snap({ value: "150000" }))];
  assert.deepEqual(b.map((x) => x.status), ["DIBEKUKAN", "BELUM_DIBEKUKAN", "TANPA_HARGA", "GAGAL", "DIBEKUKAN"], "SANO GUARD dengan snapshot resmi berstatus DIBEKUKAN seperti bahan lain"); assert.equal(b[4].guard, true); assert.equal(b[0].guard, false);
  const a = agregasi(b); assert.equal(a.nilaiDiketahui, 190000, "40.000 + 150.000 (SANO GUARD ikut)"); assert.equal(a.nilaiGuard, 150000, "nilai SANO GUARD terpisah"); assert.deepEqual([a.masalah.BELUM_DIBEKUKAN, a.masalah.TANPA_HARGA, a.masalah.GAGAL, a.masalah.GUARD], [1, 1, 1, 1], "gap perakitan tercatat walau nilainya dihitung"); assert.equal(a.jumlahMasalah, 4);
  assert.equal(statusBiaya(agregasi([barisPergerakan(mov({ materialKode: "SANO-GUARD-X" }), snap())])).key, "PARSIAL", "hanya SANO GUARD + nilai resmi: tetap Parsial (biaya perakitan belum tersedia), bukan Lengkap");
  assert.ok(isGuard("sano-guard-x"));
});

test("pengembalian mengurangi, susut terpisah", () => {
  const a = agregasi([barisPergerakan(mov(), snap({ value: "100000" })), barisPergerakan(mov({ id: "r", type: "RETURN", qty: 1 }), snap({ value: "-20000" })), barisPergerakan(mov({ id: "w", type: "WASTE", qty: -1 }), snap({ value: "20000" }))]);
  assert.equal(a.nilaiDiketahui, 80000); assert.equal(a.susut, 20000);
});

test("status: Lengkap hanya tanpa masalah DAN ada dasar; satu catatan berharga + masalah lain ⇒ Parsial; tanpa nilai ⇒ Belum diketahui (bukan 0)", () => {
  const ok = agregasi([barisPergerakan(mov(), snap())]); assert.equal(statusBiaya(ok).key, "LENGKAP");
  const parsial = agregasi([barisPergerakan(mov(), snap())], { bahanBelumDicatat: 1 }); assert.equal(statusBiaya(parsial).key, "PARSIAL");
  const kosong = agregasi([], { bahanBelumDicatat: 1 }); assert.equal(statusBiaya(kosong).key, "BELUM_DIKETAHUI");
  assert.equal(statusBiaya(agregasi([])).key, "BELUM_DIKETAHUI", "tidak ada apa pun ≠ lengkap");
  assert.equal(statusBiaya(agregasi([]), { semuaTanpaBahan: true }).key, "LENGKAP", "semua unit dinyatakan tanpa bahan baru");
});

test("order = Σ unit (gabungAgregasi)", () => {
  const u1 = agregasi([barisPergerakan(mov(), snap())], { sementara: 1 }); const u2 = agregasi([barisPergerakan(mov({ id: "z" }), snap({ value: "10000" }))], { catatanTertahan: 2 });
  const o = gabungAgregasi([u1, u2]); assert.equal(o.nilaiDiketahui, u1.nilaiDiketahui + u2.nilaiDiketahui); assert.equal(o.jumlahMasalah, u1.jumlahMasalah + u2.jumlahMasalah); assert.equal(o.baris, 2);
});

test("selesai dikelompokkan SEKALI per unit; tak tercatat tampil sendiri; Σ baris = total", () => {
  const u = [{ unitId: "1" }, { unitId: "2" }, { unitId: "3" }, { unitId: "4" }]; const peta = { 1: "TABLE_1", 2: "TABLE_1", 3: "TABLE_2" };
  const g = kelompokkanSelesai(u, (x) => peta[x.unitId] ?? null); assert.equal(g.reduce((a, x) => a + x.selesai, 0), 4); assert.equal(g[g.length - 1].label, "Tidak tercatat"); assert.equal(g[g.length - 1].selesai, 1);
});

test("durasi tidak dikarang: kosong ⇒ belum tersedia; n<3 ⇒ data belum cukup; nol buatan tidak dihitung", () => {
  assert.equal(rataDurasi([]).rataMenit, null); assert.match(rataDurasi([NaN]).catatan, /Belum tersedia/); assert.match(rataDurasi([10, 20]).catatan, /belum cukup/);
  assert.equal(rataDurasi([10, 20, 30]).rataMenit, 20); assert.equal(rataDurasi([NaN, -5, 30, 40, 50]).n, 3);
});

test("klasifikasiSelesai: posisi ≠ bertanggal; tanpa tanggal terpisah; dua bukti = satu unit (tanggal paling awal); tanggal tidak valid diabaikan", () => {
  const units = [{ id: "a", status: "READY_FOR_DELIVERY" }, { id: "b", status: "DELIVERED" }, { id: "c", status: "IN_PRODUCTION" }, { id: "d", status: "READY_FOR_DELIVERY" }];
  const bukti = new Map([["a", [{ sumber: "SERAH_BARANG_JADI", at: "2026-10-20T10:00:00Z" }, { sumber: "STATUS_KERJA_SELESAI", at: "2026-10-18T01:00:00Z" }]], ["c", [{ sumber: "SERAH_BARANG_JADI", at: "2026-10-21T17:30:00Z" }]], ["d", [{ sumber: "SERAH_BARANG_JADI", at: "tanggal-rusak" }]]]);
  const k = klasifikasiSelesai(units, bukti);
  assert.deepEqual(k.posisi, ["a", "b", "d"]); assert.equal(k.bertanggal.size, 2); assert.equal(k.bertanggal.get("a").sumber, "STATUS_KERJA_SELESAI"); assert.equal(k.bertanggal.get("a").key, "2026-10-18");
  assert.equal(k.bertanggal.get("c").key, "2026-10-22", "17:30 UTC = 00:30 WIB hari berikutnya"); assert.deepEqual(k.tanpaTanggal, ["b", "d"]);
  assert.equal(klasifikasiSelesai(units).bertanggal.size, 0); assert.equal(klasifikasiSelesai(units).tanpaTanggal.length, 3, "tanpa bukti sama sekali: semua selesai-posisi = tanpa tanggal, BUKAN 0 selesai");
});
