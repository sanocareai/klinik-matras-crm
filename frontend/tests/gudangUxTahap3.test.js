// UX Gudang Tahap 3 — logika murni + kontrak pemasangan (sumber): kelompok bahan di Stok & Lokasi, pipeline + jendela fokus Penerimaan/PO (satu lapisan), sidebar enam kelompok.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saringStok, daftarTampil, jangkauanCari, FILTER_JENIS, kunciJenis } from "../src/features/warehouse/stok/stokLogic.js";
import { TAHAP_PIPELINE, TAHAP_TUTUP, filterTahap, hitungPerTahap, cocokCari, perluTindakan } from "../src/features/warehouse/penerimaan/penerimaanLogic.js";
import { badgeItem, antreanDariBeranda, denganBadgeGudang, kelompokAktif, kelompokTerbuka, BADGE_ANTREAN } from "../src/lib/gudangNav.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(dir, "../src", rel), "utf8").replace(/\r\n/g, "\n");
const kel = (kode, label = kode) => ({ kode, label });
const R = (kode, nama, k, over = {}) => ({ kode, nama, aktif: true, kategori: "RAW_MATERIAL", keadaan: "ADA", vendor: null, saldo: 5, kelompok: kel(k), ...over });
const baris = [R("B1", "Busa Rebonded", "BUSA"), R("B2", "Busa HR Foam", "BUSA"), R("K1", "Kain Velvet", "KAIN"), R("N1", "Benang Halus Hitam", "BELUM", { saldo: null, keadaan: "BELUM_ADA_CATATAN" }), R("G1", "Benang Gujir", "BENANG"),
  R("F1", "Kasur Sewa", "LAINNYA", { kategori: "FINISHED_GOODS" }), R("X1", "Busa Nonaktif", "BUSA", { aktif: false }), R("M1", "Kain Minus", "KAIN", { keadaan: "MINUS", saldo: -2 })];

test("saringStok: kelompok menyaring; pencarian MENCARI SEMUA BAHAN (kelompok dan jenis tidak menyaring) dan menemukan lewat nama kelompok", () => {
  assert.deepEqual(saringStok(baris, { kelompok: "BUSA" }).map((r) => r.kode), ["B1", "B2"], "nonaktif tersembunyi");
  assert.deepEqual(saringStok(baris, { kelompok: "BUSA", nonaktif: true }).map((r) => r.kode), ["B1", "B2", "X1"]);
  assert.deepEqual(saringStok(baris, { kelompok: "KAIN", cari: "benang" }).map((r) => r.kode), ["N1", "G1"], "mencari 'benang' saat Kain terpilih tetap menemukan seluruh bahan Benang & Belum dikelompokkan");
  assert.deepEqual(saringStok(baris, { kelompok: "BUSA", jenis: "FINISHED_GOODS", cari: "kasur" }).map((r) => r.kode), ["F1"], "saat mencari, jenis juga tidak menyaring");
  assert.deepEqual(saringStok(baris, { jenis: "FINISHED_GOODS" }).map((r) => r.kode), ["F1"]);
  assert.deepEqual(saringStok(baris, { kelompok: "BELUM" }).map((r) => r.kode), ["N1"]);
  assert.deepEqual(saringStok(baris, { keadaan: "MINUS" }).map((r) => r.kode), ["M1"]);
  assert.deepEqual(saringStok(baris, { tab: "FINISHED_GOODS" }).map((r) => r.kode), ["F1"], "parameter lama `tab` tetap dikenali");
  assert.equal(saringStok(baris, { cari: "belum dikelompokkan" }).length, 0, "label kelompok hanya ikut dicari bila memang ada di label");
  assert.deepEqual(saringStok([R("Z", "Z", "BELUM", { kelompok: { kode: "BELUM", label: "Belum dikelompokkan" } })], { cari: "belum dikelompokkan" }).length, 1);
});

test("daftarTampil & jangkauanCari: layar awal = navigasi (tanpa daftar); daftar muncul bila kelompok/pencarian/keadaan/jenis/semua dipilih; kalimat cakupan jujur", () => {
  assert.equal(daftarTampil({}), false); assert.equal(daftarTampil({ cari: "   " }), false);
  for (const o of [{ kelompok: "BUSA" }, { cari: "b" }, { keadaan: "MINUS" }, { jenis: "RAW_MATERIAL" }, { semua: "1" }]) assert.equal(daftarTampil(o), true, JSON.stringify(o));
  assert.equal(jangkauanCari({}).mode, "semua"); assert.equal(jangkauanCari({ kelompok: "BUSA", labelKelompok: "Busa" }).teks, "Kelompok Busa.");
  assert.match(jangkauanCari({ kelompok: "KAIN", labelKelompok: "Kain", cari: "benang" }).teks, /Mencari di semua kelompok \(bukan hanya Kain\)/);
  assert.deepEqual(FILTER_JENIS.map((x) => x.key), ["", "RAW_MATERIAL", "WIP", "FINISHED_GOODS", "CONSUMABLE", "none"]); assert.equal(kunciJenis("NONE"), "none"); assert.equal(kunciJenis("WIP"), "WIP");
});

test("pipeline daftar Penerimaan: enam tahap berurutan + Dibatalkan/ditolak; hitungan, saringan, dan pencarian konsisten", () => {
  assert.deepEqual(TAHAP_PIPELINE.map((t) => t.label), ["Draf", "Terjadwal", "Barang tiba", "Pemeriksaan", "Siap masuk stok", "Sudah masuk stok"]); assert.equal(TAHAP_TUTUP.statuses[0], "REJECTED");
  const rows = ["DRAFT", "SCHEDULED", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED", "REJECTED"].map((status, i) => ({ id: "r" + i, status, receiptNumber: "GR-" + i, supplier: "Toko " + (i % 2), lines: [{ material: { code: "M" + i, name: "Bahan " + i } }], purchaseOrder: i < 3 ? { poNumber: "PO-1" } : null }));
  const h = hitungPerTahap(rows); assert.deepEqual([h.DRAF, h.TERJADWAL, h.TIBA, h.PERIKSA, h.SIAP, h.STOK, h.DITUTUP], [1, 2, 1, 1, 1, 1, 1]); assert.equal(h[""], 8);
  assert.deepEqual(filterTahap(rows, "TERJADWAL").map((r) => r.id), ["r1", "r2"]); assert.equal(filterTahap(rows, "tidak-ada").length, 8);
  assert.equal(rows.filter((r) => cocokCari(r, "po-1")).length, 3); assert.equal(rows.filter((r) => cocokCari(r, "bahan 5")).length, 1); assert.equal(rows.filter((r) => cocokCari(r, "")).length, 8);
  assert.deepEqual(rows.filter(perluTindakan).map((r) => r.status), ["DRAFT", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"], "yang menunggu tindakan Gudang; Terjadwal (menunggu barang) bukan tindakan");
});

test("sidebar Gudang: badge dari antrean server hanya untuk pekerjaan yang butuh tindakan; satu kelompok terbuka; halaman aktif membuka induknya; kelompok terakhir diingat", () => {
  const antrean = antreanDariBeranda({ tugas: [{ kode: "AKAN_DATANG", jumlah: 9 }, { kode: "PERLU_DICATAT_TIBA", jumlah: 2 }, { kode: "BELUM_MASUK_STOK", jumlah: 3 }, { kode: "PERMINTAAN_BAHAN", jumlah: 4 }, { kode: "SELISIH_MENUNGGU", jumlah: 0 }] });
  assert.deepEqual(antrean, { AKAN_DATANG: 9, PERLU_DICATAT_TIBA: 2, BELUM_MASUK_STOK: 3, PERMINTAAN_BAHAN: 4, SELISIH_MENUNGGU: 0 }); assert.equal(antreanDariBeranda(null), null);
  assert.equal(badgeItem("/warehouse/goods-receipt", antrean), 3); assert.equal(badgeItem("/warehouse/barang-akan-datang", antrean), 2); assert.equal(badgeItem("/warehouse/stock-count", antrean), null, "nol = tanpa badge");
  assert.equal(badgeItem("/warehouse/inventory", antrean), null); assert.equal(badgeItem("/warehouse/goods-receipt", null), null);
  assert.ok(!Object.values(BADGE_ANTREAN).flat().includes("AKAN_DATANG"), "PO yang sekadar ditunggu adalah informasi, bukan pekerjaan");
  const sections = [{ section: "Beranda", langsung: true, items: [{ to: "/warehouse/dashboard" }] }, { section: "Penerimaan", items: [{ to: "/warehouse/barang-akan-datang" }, { to: "/warehouse/goods-receipt" }] }, { section: "Stok", items: [{ to: "/warehouse/inventory" }] }];
  const b = denganBadgeGudang(sections, antrean); assert.equal(b[1].badgeKelompok, 5); assert.equal(b[2].badgeKelompok, 0); assert.equal(b[1].items[1].badgeN, 3);
  assert.equal(kelompokAktif(sections, "/warehouse/goods-receipt/abc"), "Penerimaan"); assert.equal(kelompokAktif(sections, "/warehouse/goods-receipts"), null, "bukan awalan segmen"); assert.equal(kelompokAktif(sections, "/komplain"), null);
  assert.equal(kelompokTerbuka({ sections, pathname: "/warehouse/inventory" }), "Stok", "halaman aktif membuka induknya");
  assert.equal(kelompokTerbuka({ sections, pathname: "/warehouse/dashboard", terakhir: "Penerimaan" }), "Penerimaan", "Beranda: kelompok terakhir diingat");
  assert.equal(kelompokTerbuka({ sections, pathname: "/warehouse/dashboard", terakhir: "Beranda" }), null, "Beranda (langsung) tidak pernah 'terbuka'");
  assert.equal(kelompokTerbuka({ sections, pathname: "/warehouse/inventory", dipilih: "Penerimaan" }), "Penerimaan", "pilihan pengguna menang atas halaman aktif");
  assert.equal(kelompokTerbuka({ sections, pathname: "/warehouse/inventory", dipilih: "" }), null, "pengguna menutup semua");
});

test("jendela fokus: satu lapisan (Modal di dalamnya menjadi panel, bukan dialog kedua), rute-backed, hanya tab aktif, Esc menutup panel dulu", () => {
  const f = baca("components/ui/fokus-overlay.jsx");
  assert.match(f, /LapisanTunggalCtx/); assert.match(f, /useTabVisibility/); assert.match(f, /onEscapeKeyDown/); assert.match(f, /tutupPaling/); assert.match(f, /max-sm:inset-0/); assert.match(f, /sticky|shrink-0/); assert.match(f, /data-testid="fokus-aksi"/);
  const m = baca("components/ui/modal.jsx"); assert.match(m, /useContext\(LapisanTunggalCtx\)/); assert.match(m, /PanelSatuLapisan/);
  const pd = baca("features/warehouse/penerimaan/PenerimaanDetail.jsx"); assert.match(pd, /<FokusOverlay/); assert.doesNotMatch(pd, /PageContainer/); assert.match(pd, /<PipelineStatus/); assert.match(pd, /onTutup/);
  const list = baca("pages/warehouse/WarehouseGoodsReceipt.jsx"); assert.match(list, /useParams\(\)/); assert.match(list, /navigate\(-n\)/, "Back menutup jendela ke daftar"); assert.match(list, /<PenerimaanDetail key="fokus"/);
  assert.doesNotMatch(list, /openNewTab|window\.open/, "membuka jendela TIDAK membuat tab workspace baru");
  const bad = baca("pages/warehouse/WarehouseBarangAkanDatang.jsx"); assert.match(bad, /<FokusOverlay/); assert.doesNotMatch(bad, /from "@\/components\/ui\/modal\.jsx"/); assert.match(bad, /useParams\(\)/);
  const reg = baca("routes/pageRegistry.jsx"); assert.match(reg, /goods-receipt\/:id\?/); assert.match(reg, /barang-akan-datang\/:id\?/);
});

test("kontrol status: pilihan hanya dari server (tampilan.pipeline.pindah), tidak menjalankan sendiri, tidak ada logika urutan status di layar", () => {
  const p = baca("features/warehouse/penerimaan/PipelineStatus.jsx");
  assert.match(p, /tampilan\?\.pipeline/); assert.match(p, /p\.pindah/); assert.match(p, /onPilih\(x\.kode\)/); assert.match(p, /bolehUbah/);
  assert.doesNotMatch(p, /DRAFT|SCHEDULED|ARRIVED|INSPECTION|READY_FOR_PUTAWAY|COMPLETED/, "layar tidak mengenal urutan status");
  const a = baca("features/warehouse/aksi/AksiDokumen.jsx"); assert.match(a, /picu/); assert.match(a, /klikRef/);
  const pd = baca("features/warehouse/penerimaan/PenerimaanDetail.jsx"); assert.match(pd, /setPicu\(\{ kode, n: Date\.now\(\) \}\)/); assert.match(pd, /bolehUbah=\{bolehUbah\}/);
});

test("Stok & Lokasi: navigasi kelompok sebagai pintu masuk; ringkasan tidak mendominasi; query URL; kelompok dari server (bukan tebakan di layar)", () => {
  const s = baca("pages/warehouse/WarehouseInventory.jsx"); const n = baca("features/warehouse/stok/KelompokBahanNav.jsx");
  assert.match(s, /<KelompokBahanNav/); assert.match(s, /useFilterDaftar\(PATH, KUNCI\)/); assert.match(s, /KUNCI = \["kelompok", "jenis", "q", "keadaan", "nonaktif", "semua"\]/); assert.match(s, /data\?\.kelompok/);
  assert.match(s, /data-testid="kembali-semua"/); assert.match(s, /data-testid="perhatian-kelompok"/); assert.match(s, /<details[^>]*data-testid="rincian-ringkasan"/);
  assert.doesNotMatch(s, /<details[^>]*\bopen=/, "rincian angka tertutup secara default (ringkasan tidak mendominasi)");
  assert.doesNotMatch(s + n, /itemGroup\s*[=!]==?|\.nama\.(includes|match)|toLowerCase\(\)\.includes\("(busa|kain)/i, "layar tidak menebak kelompok dari nama");
  assert.match(n, /grid-cols-2/); assert.match(n, /aria-pressed/); assert.match(n, /belum ada bahan/);
  assert.match(s, /max-sm:min-h-11/);
});

test("sidebar: enam kelompok utama; fitur biaya Finance diberi konteks; Layout memakai GudangNavGrup hanya untuk Gudang", () => {
  const l = baca("components/Layout.jsx"); const w = l.slice(l.indexOf('  warehouse: {\n    label: "Warehouse"'), l.indexOf("// ── DELIVERY & FULFILLMENT"));
  assert.deepEqual([...w.matchAll(/section: "([^"]+)"/g)].map((m) => m[1]), ["Beranda", "Penerimaan", "Stok", "Produksi", "Kontrol", "Laporan"]);
  const anak = (nama) => { const i = w.indexOf(`section: "${nama}"`); const j = w.indexOf("section:", i + 10); return [...w.slice(i, j < 0 ? undefined : j).matchAll(/label: "([^"]+)"/g)].map((m) => m[1]); };
  assert.deepEqual(anak("Penerimaan"), ["Barang Akan Datang", "Penerimaan Barang", "Retur Supplier"]); assert.deepEqual(anak("Stok"), ["Stok & Lokasi", "Pengeluaran Material", "Transfer Stok", "Restok"]);
  assert.deepEqual(anak("Produksi"), ["Antrean Produksi", "Penerimaan Unit", "Permintaan Bahan", "Terima Barang Jadi"]); assert.deepEqual(anak("Laporan"), ["Riwayat Pergerakan", "KPI Gudang"]);
  assert.deepEqual(anak("Kontrol").slice(0, 3), ["Stock Opname", "Barang Rusak & Retur", "Kasus Komplain"]);
  assert.match(w, /subjudul: "Diproses Finance"/); assert.match(w, /bolehPeran: \["ADMIN", "OWNER", "FINANCE", "APPROVER", "WAREHOUSE"\]/, "pembatasan peran Pengajuan Biaya tetap");
  assert.match(l, /divisionKey === "warehouse" && !onHub && !collapsed && !customizingNav/); assert.match(l, /<GudangNavGrup/);
  const g = baca("components/GudangNavGrup.jsx"); assert.match(g, /aria-expanded/); assert.match(g, /ArrowDown/); assert.match(g, /ArrowRight/); assert.match(g, /data-testid="badge-kelompok"/);
});
