// Nilai Persediaan — logika tampilan MURNI (tanpa DOM). Mengunci: pengecualian tidak pernah ditulis Rp0, belum diketahui ≠ 0, satu sumber cakupan, penyaring, waktu WIB, dan pembeda KPI lama.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  teksSaldo, teksRupiah, teksHarga, teksWaktuWIB, kalimatCakupan, saringBaris, opsiFilter, segmenCakupan, STATUS_PENGECUALIAN, STATUS_TEKS, FILTER_SEMUA, FILTER_PENGECUALIAN, TEKS_NILAI_PARSIAL, TEKS_BELUM_FINAL, periksaFormHasilSO, bangunBodyHasilSO, ringkasHasilSO, teksTanggalSO, ringkasVerifikasiNol, TEKS_RINCIAN_NOL,
} from "../src/features/warehouse/nilaiPersediaan/nilaiPersediaanLogic.js";

const B = (status, o = {}) => ({ materialId: `${status}-${o.kode ?? 1}`, kode: "K1", nama: "Bahan Satu", satuan: "KG", status, saldo: 1, nilai: null, harga: null, ...o });
const cakupan = { universe: 8, saldoNol: 1, relevan: 7, dinilai: 2, pengecualian: 5, persenDinilai: 28.6, perStatus: { DINILAI: 2, SALDO_NOL: 1, STOK_BELUM_DIKETAHUI: 1, HARGA_KOSONG: 1, SALDO_MINUS: 1, SATUAN_TIDAK_COCOK: 1, PENGAMATAN_FISIK: 1 } };

test("L1. belum diketahui ≠ 0; nilai tidak diketahui tampil tanda hubung, bukan Rp0", () => {
  assert.equal(teksSaldo(null, "KG"), "belum diketahui"); assert.equal(teksSaldo(0, "KG"), "0 KG"); assert.equal(teksSaldo(1234.5, "M"), "1.234,5 M");
  assert.equal(teksRupiah(null), "—"); assert.equal(teksRupiah(undefined), "—"); assert.equal(teksRupiah(0), "Rp0", "nol sah memang Rp0"); assert.equal(teksRupiah(219087111), "Rp219.087.111");
  assert.equal(teksHarga({ nilai: null }, "KG"), null); assert.equal(teksHarga({ nilai: 5000, satuan: "KG" }, "KG"), "Rp5.000 / KG");
});
test("L2. cakupan satu kalimat dari satu sumber; relevan & pengecualian konsisten", () => {
  assert.equal(kalimatCakupan(cakupan), "2 dari 7 bahan relevan dinilai (28,6%) · 5 belum dinilai"); assert.equal(kalimatCakupan(null), "");
  assert.equal(cakupan.dinilai + cakupan.pengecualian, cakupan.relevan); assert.equal(cakupan.relevan + cakupan.saldoNol, cakupan.universe);
});
test("L3. penyaring: pengecualian (bawaan) tidak memuat DINILAI/SALDO_NOL; SEMUA memuat semuanya; pencarian kode/nama", () => {
  const baris = [B("DINILAI", { kode: "A" }), B("SALDO_NOL", { kode: "B" }), B("STOK_BELUM_DIKETAHUI", { kode: "C", nama: "Benang Halus" }), B("HARGA_KOSONG", { kode: "D" }), B("SALDO_MINUS", { kode: "E" }), B("SATUAN_TIDAK_COCOK", { kode: "F" }), B("PENGAMATAN_FISIK", { kode: "G" })];
  assert.deepEqual(saringBaris(baris).map((b) => b.kode), ["C", "D", "E", "F", "G"]); assert.equal(saringBaris(baris, { filter: FILTER_SEMUA }).length, 7);
  assert.deepEqual(saringBaris(baris, { filter: "SALDO_MINUS" }).map((b) => b.kode), ["E"]); assert.deepEqual(saringBaris(baris, { filter: FILTER_SEMUA, cari: "benang" }).map((b) => b.kode), ["C"]);
  assert.equal(saringBaris(undefined).length, 0); assert.ok(STATUS_PENGECUALIAN.every((s) => STATUS_TEKS[s]));
});
test("L4. opsi penyaring & strip menampilkan SEMUA status yang ada (tidak ada yang hilang), total strip = 100%", () => {
  const o = opsiFilter(cakupan); assert.equal(o[0].kode, FILTER_PENGECUALIAN); assert.equal(o[0].jumlah, 5); assert.equal(o[1].kode, FILTER_SEMUA); assert.equal(o[1].jumlah, 8);
  assert.equal(o.slice(2).reduce((a, x) => a + x.jumlah, 0), 8); const seg = segmenCakupan(cakupan); assert.equal(seg.length, 7); assert.ok(Math.abs(seg.reduce((a, s) => a + s.persen, 0) - 100) < 1e-9);
  assert.deepEqual(segmenCakupan({ universe: 0, perStatus: {} }), []);
});
test("L5. waktu selalu WIB, tidak bergantung zona peramban", () => {
  assert.equal(teksWaktuWIB("2026-11-04T18:10:00Z"), "5 Nov 2026 01:10 WIB"); assert.equal(teksWaktuWIB("2026-11-03T15:00:00.000Z"), "3 Nov 2026 22:00 WIB"); assert.equal(teksWaktuWIB("bukan tanggal"), "—");
});
test("L6. KPI angka ketiga hilang dari ringkasan utama (Laporan Gudang) dan hanya ada sebagai rincian Finance dengan definisi", () => {
  const rep = fs.readFileSync(new URL("../src/pages/warehouse/WarehouseReports.jsx", import.meta.url), "utf8"); assert.ok(!/inventoryValuePartial/.test(rep), "kartu KPI lama dihapus dari Laporan Gudang"); assert.ok(!/label=.{0,3}Inventory Value/.test(rep), "tidak ada kartu berlabel Inventory Value");
  const pg = fs.readFileSync(new URL("../src/pages/warehouse/WarehouseNilaiPersediaan.jsx", import.meta.url), "utf8"); assert.ok(/Nilai parsial berdasarkan biaya penerimaan terakhir/.test(pg)); assert.ok(/TEKS_NILAI_PARSIAL/.test(pg)); assert.match(TEKS_NILAI_PARSIAL, /biaya penerimaan terakhir/); assert.match(TEKS_NILAI_PARSIAL, /Bukan Estimasi nilai stok/);
  const kartu = pg.slice(pg.indexOf('data-testid="np-kartu"'), pg.indexOf('data-testid="np-cakupan"')); assert.ok(!/nilaiParsial/.test(kartu), "nilai parsial tidak di kartu utama"); assert.match(TEKS_BELUM_FINAL, /bukan hasil stok fisik final/);
});
test("L6b. pengamatan: 'terukur dalam ROLL, belum terukur dalam satuan stok'; label nol dikonfirmasi; kartu 1 memuat dua estimasi + status belum direkonsiliasi", () => {
  const pg = fs.readFileSync(new URL("../src/pages/warehouse/WarehouseNilaiPersediaan.jsx", import.meta.url), "utf8");
  assert.ok(/terukur: {b.pengamatan} · belum terukur dalam {b.satuan}/.test(pg)); assert.ok(/fisik nol dikonfirmasi Owner, belum disahkan melalui Stock Count/.test(pg)); assert.ok(/Belum direkonsiliasi dengan hasil SO/.test(pg)); assert.ok(/Tanpa hasil SO bermasalah/.test(pg)); assert.ok(/nilaiLedger/.test(pg) && /nilaiTanpaHasilSOBermasalah/.test(pg));
  assert.equal(STATUS_TEKS.PENGAMATAN_FISIK, "Terukur dalam satuan lain");
});
test("L6c. form hasil SO: validasi ringan & badan permintaan (jam SO tidak dikirim, satuan nol tidak dikirim, koreksi menunjuk catatan terkini)", () => {
  const ok = { jenis: "PENGAMATAN_SATUAN", jumlah: "13,5", satuan: "roll", soTanggal: "2026-11-04", sumber: "KIRIM GILANG.xlsx O4", alasan: "Hasil SO terukur dalam roll" };
  assert.deepEqual(periksaFormHasilSO(ok, { satuanStok: "METER" }), {}); assert.ok(periksaFormHasilSO({ ...ok, satuan: "meter" }, { satuanStok: "METER" }).satuan); assert.ok(periksaFormHasilSO({ ...ok, jumlah: "0" }, { satuanStok: "METER" }).jumlah);
  assert.ok(periksaFormHasilSO({ ...ok, soTanggal: "" }, {}).soTanggal && periksaFormHasilSO({ ...ok, sumber: "x" }, {}).sumber && periksaFormHasilSO({ ...ok, alasan: "pendek" }, {}).alasan);
  const b = bangunBodyHasilSO(ok, { materialId: "m1" }).baris[0]; assert.equal(b.jumlah, 13.5); assert.equal(b.satuan, "ROLL"); assert.ok(!("soWaktu" in b), "jam SO tidak ditebak"); assert.ok(!("menggantikanId" in b));
  const nol = bangunBodyHasilSO({ ...ok, jenis: "NOL_DIKONFIRMASI" }, { materialId: "m2", hasilSO: { id: "so-lama" } }).baris[0]; assert.equal(nol.jumlah, 0); assert.ok(!("satuan" in nol)); assert.equal(nol.menggantikanId, "so-lama");
  assert.deepEqual(periksaFormHasilSO({ jenis: "NOL_DIKONFIRMASI", soTanggal: "2026-11-04", sumber: "abc", alasan: "Sel kosong = sudah dicek" }, {}), {});
});
test("L7. halaman: tidak menghitung nilai sendiri dan tidak menulis (hanya GET), kelas .nip- tidak bentrok dengan kelas lain, rute & navigasi terdaftar", () => {
  const p = fs.readFileSync(new URL("../src/pages/warehouse/WarehouseNilaiPersediaan.jsx", import.meta.url), "utf8");
  assert.ok(!/\.nilai\s*[*+-]\s|reduce\(/.test(p.replace(/d\.finance\.bukti\.rincian\.slice/g, "")), "halaman tidak menjumlah/mengalikan nilai"); assert.ok(/api\.getNilaiPersediaan\(\)/.test(p)); assert.ok(!/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(p));
  const css = fs.readFileSync(new URL("../src/styles/sanss-gudang-nilai.css", import.meta.url), "utf8"); const kelas = [...css.matchAll(/\.(nip-[a-z0-9-]+)/g)].map((m) => m[1]); assert.ok(kelas.length > 20);
  const lain = fs.readdirSync(new URL("../src/styles/", import.meta.url)).filter((f) => f.endsWith(".css") && f !== "sanss-gudang-nilai.css"); for (const f of lain) { const t = fs.readFileSync(new URL(`../src/styles/${f}`, import.meta.url), "utf8"); assert.ok(!/\.nip-/.test(t), `${f} sudah memakai prefiks nip-`); }
  const reg = fs.readFileSync(new URL("../src/routes/pageRegistry.jsx", import.meta.url), "utf8"); assert.ok(/path: "\/warehouse\/nilai-persediaan"/.test(reg));
  const lay = fs.readFileSync(new URL("../src/components/Layout.jsx", import.meta.url), "utf8"); assert.ok(/to: "\/warehouse\/nilai-persediaan"/.test(lay));
});

test("L8. sumber SO tidak dianggap mewakili saldo sekarang: tanggal sumber, status rekonsiliasi, dan pergerakan sesudahnya tampil; kedaluwarsa ditandai", () => {
  assert.equal(teksTanggalSO("2026-11-04"), "4 Nov 2026"); assert.equal(teksTanggalSO(null), "—");
  const baru = ringkasHasilSO({ soTanggal: "2026-11-04", statusTeks: "Fisik nol dikonfirmasi Owner, belum disahkan melalui Stock Count", status: "BELUM_DISAHKAN_STOCK_COUNT", kedaluwarsa: false, pergerakanSesudah: { jumlah: 0, net: 0 } });
  assert.match(baru.teks, /Hasil SO 4 Nov 2026/); assert.match(baru.teks, /belum disahkan melalui Stock Count/); assert.match(baru.teks, /tidak ada pergerakan sesudahnya/); assert.equal(baru.kedaluwarsa, false);
  const lama = ringkasHasilSO({ soTanggal: "2026-11-04", statusTeks: "Tidak lagi mewakili saldo sekarang (ada pergerakan sesudah tanggal SO)", status: "KEDALUWARSA_PERGERAKAN_BARU", kedaluwarsa: true, pergerakanSesudah: { jumlah: 3, net: 12.5 } });
  assert.equal(lama.kedaluwarsa, true); assert.match(lama.teks, /3 pergerakan sesudahnya \(net 12,5\)/); assert.match(lama.teks, /Tidak lagi mewakili saldo sekarang/);
  assert.equal(ringkasHasilSO({ soTanggal: "2026-11-04", status: "TERBUKA_SATUAN", statusTeks: "Pengecualian satuan masih terbuka", pergerakanSesudah: { jumlah: 0, net: 0 } }).terbuka, true); assert.equal(ringkasHasilSO(null), null);
  const pg = fs.readFileSync(new URL("../src/pages/warehouse/WarehouseNilaiPersediaan.jsx", import.meta.url), "utf8"); assert.ok(/data-testid="np-so"/.test(pg) && /Kedaluwarsa/.test(pg) && /pengecualian satuan masih terbuka/.test(pg) && /belum disahkan melalui Stock Count/.test(pg)); assert.ok(!/Nol terverifikasi/.test(pg), "tidak ada badge Nol terverifikasi di halaman");
});

test("L9. rincian verifikasi nol: Koreksi Saldo (dokumen + tanggal SO bila ditautkan) dibedakan dari Stock Count; tampil di halaman", () => {
  const ks = ringkasVerifikasiNol({ sumber: "KOREKSI_SALDO", nomor: "ADJ-051126-02", soTanggal: "2026-11-04", label: "Nol terverifikasi — Koreksi Saldo ADJ-051126-02 (diposting 5 Nov 2026; SO 4 Nov 2026)" });
  assert.equal(ks.sumber, "Koreksi Saldo"); assert.equal(ks.dokumen, "ADJ-051126-02"); assert.equal(ks.tanggalSO, "4 Nov 2026"); assert.match(ks.label, /Koreksi Saldo/);
  assert.equal(ringkasVerifikasiNol({ sumber: "KOREKSI_SALDO", nomor: "ADJ-1", soTanggal: null }).tanggalSO, "belum ditautkan");
  const sc = ringkasVerifikasiNol({ sumber: "STOCK_COUNT", nomor: "SC-1" }); assert.equal(sc.sumber, "Stock Count"); assert.equal(sc.tanggalSO, null); assert.equal(ringkasVerifikasiNol(null), null);
  assert.equal(TEKS_RINCIAN_NOL, "Rincian verifikasi nol");
  const pg = fs.readFileSync(new URL("../src/pages/warehouse/WarehouseNilaiPersediaan.jsx", import.meta.url), "utf8"); assert.ok(/data-testid="np-verif-nol"/.test(pg) && /TEKS_RINCIAN_NOL/.test(pg));
});

test("pemisahan: kuantitas ledger, nol Owner, dan harga dinyatakan terpisah; dokumen harga selalu 'belum diverifikasi'", async () => {
  const L = await import("../src/features/warehouse/nilaiPersediaan/nilaiPersediaanLogic.js");
  const k = L.kalimatKuantitas({ universe: 384, diketahuiDiLedger: 171, persenDiketahuiDiLedger: 44.5, nolDikonfirmasiOwnerBelumDiLedger: 178, tidakDiketahui: 35 });
  assert.match(k, /171 dari 384 bahan \(44,5%\)/); assert.match(k, /fisik nol dikonfirmasi Owner \(belum di ledger\): 178/); assert.match(k, /tanpa catatan stok: 35/);
  const h = L.kalimatHarga({ bahanBersaldoPositif: 88, denganHargaSatuanCocok: 72, persenDenganHarga: 81.8, tanpaHarga: 16 });
  assert.match(h, /72 dari 88 bahan bersaldo/); assert.match(h, /81,8%/);
  assert.equal(L.teksDokumenHarga({ dokumen: { tipe: "CSV", teks: "CSV GILANG, baris 365" } }), "Dokumen: CSV GILANG, baris 365 · belum diverifikasi");
  assert.equal(L.teksDokumenHarga({}), "Dokumen: tidak tercatat · belum diverifikasi"); assert.equal(L.teksDokumenHarga(null), "");
  assert.match(L.TEKS_DOKUMEN_BUKAN_BUKTI, /bukan bukti biaya perolehan/);
});
