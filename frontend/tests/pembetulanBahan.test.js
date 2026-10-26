import test from "node:test";
import assert from "node:assert/strict";
import { CARA, JALUR, PESAN, barisDampak, bolehKonfirmasi, sidikIsian, tubuhPembetulan, unitSelesai, validasiPembetulan } from "../src/features/production/bahan/pembetulanModel.js";

const bahan = { materialId: "m1", nama: "BUSA", kode: "B-1", satuan: "KG" };

test("unit selesai = terkirim atau dibatalkan; unit aktif bukan", () => {
  assert.equal(unitSelesai("DELIVERED"), true); assert.equal(unitSelesai("CANCELLED"), true);
  for (const s of ["IN_PRODUCTION", "RECEIVED", "READY_FOR_DELIVERY", undefined]) assert.equal(unitSelesai(s), false);
});

test("dua jalur dipisah tegas: catatan (tidak mengubah stok) vs pengeluaran stok (mengubah stok & HPP)", () => {
  assert.match(JALUR.CATATAN.badge, /Tidak mengubah stok/); assert.match(JALUR.STOK.badge, /Mengubah stok & HPP/);
  assert.match(JALUR.CATATAN.teks, /Stok, jurnal, dan HPP tidak berubah/); assert.match(JALUR.STOK.teks, /TIDAK diedit atau dihapus/);
  assert.deepEqual(CARA.map((c) => c.key), ["TAMBAH", "KURANGI", "AJUKAN"]); assert.equal(CARA.find((c) => c.key === "AJUKAN").langsung, false, "koreksi jumlah butuh persetujuan");
  assert.match(PESAN.bukaSelesai("DELIVERED"), /terkirim.*alasan wajib/s);
});

test("validasi: bahan, jumlah, alasan wajib (min 5), batas pengembalian", () => {
  assert.equal(validasiPembetulan({ cara: "TAMBAH", bahan: null, qty: "1", alasan: "alasan ok" }).ok, false);
  assert.equal(validasiPembetulan({ cara: "TAMBAH", bahan, qty: "", alasan: "alasan ok" }).ok, false);
  assert.equal(validasiPembetulan({ cara: "TAMBAH", bahan, qty: "0", alasan: "alasan ok" }).ok, false);
  assert.match(validasiPembetulan({ cara: "TAMBAH", bahan, qty: "2", alasan: "abc" }).galat, /Alasan wajib/);
  assert.equal(validasiPembetulan({ cara: "TAMBAH", bahan, qty: "2", alasan: "x".repeat(501) }).ok, false);
  const ok = validasiPembetulan({ cara: "TAMBAH", bahan, qty: "2,5", alasan: "  Terlewat dicatat  " }); assert.equal(ok.ok, true); assert.equal(ok.qty, 2.5); assert.equal(ok.alasan, "Terlewat dicatat");
  assert.match(validasiPembetulan({ cara: "KURANGI", bahan, qty: "6", alasan: "kelebihan", maks: 5 }).galat, /melebihi pemakaian bersih/);
  assert.equal(validasiPembetulan({ cara: "KURANGI", bahan, qty: "5", alasan: "kelebihan", maks: 5 }).ok, true);
  assert.equal(validasiPembetulan({ cara: "AJUKAN", bahan, qty: "0", alasan: "ternyata tidak dipakai" }).ok, true, "pemakaian yang benar boleh 0");
});

test("tubuh permintaan: pengurangan = qty negatif; alasan pembetulan selalu dikirim; tidak ada catatan buatan klien", () => {
  assert.deepEqual(tubuhPembetulan({ cara: "TAMBAH", bahan, qty: 3, alasan: " ok sekali " }), { materialId: "m1", qty: 3, alasanPembetulan: "ok sekali" });
  assert.deepEqual(tubuhPembetulan({ cara: "KURANGI", bahan, qty: 2, alasan: "kelebihan" }), { materialId: "m1", qty: -2, alasanPembetulan: "kelebihan" });
});

test("konfirmasi hanya setelah dampak dilihat, tanpa penghalang, dan isian belum berubah sejak pratinjau", () => {
  const s1 = sidikIsian({ cara: "TAMBAH", bahan, qty: "3", alasan: "a b c d e" }); const s2 = sidikIsian({ cara: "TAMBAH", bahan, qty: "4", alasan: "a b c d e" });
  assert.equal(bolehKonfirmasi(null, s1, s1), false); assert.equal(bolehKonfirmasi({ boleh: false }, s1, s1), false); assert.equal(bolehKonfirmasi({ boleh: true }, s2, s1), false, "isian berubah → lihat dampak lagi");
  assert.equal(bolehKonfirmasi({ boleh: true }, s1, s1), true);
});

test("baris dampak memakai teks server apa adanya (tanpa angka karangan) dan membedakan stok belum diketahui", () => {
  const pra = { bahan: { satuan: "KG" }, stok: { saldoSebelum: null, saldoSesudah: -3 }, pemakaianBersih: { sebelum: 0, sesudah: 3 }, finance: { hasil: "GAP_PERSEDIAAN_AWAL", teks: "TIDAK ada jurnal" }, hppOperasional: { teks: "Belum ada Harga Berlaku" } };
  const b = barisDampak(pra); assert.equal(b.length, 4);
  assert.equal(b.find((x) => x.k === "stok").teks, "belum diketahui → -3 KG"); assert.equal(b.find((x) => x.k === "finance").teks, "TIDAK ada jurnal"); assert.equal(b.find((x) => x.k === "hpp").teks, "Belum ada Harga Berlaku");
  assert.deepEqual(barisDampak(null), []);
  const b2 = barisDampak({ ...pra, stok: { saldoSebelum: 100, saldoSesudah: 97 } }); assert.equal(b2.find((x) => x.k === "stok").teks, "100 → 97 KG");
});
