// Empat status PO (progres barang · faktur · utang · pembayaran): fungsi murni, tabel kasus + larangan (Simpan ke Stok tidak menyetujui faktur; uang muka bukan utang).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hitungStatusEmpat, KALIMAT_SIMPAN_KE_STOK } from "../src/services/finance/statusEmpatPO.js";

const dasar = {
  statusPO: "DISETUJUI", nilaiPO: 6_000_000,
  barang: [{ dipesan: 100, datang: 0, masukStok: 0, baikBelumDisimpan: 0, belumDiperiksa: 0, menungguPengganti: 0, belumMasukStok: 100 }],
  fakturSemua: [], sudahDitagih: 0, utangTercatat: 0, sisaUtang: 0, uangMukaDibayar: 0, uangMukaBelumDiterapkan: 0, dibayarAtasFaktur: 0,
};
const kode = (r) => [r.barang.kode, r.faktur.kode, r.utang.kode, r.pembayaran.kode];

test("PO baru disetujui: semua belum ada", () => {
  assert.deepEqual(kode(hitungStatusEmpat(dasar)), ["BELUM_DATANG", "BELUM_ADA", "BELUM_ADA", "BELUM_ADA"]);
});

test("PO draf & dibatalkan: status barang menyatakan PO-nya, bukan 'belum datang'", () => {
  assert.equal(hitungStatusEmpat({ ...dasar, statusPO: "DRAFT" }).barang.kode, "PO_DRAFT");
  assert.equal(hitungStatusEmpat({ ...dasar, statusPO: "DIBATALKAN" }).barang.kode, "PO_DIBATALKAN");
});

test("uang muka Rp4 jt saja: pembayaran 'Baru uang muka', utang TETAP belum ada, sudah dibayar 4 jt", () => {
  const r = hitungStatusEmpat({ ...dasar, uangMukaDibayar: 4_000_000, uangMukaBelumDiterapkan: 4_000_000 });
  assert.deepEqual(kode(r), ["BELUM_DATANG", "BELUM_ADA", "BELUM_ADA", "UANG_MUKA_SAJA"]);
  assert.equal(r.sudahDibayar, 4_000_000);
  assert.ok(r.pembayaran.rincian.some((t) => /bukan|Tidak menambah stok/.test(t)));
});

test("barang datang & disimpan sebagian: status barang berubah, faktur/utang/pembayaran TIDAK ikut berubah; petunjuk Simpan ke Stok tampil bila ada baik belum disimpan", () => {
  const sebagian = { ...dasar, barang: [{ dipesan: 100, datang: 40, masukStok: 40, baikBelumDisimpan: 0, belumDiperiksa: 0, menungguPengganti: 0, belumMasukStok: 60 }] };
  assert.deepEqual(kode(hitungStatusEmpat(sebagian)), ["DATANG_SEBAGIAN", "BELUM_ADA", "BELUM_ADA", "BELUM_ADA"]);
  const belumSimpan = { ...dasar, barang: [{ dipesan: 100, datang: 100, masukStok: 0, baikBelumDisimpan: 100, belumDiperiksa: 0, menungguPengganti: 0, belumMasukStok: 100 }] };
  const r = hitungStatusEmpat(belumSimpan);
  assert.equal(r.barang.kode, "DATANG_SEBAGIAN");
  assert.ok(r.barang.rincian.some((t) => /Simpan ke Stok/.test(t)));
  assert.equal(r.faktur.kode, "BELUM_ADA");
  const lengkap = { ...dasar, barang: [{ dipesan: 100, datang: 100, masukStok: 100, baikBelumDisimpan: 0, belumDiperiksa: 0, menungguPengganti: 0, belumMasukStok: 0 }] };
  assert.equal(hitungStatusEmpat(lengkap).barang.kode, "LENGKAP");
  assert.ok(hitungStatusEmpat(lengkap).barang.rincian.some((t) => /tidak menyetujui faktur/.test(t)), "setiap status barang berisi pengingat bahwa Simpan ke Stok tidak menyetujui faktur");
});

test("faktur: draf/menunggu ≠ utang; disetujui sebagian vs lengkap ditentukan dari total disetujui vs nilai PO; ditolak tidak dihitung", () => {
  const menunggu = hitungStatusEmpat({ ...dasar, fakturSemua: [{ status: "MENUNGGU_APPROVAL" }] });
  assert.deepEqual([menunggu.faktur.kode, menunggu.utang.kode], ["MENUNGGU_PERSETUJUAN", "BELUM_ADA"]);
  assert.equal(menunggu.faktur.jumlah.menunggu, 1);
  const ditolakSaja = hitungStatusEmpat({ ...dasar, fakturSemua: [{ status: "DITOLAK" }] });
  assert.equal(ditolakSaja.faktur.kode, "BELUM_ADA");
  const sebagian = hitungStatusEmpat({ ...dasar, fakturSemua: [{ status: "DISETUJUI" }], sudahDitagih: 3_000_000, utangTercatat: 3_000_000, sisaUtang: 3_000_000 });
  assert.deepEqual([sebagian.faktur.kode, sebagian.utang.kode], ["DISETUJUI_SEBAGIAN", "ADA_UTANG"]);
  const lengkap = hitungStatusEmpat({ ...dasar, fakturSemua: [{ status: "DISETUJUI" }], sudahDitagih: 6_000_000, utangTercatat: 6_000_000, sisaUtang: 6_000_000 });
  assert.equal(lengkap.faktur.kode, "DISETUJUI_LENGKAP");
  const adaTerbuka = hitungStatusEmpat({ ...dasar, fakturSemua: [{ status: "DISETUJUI" }, { status: "DRAFT" }], sudahDitagih: 6_000_000, utangTercatat: 6_000_000, sisaUtang: 6_000_000 });
  assert.equal(adaTerbuka.faktur.kode, "DISETUJUI_SEBAGIAN", "masih ada faktur belum disetujui");
});

test("contoh Rp6 jt: uang muka 4 jt diterapkan → sisa utang 2 jt (utang berjalan, pembayaran masih 'Baru uang muka', sudah dibayar 4 jt tidak 8 jt); pelunasan 2 jt → lunas", () => {
  const berjalan = hitungStatusEmpat({ ...dasar, fakturSemua: [{ status: "DISETUJUI" }], sudahDitagih: 6_000_000, utangTercatat: 2_000_000, sisaUtang: 2_000_000, uangMukaDibayar: 4_000_000, uangMukaBelumDiterapkan: 0, dibayarAtasFaktur: 0 });
  assert.deepEqual(kode(berjalan), ["BELUM_DATANG", "DISETUJUI_LENGKAP", "ADA_UTANG", "UANG_MUKA_SAJA"]);
  assert.equal(berjalan.sudahDibayar, 4_000_000);
  const lunas = hitungStatusEmpat({ ...dasar, fakturSemua: [{ status: "LUNAS" }], sudahDitagih: 6_000_000, utangTercatat: 2_000_000, sisaUtang: 0, uangMukaDibayar: 4_000_000, dibayarAtasFaktur: 2_000_000 });
  assert.deepEqual([lunas.utang.kode, lunas.pembayaran.kode, lunas.sudahDibayar], ["LUNAS", "LUNAS", 6_000_000]);
});

test("uang muka belum diterapkan menahan label 'Lunas' pembayaran dan memberi petunjuk; kelebihan bayar ditandai", () => {
  const r = hitungStatusEmpat({ ...dasar, fakturSemua: [{ status: "LUNAS" }], sudahDitagih: 6_000_000, utangTercatat: 6_000_000, sisaUtang: 0, uangMukaDibayar: 1_000_000, dibayarAtasFaktur: 6_000_000, uangMukaBelumDiterapkan: 1_000_000 });
  assert.equal(r.pembayaran.kode, "KELEBIHAN");
  assert.ok(r.utang.rincian.some((t) => /belum diterapkan/.test(t)));
  const belumTerap = hitungStatusEmpat({ ...dasar, fakturSemua: [{ status: "LUNAS" }], sudahDitagih: 5_000_000, utangTercatat: 5_000_000, sisaUtang: 0, uangMukaDibayar: 500_000, dibayarAtasFaktur: 4_500_000, uangMukaBelumDiterapkan: 500_000 });
  assert.notEqual(belumTerap.pembayaran.kode, "LUNAS");
});

test("kalimat petunjuk memuat pesan Owner; tidak ada kode status yang menyiratkan Simpan ke Stok menyetujui faktur", () => {
  assert.match(KALIMAT_SIMPAN_KE_STOK, /Simpan ke Stok.*tidak menyetujui faktur.*Catat Faktur dan Setujui tetap aksi Finance yang terpisah/);
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/services/finance/statusEmpatPO.js"), "utf8");
  assert.ok(!/stockMovement|prisma|tx\./.test(src.replace(/\/\/.*$/gm, "")), "fungsi murni: tanpa akses DB");
});
