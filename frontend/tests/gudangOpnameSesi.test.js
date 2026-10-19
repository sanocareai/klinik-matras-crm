// Stock Opname sesi model 2 (UI): kolom kosong ≠ 0, penyaringan tab, payload simpan, konflik, tiga waktu (dihitung / disimpan / diposting), kontrak struktur
// (satu halaman kerja, tanpa modal panjang, tanpa saldo di halaman hitung).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseJumlah, saringBaris, hitungTab, susunItemSimpan, terapkanHasilSimpan, terapkanHasilMulai, bekukanAntrean, teksProgres, teksWaktuBaris, isoKeInputWaktu, inputWaktuKeIso,
  tanpaWaktu, KELAS_PERGERAKAN, MODE_LABEL, WAKTU_TANPA,
} from "../src/features/warehouse/opname/opnameLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(dir, "../src", rel), "utf8").replace(/\r\n/g, "\n");
const B = (id, kode, o = {}) => ({ id, kode, nama: `Bahan ${kode}`, satuan: "PCS", kelompokKode: "BUSA", counted: null, revision: 0, ditandaRagu: false, perluPeriksa: false, excluded: false, observedAt: null, ...o });
const JAM = "2026-11-01T03:00:00.000Z";

test("parseJumlah: kosong = belum dihitung (BUKAN 0); 0 eksplisit sah; koma desimal; negatif/huruf ditolak", () => {
  assert.deepEqual(parseJumlah(""), { kosong: true }); assert.deepEqual(parseJumlah("   "), { kosong: true }); assert.deepEqual(parseJumlah(undefined), { kosong: true });
  assert.deepEqual(parseJumlah("0"), { nilai: 0 }); assert.deepEqual(parseJumlah("12,5"), { nilai: 12.5 }); assert.deepEqual(parseJumlah("12.5"), { nilai: 12.5 });
  for (const salah of ["-1", "abc", "1,2,3", "1e3"]) assert.ok(parseJumlah(salah).galat, salah);
});

test("saringBaris/hitungTab: Belum / Sudah (0 terhitung sudah) / Tanpa waktu hitung / Perlu diperiksa / Dikeluarkan; pencarian kode atau nama; kelompok", () => {
  const baris = [B("1", "A1"), B("2", "A2", { counted: 0, observedAt: JAM }), B("3", "B1", { counted: 5, perluPeriksa: true, kelompokKode: "KAIN" }), B("4", "B2", { excluded: true })];
  assert.deepEqual(hitungTab(baris), { belum: 1, sudah: 2, waktu: 1, periksa: 1, keluar: 1 });
  assert.deepEqual(saringBaris(baris, { tab: "belum" }).map((b) => b.id), ["1"]); assert.deepEqual(saringBaris(baris, { tab: "sudah" }).map((b) => b.id), ["2", "3"], "0 eksplisit = sudah dihitung");
  assert.deepEqual(saringBaris(baris, { tab: "waktu" }).map((b) => b.id), ["3"], "angka ada tetapi waktu hitung tidak diketahui"); assert.equal(tanpaWaktu(baris[1]), false); assert.equal(tanpaWaktu(baris[3]), false, "dikeluarkan tidak dihitung");
  assert.deepEqual(saringBaris(baris, { tab: "periksa" }).map((b) => b.id), ["3"]); assert.deepEqual(saringBaris(baris, { tab: "keluar" }).map((b) => b.id), ["4"]);
  assert.deepEqual(saringBaris(baris, { tab: "sudah", q: "b1" }).map((b) => b.id), ["3"]); assert.deepEqual(saringBaris(baris, { tab: "sudah", kelompok: "KAIN" }).map((b) => b.id), ["3"]);
  assert.deepEqual(saringBaris(baris, { tab: "belum", q: "bahan a1" }).map((b) => b.id), ["1"]);
});

test("susunItemSimpan: hanya perubahan nyata; kosong pada bahan baru tidak dikirim; mengubah angka tersimpan wajib alasan; revisi dibawa; ragu terkirim; salah ketik = waktuTetap", () => {
  const baris = [B("1", "A1", { observedAt: JAM }), B("2", "A2", { counted: 10, revision: 1, observedAt: JAM }), B("3", "A3", { counted: 4, revision: 2, observedAt: JAM })];
  const r = susunItemSimpan(baris, { 1: { teks: "" }, 2: { teks: "12" }, 3: { teks: "4" } });
  assert.deepEqual(r.items, [], "kosong pada bahan baru & angka sama tidak dikirim"); assert.ok(r.galat["2"] && /Alasan koreksi/.test(r.galat["2"]));
  const r2 = susunItemSimpan(baris, { 1: { teks: "0" }, 2: { teks: "12", alasan: "hitung ulang" }, 3: { teks: "4", ragu: true } });
  assert.deepEqual(r2.items, [{ lineId: "1", revision: 0, countedQty: 0 }, { lineId: "2", revision: 1, countedQty: 12, alasan: "hitung ulang", waktuTetap: true }, { lineId: "3", revision: 2, countedQty: 4, perluPeriksa: true }]);
  assert.equal(susunItemSimpan(baris, { 1: { teks: "abc" } }).galat["1"] !== undefined, true);
  const kosongkan = susunItemSimpan(baris, { 2: { teks: "", alasan: "salah baris" } }); assert.equal(kosongkan.items[0].countedQty, null, "mengosongkan = belum dihitung lagi (dengan alasan)"); assert.equal(kosongkan.items[0].waktuTetap, undefined);
});

test("WAKTU HITUNG tidak dikarang: angka pertama tanpa 'Mulai hitung' memunculkan perluWaktu (belum dikirim); setelah petugas memilih waktu ikut terkirim; WAKTU_TANPA menyimpan tanpa waktu; hitung ulang (bukan salah ketik) juga bertanya", () => {
  const baris = [B("1", "A1"), B("2", "A2", { observedAt: JAM }), B("3", "A3", { counted: 10, revision: 1, observedAt: JAM })];
  const draf = { 1: { teks: "5" }, 2: { teks: "6" } };
  const tanya = susunItemSimpan(baris, draf); assert.deepEqual(tanya.perluWaktu, ["1"], "hanya bahan yang belum dimulai"); assert.deepEqual(tanya.items.map((i) => i.lineId), ["2"], "yang sudah 'Mulai hitung' langsung terkirim memakai waktu yang dicap server"); assert.equal(tanya.items[0].observedAt, undefined);
  const pilih = susunItemSimpan(baris, draf, { waktu: "2026-11-01T02:00:00.000Z" }); assert.deepEqual(pilih.perluWaktu, []); assert.equal(pilih.items.find((i) => i.lineId === "1").observedAt, "2026-11-01T02:00:00.000Z"); assert.equal(pilih.items.find((i) => i.lineId === "2").observedAt, undefined, "waktu Mulai hitung tidak ditimpa");
  const tanpa = susunItemSimpan(baris, draf, { waktu: WAKTU_TANPA }); assert.equal(tanpa.items.find((i) => i.lineId === "1").observedAt, undefined, "disimpan tanpa waktu — server menandai 'tidak diketahui'");
  const ulang = susunItemSimpan(baris, { 3: { teks: "11", alasan: "hitung ulang rak B", salahKetik: false } }); assert.deepEqual(ulang.perluWaktu, ["3"], "hitung ulang = pengamatan baru: tanyakan waktunya");
  const ulang2 = susunItemSimpan(baris, { 3: { teks: "11", alasan: "hitung ulang rak B", salahKetik: false } }, { waktu: JAM }); assert.equal(ulang2.items[0].observedAt, JAM); assert.equal(ulang2.items[0].waktuTetap, undefined);
});

test("terapkanHasilSimpan: DISIMPAN memperbarui baris (angka, disimpan, dihitung) & menghapus draf; KONFLIK menyimpan angka terbaru orang lain dan mempertahankan draf; DITOLAK menampilkan pesan", () => {
  const baris = [B("1", "A1"), B("2", "A2", { counted: 10, revision: 1 }), B("3", "A3")];
  const draf = { 1: { teks: "7" }, 2: { teks: "9", alasan: "x" }, 3: { teks: "-1" } };
  const t = terapkanHasilSimpan(baris, draf, [{ lineId: "1", status: "DISIMPAN", revision: 1, counted: 7, savedAt: "2026-11-01T10:40:00Z", observedAt: "2026-11-01T10:00:00Z", observedSource: "DINYATAKAN", tanpaWaktu: false, oleh: { id: "u1", nama: "Nadya" }, perluPeriksa: false },
    { lineId: "2", status: "KONFLIK", saatIni: { counted: 11, revision: 2, oleh: { nama: "Rika" }, savedAt: "2026-11-01T10:05:00Z" } }, { lineId: "3", status: "DITOLAK", pesan: "Jumlah harus angka" }]);
  assert.equal(t.baris[0].counted, 7); assert.equal(t.baris[0].revision, 1); assert.equal(t.baris[0].countedBy.nama, "Nadya"); assert.equal(t.draf["1"], undefined);
  assert.equal(t.baris[0].savedAt, "2026-11-01T10:40:00Z"); assert.equal(t.baris[0].observedAt, "2026-11-01T10:00:00Z", "tiga waktu terpisah di baris lokal"); assert.notEqual(t.baris[0].savedAt, t.baris[0].observedAt);
  assert.equal(t.draf["2"].teks, "9", "angka petugas ini tidak hilang saat konflik"); assert.equal(t.konflik["2"].counted, 11); assert.equal(t.baris[1].counted, 10, "angka orang lain belum menimpa baris sebelum dipilih");
  assert.equal(t.galatBaris["3"], "Jumlah harus angka");
});

test("terapkanHasilMulai: DIMULAI / SUDAH_DIMULAI mengisi waktu pengamatan (tidak menggeser waktu orang lain); DITOLAK jadi pesan; baris sedang dihitung", () => {
  const baris = [B("1", "A1"), B("2", "A2"), B("3", "A3", { counted: 3 })];
  const t = terapkanHasilMulai(baris, [{ lineId: "1", status: "DIMULAI", observedAt: JAM, observedSource: "MULAI", oleh: { id: "u1", nama: "Nadya" } }, { lineId: "2", status: "SUDAH_DIMULAI", observedAt: "2026-11-01T02:00:00.000Z", observedSource: "MULAI", oleh: { id: "u2", nama: "Rika" } }, { lineId: "3", status: "DITOLAK", pesan: "Bahan ini sudah punya angka" }]);
  assert.equal(t.baris[0].observedAt, JAM); assert.equal(t.baris[0].sedangDihitung, true); assert.equal(t.baris[0].observedBy.nama, "Nadya"); assert.equal(t.baris[1].observedAt, "2026-11-01T02:00:00.000Z"); assert.equal(t.baris[1].observedBy.nama, "Rika"); assert.equal(t.galatBaris["3"], "Bahan ini sudah punya angka"); assert.equal(t.baris[2].observedAt, null);
});

test("teksWaktuBaris: dihitung ≠ disimpan; waktu tidak diketahui dinyatakan terang-terangan (tidak diganti waktu simpan); sedang dihitung; belum dihitung", () => {
  const fmt = (b) => teksWaktuBaris(b);
  assert.match(fmt(B("1", "A", { counted: 5, observedAt: "2026-11-01T03:00:00Z", savedAt: "2026-11-01T03:40:00Z", countedBy: { nama: "Nadya" } })), /Dihitung .* · disimpan .* oleh Nadya/);
  const tanpa = fmt(B("1", "A", { counted: 5, savedAt: "2026-11-01T03:40:00Z", countedBy: { nama: "Nadya" } })); assert.match(tanpa, /^Waktu hitung belum diketahui · disimpan/); assert.doesNotMatch(tanpa, /^Dihitung/);
  assert.match(fmt(B("1", "A", { observedAt: "2026-11-01T03:00:00Z" })), /^Sedang dihitung sejak/); assert.equal(fmt(B("1", "A")), "belum dihitung"); assert.equal(fmt(B("1", "A", { excluded: true })), "dikeluarkan dari sesi");
});

test("konversi waktu input datetime-local ↔ ISO; kelas pergerakan: hanya SESUDAH_DISIMPAN boleh massal", () => {
  const iso = inputWaktuKeIso("2026-11-01T10:05"); assert.match(iso, /^2026-11-01T\d\d:05:00\.000Z$/); assert.equal(isoKeInputWaktu(iso), "2026-11-01T10:05", "bolak-balik sama (waktu lokal perangkat)"); assert.equal(inputWaktuKeIso(""), null); assert.equal(inputWaktuKeIso("bukan"), null); assert.equal(isoKeInputWaktu("bukan"), "");
  assert.deepEqual(Object.keys(KELAS_PERGERAKAN), ["SERENTAK", "SAAT_HITUNG", "BERTANGGAL_MUNDUR", "SESUDAH_DISIMPAN"]); assert.deepEqual(Object.entries(KELAS_PERGERAKAN).filter(([, v]) => v.massal).map(([k]) => k), ["SESUDAH_DISIMPAN"]);
});

test("antrean kartu HP dibekukan saat penyaring berubah (urutan tidak bergeser ketika baris disimpan); teks progres", () => {
  const baris = [B("1", "A1"), B("2", "A2"), B("3", "A3", { counted: 1 })];
  assert.deepEqual(bekukanAntrean(baris, { tab: "belum" }), ["1", "2"]);
  assert.equal(teksProgres({ total: 360, dihitung: 142, persen: 39.4 }), "142 dari 360 bahan dihitung (39,4%)"); assert.equal(teksProgres({ total: 0 }), "Belum ada bahan di sesi");
  assert.deepEqual(Object.keys(MODE_LABEL), ["FULL", "GROUP", "ITEMS"]);
});

test("struktur: tiga pilihan cakupan + pratinjau (bahan dilacak/tidak dilacak, tanpa pengecualian per nama kategori); halaman kerja terpisah (bukan modal) dengan Mulai hitung, pertanyaan waktu, simpan bertahap, tab, pencarian, kartu HP; tinjauan menampilkan tiga waktu dan semua pergerakan; tidak ada saldo/auto-isi", () => {
  const buat = baca("features/warehouse/opname/BuatSesiOpname.jsx");
  for (const k of ["data-testid={`mode-${k}`}", "Opname penuh", "pratinjau-cakupan", "pratinjau-belum-kelompok", "pratinjau-nonaktif", "pratinjau-pengecualian", "pratinjau-tak-dilacak", 'data-testid="centang-ikutkan"', 'data-testid="alasan-ikutkan"', "sesi-penuh-aktif", 'data-testid="centang-bahan"', 'data-testid="buat-sesi"', "pratinjauCakupanOpname"]) assert.ok(buat.includes(k), k);
  assert.match(buat, /FokusOverlay/); assert.doesNotMatch(buat, /<Modal/); assert.doesNotMatch(buat, /pengecualian-jenis|excludeJenis/, "cakupan tidak diputuskan dari nama kategori");
  const kerja = baca("pages/warehouse/WarehouseOpnameKerja.jsx");
  for (const k of ["TAB", 'data-testid="cari-kerja"', 'data-testid="simpan-perubahan"', 'data-testid="simpan-berikutnya"', 'data-testid="kartu-hp"', 'data-testid="progres-kelompok"', 'data-testid="serahkan-hitungan"', "simpanHasilOpname", "beforeunload", "PanelDiLuarCakupan", "mulaiHitungBahanOpname", "DialogWaktuHitung", "PengamatanBaris", 'data-testid="mulai-semua-tampil"', 'data-testid="salah-ketik"']) assert.ok(kerja.includes(k), k);
  assert.doesNotMatch(kerja, /systemQty|saldoSistem|pembanding/, "halaman hitung tidak membawa saldo sistem"); assert.doesNotMatch(kerja, /api\.completeStockCount/, "menyimpan hitungan tidak menyelesaikan sesi");
  const baris = baca("features/warehouse/opname/BarisHitung.jsx"); for (const k of ['data-testid="mulai-bahan"', 'data-testid="waktu-tidak-diketahui"', 'data-testid="ubah-waktu"', 'data-testid="alasan-waktu"', "koreksiWaktuHitungOpname", "waktu-baru-saja", "waktu-simpan-tanpa", "Tekan tepat sebelum menghitung"]) assert.ok(baris.includes(k), k);
  const logic = baca("features/warehouse/opname/opnameLogic.js"); assert.doesNotMatch(logic, /systemQty/, "tidak ada isian otomatis dari saldo"); assert.doesNotMatch(logic, /savedAt\s*\|\|\s*|observedAt\s*=\s*b\.savedAt/, "waktu hitung tidak diturunkan dari waktu simpan");
  const reg = baca("routes/pageRegistry.jsx"); assert.match(reg, /"\/warehouse\/stock-count\/:id\/hitung"/);
  const det = baca("features/warehouse/dokumen/OpnameDetail.jsx"); assert.match(det, /r\.modelVersion === 2/); assert.match(det, /OpnameSesiTinjau/);
  const list = baca("pages/warehouse/WarehouseStockCount.jsx"); assert.match(list, /BuatSesiOpname/); assert.doesNotMatch(list, /StockCountFormModal/); assert.match(list, /dipilih manual \(sesi lama\)/);
  const tinjau = baca("features/warehouse/opname/OpnameSesiTinjau.jsx"); for (const k of ["waktu-hitung", "waktu-simpan", "saldo-sebanding", "transaksi-relevan", 'data-testid="selisih"', "alasan-selisih", "hanya-selisih", 'data-testid="tanda-massal"', 'data-testid="tanda-sudah"', 'data-testid="tanda-belum"', "kelas-pergerakan", "daftar-tak-dilacak"]) assert.ok(tinjau.includes(k), k);
  assert.doesNotMatch(tinjau, /jendelaRagu|jendela ragu|JENDELA/i, "tidak ada lagi jendela tetap");
});
