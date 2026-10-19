// Stock Opname sesi model 2 (UI): kolom kosong ≠ 0, penyaringan tab, payload simpan, konflik, kontrak struktur (satu halaman kerja, tanpa modal panjang, tanpa saldo di halaman hitung).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJumlah, saringBaris, hitungTab, susunItemSimpan, terapkanHasilSimpan, bekukanAntrean, teksProgres, MODE_LABEL } from "../src/features/warehouse/opname/opnameLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(dir, "../src", rel), "utf8").replace(/\r\n/g, "\n");
const B = (id, kode, o = {}) => ({ id, kode, nama: `Bahan ${kode}`, satuan: "PCS", kelompokKode: "BUSA", counted: null, revision: 0, ditandaRagu: false, perluPeriksa: false, excluded: false, ...o });

test("parseJumlah: kosong = belum dihitung (BUKAN 0); 0 eksplisit sah; koma desimal; negatif/huruf ditolak", () => {
  assert.deepEqual(parseJumlah(""), { kosong: true }); assert.deepEqual(parseJumlah("   "), { kosong: true }); assert.deepEqual(parseJumlah(undefined), { kosong: true });
  assert.deepEqual(parseJumlah("0"), { nilai: 0 }); assert.deepEqual(parseJumlah("12,5"), { nilai: 12.5 }); assert.deepEqual(parseJumlah("12.5"), { nilai: 12.5 });
  for (const salah of ["-1", "abc", "1,2,3", "1e3"]) assert.ok(parseJumlah(salah).galat, salah);
});

test("saringBaris/hitungTab: Belum / Sudah (0 terhitung sudah) / Perlu diperiksa / Dikeluarkan; pencarian kode atau nama; kelompok", () => {
  const baris = [B("1", "A1"), B("2", "A2", { counted: 0 }), B("3", "B1", { counted: 5, perluPeriksa: true, kelompokKode: "KAIN" }), B("4", "B2", { excluded: true })];
  assert.deepEqual(hitungTab(baris), { belum: 1, sudah: 2, periksa: 1, keluar: 1 });
  assert.deepEqual(saringBaris(baris, { tab: "belum" }).map((b) => b.id), ["1"]); assert.deepEqual(saringBaris(baris, { tab: "sudah" }).map((b) => b.id), ["2", "3"], "0 eksplisit = sudah dihitung");
  assert.deepEqual(saringBaris(baris, { tab: "periksa" }).map((b) => b.id), ["3"]); assert.deepEqual(saringBaris(baris, { tab: "keluar" }).map((b) => b.id), ["4"]);
  assert.deepEqual(saringBaris(baris, { tab: "sudah", q: "b1" }).map((b) => b.id), ["3"]); assert.deepEqual(saringBaris(baris, { tab: "sudah", kelompok: "KAIN" }).map((b) => b.id), ["3"]);
  assert.deepEqual(saringBaris(baris, { tab: "belum", q: "bahan a1" }).map((b) => b.id), ["1"]);
});

test("susunItemSimpan: hanya perubahan nyata; kosong pada bahan baru tidak dikirim; mengubah angka tersimpan wajib alasan; revisi dibawa; ragu terkirim", () => {
  const baris = [B("1", "A1"), B("2", "A2", { counted: 10, revision: 1 }), B("3", "A3", { counted: 4, revision: 2 })];
  const r = susunItemSimpan(baris, { 1: { teks: "" }, 2: { teks: "12" }, 3: { teks: "4" } });
  assert.deepEqual(r.items, [], "kosong pada bahan baru & angka sama tidak dikirim"); assert.ok(r.galat["2"] && /Alasan koreksi/.test(r.galat["2"]));
  const r2 = susunItemSimpan(baris, { 1: { teks: "0" }, 2: { teks: "12", alasan: "hitung ulang" }, 3: { teks: "4", ragu: true } });
  assert.deepEqual(r2.items, [{ lineId: "1", revision: 0, countedQty: 0 }, { lineId: "2", revision: 1, countedQty: 12, alasan: "hitung ulang" }, { lineId: "3", revision: 2, countedQty: 4, perluPeriksa: true }]);
  assert.equal(susunItemSimpan(baris, { 1: { teks: "abc" } }).galat["1"] !== undefined, true);
  const kosongkan = susunItemSimpan(baris, { 2: { teks: "", alasan: "salah baris" } }); assert.equal(kosongkan.items[0].countedQty, null, "mengosongkan = belum dihitung lagi (dengan alasan)");
});

test("terapkanHasilSimpan: DISIMPAN memperbarui baris & menghapus draf; KONFLIK menyimpan angka terbaru orang lain dan mempertahankan draf; DITOLAK menampilkan pesan", () => {
  const baris = [B("1", "A1"), B("2", "A2", { counted: 10, revision: 1 }), B("3", "A3")];
  const draf = { 1: { teks: "7" }, 2: { teks: "9", alasan: "x" }, 3: { teks: "-1" } };
  const t = terapkanHasilSimpan(baris, draf, [{ lineId: "1", status: "DISIMPAN", revision: 1, counted: 7, countedAt: "2026-11-01T10:00:00Z", oleh: { id: "u1", nama: "Nadya" }, perluPeriksa: false },
    { lineId: "2", status: "KONFLIK", saatIni: { counted: 11, revision: 2, oleh: { nama: "Rika" }, countedAt: "2026-11-01T10:05:00Z" } }, { lineId: "3", status: "DITOLAK", pesan: "Jumlah harus angka" }]);
  assert.equal(t.baris[0].counted, 7); assert.equal(t.baris[0].revision, 1); assert.equal(t.baris[0].countedBy.nama, "Nadya"); assert.equal(t.draf["1"], undefined);
  assert.equal(t.draf["2"].teks, "9", "angka petugas ini tidak hilang saat konflik"); assert.equal(t.konflik["2"].counted, 11); assert.equal(t.baris[1].counted, 10, "angka orang lain belum menimpa baris sebelum dipilih");
  assert.equal(t.galatBaris["3"], "Jumlah harus angka");
});

test("antrean kartu HP dibekukan saat penyaring berubah (urutan tidak bergeser ketika baris disimpan); teks progres", () => {
  const baris = [B("1", "A1"), B("2", "A2"), B("3", "A3", { counted: 1 })];
  assert.deepEqual(bekukanAntrean(baris, { tab: "belum" }), ["1", "2"]);
  assert.equal(teksProgres({ total: 360, dihitung: 142, persen: 39.4 }), "142 dari 360 bahan dihitung (39,4%)"); assert.equal(teksProgres({ total: 0 }), "Belum ada bahan di sesi");
  assert.deepEqual(Object.keys(MODE_LABEL), ["FULL", "GROUP", "ITEMS"]);
});

test("struktur: tiga pilihan cakupan + pratinjau; halaman kerja terpisah (bukan modal) dengan simpan bertahap, tab, pencarian, kartu HP; tidak ada saldo/auto-isi; sesi lama tetap lewat OpnameDetail", () => {
  const buat = baca("features/warehouse/opname/BuatSesiOpname.jsx");
  for (const k of ["data-testid={`mode-${k}`}", "Opname penuh", "pratinjau-cakupan", "pratinjau-belum-kelompok", "pratinjau-nonaktif", "pratinjau-pengecualian", "sesi-penuh-aktif", 'data-testid="centang-bahan"', 'data-testid="buat-sesi"', "pratinjauCakupanOpname"]) assert.ok(buat.includes(k), k);
  assert.match(buat, /FokusOverlay/); assert.doesNotMatch(buat, /<Modal/);
  const kerja = baca("pages/warehouse/WarehouseOpnameKerja.jsx");
  for (const k of ["TAB", 'data-testid="cari-kerja"', 'data-testid="simpan-perubahan"', 'data-testid="simpan-berikutnya"', 'data-testid="kartu-hp"', 'data-testid="progres-kelompok"', 'data-testid="serahkan-hitungan"', "simpanHasilOpname", "beforeunload", "PanelDiLuarCakupan"]) assert.ok(kerja.includes(k), k);
  assert.doesNotMatch(kerja, /systemQty|saldoSistem|pembanding/, "halaman hitung tidak membawa saldo sistem"); assert.doesNotMatch(kerja, /api\.completeStockCount/, "menyimpan hitungan tidak menyelesaikan sesi");
  const logic = baca("features/warehouse/opname/opnameLogic.js"); assert.doesNotMatch(logic, /systemQty/, "tidak ada isian otomatis dari saldo");
  const reg = baca("routes/pageRegistry.jsx"); assert.match(reg, /"\/warehouse\/stock-count\/:id\/hitung"/);
  const det = baca("features/warehouse/dokumen/OpnameDetail.jsx"); assert.match(det, /r\.modelVersion === 2/); assert.match(det, /OpnameSesiTinjau/);
  const list = baca("pages/warehouse/WarehouseStockCount.jsx"); assert.match(list, /BuatSesiOpname/); assert.doesNotMatch(list, /StockCountFormModal/); assert.match(list, /dipilih manual \(sesi lama\)/);
  const tinjau = baca("features/warehouse/opname/OpnameSesiTinjau.jsx"); for (const k of ["waktu-hitung", "saldo-sebanding", "transaksi-relevan", 'data-testid="selisih"', "alasan-selisih", "hanya-selisih"]) assert.ok(tinjau.includes(k), k);
});
