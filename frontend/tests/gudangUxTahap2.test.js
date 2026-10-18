// UX Gudang Tahap 2 (frontend) — Pengeluaran Material & Transfer Stok: logika murni + kontrak struktur layar (tanpa DOM). Status/aksi diputuskan SERVER (tampilan); tes backend: gudangUxTahap2.integration.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cakupanBatasMinimum, kalimatCakupanBatasMinimum, TAHAP_FILTER_MI, TAHAP_FILTER_ST, filterTahap, hitungPerTahap, teksCariMI, teksCariST, cocokCari, galatJumlah, dampakKeluar, dampakKirim, dampakTerima, adaSelisihTerima, adaKurangStok, kalimatKetersediaan, angka,
} from "../src/features/warehouse/dokumen/dokumenLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(dir, "../src", rel), "utf8").replace(/\r\n/g, "\n");
const mat = (code, name, unit = "PCS") => ({ code, name, unit });
const mi = (id, status, lines = []) => ({ id, status, issueNumber: `MI-${id}`, department: "Produksi", lines });

test("filter tahap MI: Draf / Menunggu / Disetujui & disiapkan (3 status) / Dikeluarkan / Dibatalkan; hitungan konsisten", () => {
  const rows = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED", "ISSUED", "CANCELLED"].map((s) => mi(s, s));
  assert.deepEqual(filterTahap(TAHAP_FILTER_MI, rows, "disiapkan").map((r) => r.status), ["APPROVED", "READY_TO_PICK", "PICKED"]);
  assert.equal(filterTahap(TAHAP_FILTER_MI, rows, "draf").length, 1); assert.equal(filterTahap(TAHAP_FILTER_MI, rows, "").length, 7); assert.equal(filterTahap(TAHAP_FILTER_MI, rows, "tidak-ada").length, 7);
  const h = hitungPerTahap(TAHAP_FILTER_MI, rows); assert.equal(h[""], 7); assert.equal(h.disiapkan, 3); assert.equal(h.selesai, 1); assert.equal(h.batal, 1);
  // setiap status tepat satu tab (selain Semua) — tidak ada dokumen yang hilang dari hitungan
  assert.equal(Object.entries(h).filter(([k]) => k).reduce((a, [, n]) => a + n, 0), 7);
});

test("filter tahap ST: Dalam perjalanan berdiri sendiri; Disetujui & disiapkan = APPROVED + PICKED", () => {
  const rows = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "PICKED", "IN_TRANSIT", "COMPLETED", "CANCELLED"].map((s) => ({ id: s, status: s }));
  assert.deepEqual(filterTahap(TAHAP_FILTER_ST, rows, "jalan").map((r) => r.status), ["IN_TRANSIT"]);
  assert.deepEqual(filterTahap(TAHAP_FILTER_ST, rows, "disiapkan").map((r) => r.status), ["APPROVED", "PICKED"]);
  const h = hitungPerTahap(TAHAP_FILTER_ST, rows); assert.equal(Object.entries(h).filter(([k]) => k).reduce((a, [, n]) => a + n, 0), 7);
});

test("pencarian: nomor, bahan, unit/order/pelanggan, departemen, lokasi — semua kata harus cocok", () => {
  const r = { issueNumber: "MI-181026-01", department: "Bengkel", sourceReference: "SO-77", requestedBy: { name: "Budi" }, unit: { unitCode: "U-001", order: { orderNumber: "ORD-9", customer: { name: "Ibu Sari" } } }, lines: [{ material: mat("BUSA-D18", "Busa Ocean D18") }] };
  const t = teksCariMI(r);
  for (const q of ["mi-181026", "busa", "u-001", "ord-9", "sari", "bengkel", "busa bengkel", "BUSA   d18"]) assert.ok(cocokCari(t, q), q);
  assert.ok(!cocokCari(t, "kain")); assert.ok(!cocokCari(t, "busa kain")); assert.ok(cocokCari(t, "") && cocokCari(t, "   "));
  const s = { transferNumber: "ST-1", sourceLocation: { code: "RM-A1" }, destinationLocation: { code: "FG-B2" }, lines: [{ material: mat("K1", "Kain") }] };
  assert.ok(cocokCari(teksCariST(s), "rm-a1 fg-b2")); assert.ok(!cocokCari(teksCariST(s), "busa"));
});

test("galat isian jumlah: wajib, angka, > 0 (diterima boleh 0), koma desimal", () => {
  const baris = [{ id: "a", material: mat("A", "A") }, { id: "b", material: mat("B", "B") }];
  assert.match(galatJumlah(baris, { a: "1" }), /B wajib diisi/); assert.match(galatJumlah(baris, { a: "1", b: "x" }), /tidak valid/);
  assert.match(galatJumlah(baris, { a: "1", b: "0" }), /lebih dari 0/); assert.match(galatJumlah(baris, { a: "1", b: "-2" }), /lebih dari 0/);
  assert.equal(galatJumlah(baris, { a: "1", b: "0" }, { boleh0: true }), ""); assert.match(galatJumlah(baris, { a: "1", b: "-1" }, { boleh0: true }), /0 atau lebih/);
  assert.equal(galatJumlah(baris, { a: "1,5", b: "2" }), ""); assert.equal(angka("1,5"), 1.5);
});

test("dampak stok: keluar (jumlah dioverride), kirim (saldo berkurang), terima (selisih TIDAK masuk saldo)", () => {
  const ml = [{ id: "a", requestedQty: 10, material: mat("BUSA", "Busa") }];
  assert.match(dampakKeluar(ml, {})[0], /BUSA: stok berkurang 10 PCS$/); assert.match(dampakKeluar(ml, { a: "8" })[0], /stok berkurang 8 PCS \(diminta 10\)/);
  const tl = [{ id: "a", qtySent: 8, material: mat("BUSA", "Busa") }];
  assert.match(dampakKirim(tl)[0], /saldo berkurang 8 PCS saat dikirim/);
  assert.match(dampakTerima(tl, {})[0], /saldo bertambah 8 PCS$/); assert.match(dampakTerima(tl, { a: "7" })[0], /saldo bertambah 7 PCS — selisih 1 dari 8 yang dikirim TIDAK masuk saldo/); assert.match(dampakTerima(tl, { a: "9" })[0], /lebih 1/);
  assert.equal(adaSelisihTerima(tl, {}), false); assert.equal(adaSelisihTerima(tl, { a: "7" }), true);
});

test("ketersediaan: peringatan hanya bila cukup === false; saldo belum diketahui dijujurkan", () => {
  assert.equal(adaKurangStok([{ cukup: true }, { cukup: null }]), false); assert.equal(adaKurangStok([{ cukup: true }, { cukup: false }]), true);
  assert.equal(kalimatKetersediaan(null), "Saldo belum diketahui"); assert.equal(kalimatKetersediaan({ saldo: null }), "Saldo belum diketahui");
  assert.match(kalimatKetersediaan({ saldo: 50, dicadangLain: 45, tersedia: 5 }, "pcs"), /Saldo total 50 pcs · dicadangkan dokumen lain 45 pcs · tersedia 5 pcs/);
});

test("layar: halaman detail MI & ST memakai tampilan server, AksiDokumen, AlurPenerimaan, KartuJalurKoreksi, jejak; tanpa tombol Edit umum dan tanpa klaim saldo per lokasi", () => {
  for (const f of ["features/warehouse/dokumen/MaterialIssueDetail.jsx", "features/warehouse/dokumen/TransferDetail.jsx"]) {
    const s = baca(f);
    assert.match(s, /AksiDokumen/, f); assert.match(s, /AlurPenerimaan/, f); assert.match(s, /KartuJalurKoreksi/, f); assert.match(s, /JejakDokumen/, f); assert.match(s, /TabelItemDokumen/, f);
    assert.match(s, /\.tampilan/, `${f}: status dari server`); assert.match(s, /izin\?\.tulis === false/, `${f}: akun hanya-lihat`);
    assert.match(s, /belum menyimpan saldo per lokasi/, `${f}: tidak menyajikan lokasi sebagai saldo per lokasi`);
    assert.doesNotMatch(s, />\s*Edit\s*</, `${f}: tidak ada tombol Edit umum`); assert.doesNotMatch(s, /window\.confirm/, `${f}: konfirmasi dampak lewat panel, bukan confirm()`);
  }
  const m = baca("features/warehouse/dokumen/MaterialIssueDetail.jsx");
  assert.match(m, /tipe="MATERIAL_ISSUE"/); assert.match(m, /api\.issueMaterialIssue/); assert.match(m, /api\.buatUlangMaterialIssue/); assert.match(m, /dampakKeluar/); assert.match(m, /KONFIRMASI_KELUAR/);
  const t = baca("features/warehouse/dokumen/TransferDetail.jsx");
  assert.match(t, /tipe="STOCK_TRANSFER"/); assert.match(t, /api\.dispatchStockTransfer/); assert.match(t, /api\.receiveStockTransfer/); assert.match(t, /api\.buatUlangStockTransfer/); assert.match(t, /dampakTerima/); assert.match(t, /TIDAK masuk saldo|tidak masuk saldo/i);
});

test("daftar: halaman, tab tahap berhitung, pencarian, kartu HP, ?buka= lama diarahkan ke halaman detail; drawer lama dihapus", () => {
  for (const [f, rute] of [["pages/warehouse/WarehouseMaterialIssue.jsx", "/warehouse/material-issue/"], ["pages/warehouse/WarehouseTransfers.jsx", "/warehouse/transfers/"]]) {
    const s = baca(f);
    assert.match(s, /FilterTahapDokumen/, f); assert.match(s, /md:hidden/, `${f}: kartu HP`); assert.match(s, /hidden md:block/, `${f}: tabel desktop`); assert.ok(s.includes(rute), `${f}: ke halaman detail`);
    assert.match(s, /sp\.get\("buka"\)/, `${f}: tautan lama`); assert.doesNotMatch(s, /DetailDrawer/, `${f}: tanpa drawer`);
  }
  assert.ok(!fs.existsSync(path.join(dir, "../src/features/warehouse/components/MaterialIssueDetailDrawer.jsx"))); assert.ok(!fs.existsSync(path.join(dir, "../src/features/warehouse/components/StockTransferDetailDrawer.jsx")));
  const reg = baca("routes/pageRegistry.jsx"); assert.match(reg, /\/warehouse\/material-issue\/:id/); assert.match(reg, /\/warehouse\/transfers\/:id/);
  assert.match(baca("lib/tabTitles.js"), /"material-issue": "Pengeluaran"/); assert.match(baca("components/Topbar.jsx"), /\/warehouse\/material-issue\/.*Detail/s);
  for (const f of ["features/finance/JejakBiayaBahan.jsx", "features/warehouse/components/JejakPemakaianPenerimaan.jsx"]) assert.doesNotMatch(baca(f), /material-issue\?buka=/, `${f}: tautan langsung ke detail`);
});

test("form pembuatan mengembalikan dokumen baru ke pemanggil (diarahkan ke halaman detail)", () => {
  assert.match(baca("features/warehouse/components/MaterialIssueFormModal.jsx"), /onCreated\(baru\)/); assert.match(baca("features/warehouse/components/StockTransferFormModal.jsx"), /onCreated\(baru\)/);
});

test("AksiDokumen mendukung ringkasan dampak, catatan, galat panel, bidang pilih/area; ikon aksi baru", () => {
  const s = baca("features/warehouse/aksi/AksiDokumen.jsx");
  assert.match(s, /panel\.ringkasan/); assert.match(s, /panel\.catatan/); assert.match(s, /panel\.galat/); assert.match(s, /b\.tipe === "pilih"/); assert.match(s, /b\.tipe === "area"/);
  for (const k of ["KONFIRMASI_KELUAR", "KIRIM", "TERIMA", "BUAT_ULANG_TRANSFER"]) assert.ok(s.includes(k), k);
});

test("filter tahap daftar Gudang memakai useTahapFilter (replaceActivePath), BUKAN setSearchParams — tab workspace memakai lokasi virtual sehingga perubahan query-saja tidak sampai ke halaman", () => {
  const hook = baca("features/warehouse/dokumen/useTahapFilter.js");
  assert.match(hook, /replaceActivePath/); assert.match(hook, /useState\(sp\.get\("tahap"\)/);
  for (const f of ["pages/warehouse/WarehouseMaterialIssue.jsx", "pages/warehouse/WarehouseTransfers.jsx", "pages/warehouse/WarehouseGoodsReceipt.jsx"]) {
    const s = baca(f);
    assert.match(s, /useTahapFilter\(\)/, f); assert.doesNotMatch(s, /setSp\(/, `${f}: tidak boleh memakai setSearchParams untuk filter`);
  }
});

test("Restok: saran kosong tidak dibaca sebagai stok aman — kalimat memuat cakupan batas minimum; tab berbahasa Indonesia", () => {
  const rows = [{ aktif: true, batasMinimum: null }, { aktif: true, batasMinimum: 5 }, { aktif: true, batasMinimum: null }, { aktif: false, batasMinimum: null }];
  const c = cakupanBatasMinimum(rows); assert.deepEqual(c, { total: 3, diatur: 1, belum: 2 });
  assert.match(kalimatCakupanBatasMinimum(c), /2 dari 3 bahan aktif belum punya batas minimum.*BUKAN bukti semua stok aman/);
  assert.match(kalimatCakupanBatasMinimum({ total: 5, diatur: 0, belum: 5 }), /belum diatur untuk satu pun dari 5 bahan aktif/);
  assert.match(kalimatCakupanBatasMinimum({ total: 4, diatur: 4, belum: 0 }), /semua bahan aktif sudah punya batas minimum/); assert.equal(kalimatCakupanBatasMinimum({ total: 0, diatur: 0, belum: 0 }), null);
  const r = baca("pages/warehouse/WarehouseReplenishment.jsx"); assert.ok(r.includes("kalimatCakupanBatasMinimum(cakupan)")); assert.doesNotMatch(r, /Tidak ada item yang perlu direstok saat ini/);
  const lab = baca("features/warehouse/dokumen/labelDokumen.js");
  for (const k of ["Terjadwal", "Sedang dihitung", "Menunggu tinjauan", "Menunggu persetujuan", "Disetujui & dipesan", "Dicatat & diterima", "Diperiksa", "Dilaporkan", "Diposting"]) assert.ok(lab.includes(`"${k}"`), k);
  assert.doesNotMatch(lab, /"(Waiting Approval|Waiting Review|In Progress|Under Inspection|Scheduled|Reported|Resolved)"/);
  for (const f of ["pages/warehouse/WarehouseStockCount.jsx", "pages/warehouse/WarehouseReplenishment.jsx", "features/warehouse/components/ReturnsTab.jsx", "features/warehouse/components/DamagedStockTab.jsx", "features/warehouse/components/AdjustmentsTab.jsx"]) { const src = baca(f); assert.match(src, /DaftarSederhana/, f); assert.doesNotMatch(src, /DetailDrawer/, f); assert.match(src, /md:hidden|DaftarSederhana/, f); }
});

test("judul tab workspace & sub-tab Barang Rusak/Retur berbahasa Indonesia", () => {
  const t = baca("lib/tabTitles.js"); for (const k of ["Restok", "Stock Opname", "Barang Rusak & Retur", "Pengeluaran Material", "Transfer Stok"]) assert.ok(t.includes(`return "${k}"`), k);
  const a = baca("pages/warehouse/WarehouseAdjustments.jsx"); for (const k of ["Barang Rusak", "Retur", "Penyesuaian Stok"]) assert.ok(a.includes(`>${k}</TabsTrigger>`), k);
  assert.doesNotMatch(a, />(Damaged Stock|Returns|Stock Adjustment)<\/TabsTrigger>/);
});

test("revisi & konflik: semua aksi MI/ST mengirim revisi dokumen; konflik memuat ulang keadaan terbaru; api memuat jalur ubah isi/kembalikan/selisih", () => {
  const api = baca("api.js");
  for (const f of ["ubahIsiMaterialIssue", "kembalikanMaterialIssue", "ubahIsiStockTransfer", "kembalikanStockTransfer", "selesaikanSelisihTransfer", "buatUlangMaterialIssue", "buatUlangStockTransfer"]) assert.match(api, new RegExp(`${f}:`), f);
  assert.match(api, /code = j\.code \?\? j\.kode/, "kode galat server (kode) ikut terbaca");
  for (const f of ["features/warehouse/dokumen/MaterialIssueDetail.jsx", "features/warehouse/dokumen/TransferDetail.jsx"]) {
    const s = baca(f);
    assert.match(s, /revisi: r\.revisi/, `${f}: revisi dikirim`); assert.match(s, /REVISI_BASI/, f); assert.match(s, /KONFLIK_PAYLOAD/, f); assert.match(s, /KEMBALIKAN/, f); assert.match(s, /UBAH_ISI/, f);
  }
  assert.match(baca("features/warehouse/components/MaterialIssueFormModal.jsx"), /api\.ubahIsiMaterialIssue\(dokumen\.id, \{\s*revisi: dokumen\.revisi/);
  assert.match(baca("features/warehouse/components/StockTransferFormModal.jsx"), /api\.ubahIsiStockTransfer\(dokumen\.id, \{ revisi: dokumen\.revisi/);
});

test("selisih transfer: penyebab wajib saat Terima berselisih; kartu saldo perjalanan & kartu selisih; penyelesaian dengan kunci permintaan; tidak ada klaim pemakaian produksi", () => {
  const t = baca("features/warehouse/dokumen/TransferDetail.jsx");
  assert.match(t, /alasanSelisih/); assert.match(t, /data-testid="kartu-saldo-perjalanan"/); assert.match(t, /data-testid="kartu-selisih"/); assert.match(t, /SELESAIKAN_SELISIH/); assert.match(t, /kunci: kunciSelisih/);
  assert.match(t, /Sebelum kirim/); assert.match(t, /Dalam perjalanan/); assert.match(t, /Sesudah terima/); assert.match(t, /BUKAN pemakaian produksi|bukan pemakaian produksi/i);
});

test("halaman detail Opname, Restok, Barang Rusak, Retur, Penyesuaian: status/aksi dari server, dampak stok di panel, tanpa tombol Edit umum, route & breadcrumb terdaftar", () => {
  const halaman = { "OpnameDetail.jsx": ["STOCK_COUNT", "SELESAIKAN_OPNAME", "blind"], "RestokDetail.jsx": ["HUBUNGKAN_PENERIMAAN", "tidak pernah"], "RusakDetail.jsx": ["DAMAGED_STOCK", "BERKURANG"], "ReturDetail.jsx": ["RETURN_RECORD", "MENAMBAH stok"], "PenyesuaianDetail.jsx": ["STOCK_ADJUSTMENT", "Pemisahan tugas"] };
  for (const [f, kata] of Object.entries(halaman)) { const s = baca(`features/warehouse/dokumen/${f}`); assert.match(s, /r\.tampilan/, f); assert.match(s, /KartuAksiDokumen/, f); assert.match(s, /JejakDokumen/, f); assert.doesNotMatch(s, />\s*Edit\s*</, f); assert.doesNotMatch(s, /window\.confirm/, f); for (const k of kata) assert.ok(s.toLowerCase().includes(k.toLowerCase()), `${f}: ${k}`); }
  const reg = baca("routes/pageRegistry.jsx"); for (const p of ["/warehouse/stock-count/:id", "/warehouse/replenishment/:id", "/warehouse/adjustments/damaged/:id", "/warehouse/adjustments/returns/:id", "/warehouse/adjustments/stock/:id"]) assert.ok(reg.includes(p), p);
  const top = baca("components/Topbar.jsx"); for (const p of ["/warehouse/stock-count/", "/warehouse/replenishment/", "/warehouse/adjustments/"]) assert.ok(top.includes(`startsWith("${p}")`), p);
  assert.match(baca("pages/warehouse/WarehouseAdjustments.jsx"), /sp\.get\("tab"\)/, "tautan kembali membuka sub-tab yang sesuai");
});

test("Restok: tautan penerimaan hanya menawarkan penerimaan yang memuat bahan permintaan; Restok tidak pernah menulis stok", () => {
  const r = baca("features/warehouse/dokumen/RestokDetail.jsx");
  assert.match(r, /l\.materialId === r\.materialId/); assert.match(r, /Stok TIDAK ditambah dari sini/); assert.match(r, /belum diatur/);
});

test("AksiDokumen: muat ulang dokumen menutup panel tetapi tidak menghapus pesan galat konflik (pesan harus terlihat pengguna)", () => {
  const s = baca("features/warehouse/aksi/AksiDokumen.jsx");
  assert.match(s, /useEffect\(\(\) => \{ setBuka\(null\); setSentuh\(false\); \}, \[ikutiVersi\]\)/); assert.doesNotMatch(s, /setBuka\(null\); setGalat\(""\)/);
});

test("konflik di MI/ST: banner halaman yang stabil (kartu aksi berpindah posisi saat status berubah) — pesan tidak hilang; AksiDokumen tidak menggandakan pesan", () => {
  for (const f of ["features/warehouse/dokumen/MaterialIssueDetail.jsx", "features/warehouse/dokumen/TransferDetail.jsx"]) {
    const s = baca(f); assert.match(s, /data-testid="banner-konflik"/, f); assert.match(s, /diam: true/, f); assert.match(s, /setKonflik\(""\); setSibuk\(true\)/, f);
  }
  assert.match(baca("features/warehouse/aksi/AksiDokumen.jsx"), /if \(!e\?\.diam\) setGalat/);
});
