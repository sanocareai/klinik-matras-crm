// UX Gudang Tahap 1 (frontend): logika murni + kontrak struktur layar (tanpa DOM). Status dan aksi per status diputuskan SERVER (tampilan); tes backend ada di gudangUx.integration.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TAHAP_FILTER, filterTahap, hitungPerTahap, identitasPenerimaan, penerimaanLainSamaPO, barisPerItem, kalimatBaris, catatanBaris, galatIsianPemeriksaan, aksiRelevan, aksiUtama, CARA_AKSI } from "../src/features/warehouse/penerimaan/penerimaanLogic.js";
import { galatPanel } from "../src/features/warehouse/aksi/aksiLogic.js";
import { saringStok, teksSaldo, teksBatasMinimum, tampilSaldo, riwayatLokasi, FILTER_KEADAAN } from "../src/features/warehouse/stok/stokLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(dir, "../src", rel), "utf8").replace(/\r\n/g, "\n");

// Dua PO berbeda untuk bahan yang sama (kasus BUSA OCEAN): satu Draf buatan staf, satu Terjadwal dari PO — TIDAK boleh dianggap duplikat.
const busaA = { id: "gr-a", receiptNumber: "GR-161026-01", status: "SCHEDULED", purchaseOrderId: "po-1", supplier: "PT OCEAN", expectedDate: "2026-10-18", createdAt: "2026-10-16T03:00:00Z", createdBy: { name: "Rika" }, purchaseOrder: { poNumber: "PO-OCEAN-1" }, lines: [{ id: "l1" }] };
const busaB = { id: "gr-b", receiptNumber: "GR-171026-02", status: "DRAFT", purchaseOrderId: "po-2", supplier: "PT OCEAN", expectedDate: null, createdAt: "2026-10-17T03:00:00Z", createdBy: { name: "Gilang" }, purchaseOrder: { poNumber: "PO-OCEAN-2" }, lines: [{ id: "l2" }] };

test("filter tahap: Terjadwal & draf mencakup DRAFT dan SCHEDULED; hitungan konsisten", () => {
  const rows = [busaA, busaB, { id: "c", status: "COMPLETED", lines: [] }, { id: "d", status: "REJECTED", lines: [] }, { id: "e", status: "READY_FOR_PUTAWAY", lines: [] }];
  assert.deepEqual(filterTahap(rows, "jadwal").map((r) => r.id), ["gr-a", "gr-b"]);
  assert.deepEqual(filterTahap(rows, "belum-masuk-stok").map((r) => r.id), ["e"]);
  assert.equal(filterTahap(rows, "").length, 5);
  assert.equal(filterTahap(rows, "tidak-ada").length, 5);
  const h = hitungPerTahap(rows);
  assert.equal(h[""], 5); assert.equal(h.jadwal, 2); assert.equal(h.selesai, 1); assert.equal(h.ditutup, 1);
  assert.deepEqual(TAHAP_FILTER.map((t) => t.key), ["", "jadwal", "belum-masuk-stok", "selesai", "ditutup"]);
});

test("identitas: dua PO berbeda untuk supplier yang sama tetap dua identitas (tidak digabung, tidak disebut duplikat)", () => {
  const a = identitasPenerimaan(busaA); const b = identitasPenerimaan(busaB);
  assert.notEqual(a.nomor, b.nomor); assert.notEqual(a.nomorPO, b.nomorPO);
  assert.equal(a.pembuat, "Rika"); assert.equal(b.pembuat, "Gilang");
  assert.equal(a.sumber, "Dari PO");
  assert.deepEqual(penerimaanLainSamaPO(busaA, [busaA, busaB]), [], "PO berbeda → bukan penerimaan lain untuk PO yang sama");
  const dobel = { ...busaB, id: "gr-c", purchaseOrderId: "po-1" };
  assert.deepEqual(penerimaanLainSamaPO(busaA, [busaA, dobel]).map((x) => x.id), ["gr-c"]);
  assert.deepEqual(penerimaanLainSamaPO(busaA, [busaA, { ...dobel, status: "COMPLETED" }]), [], "yang sudah final tidak diperingatkan");
  assert.deepEqual(penerimaanLainSamaPO({ id: "x" }, [busaA]), []);
});

test("matriks per item multi-PO: pesan/jadwal/tiba/diterima/masuk stok per baris; kosong = '—' bukan nol", () => {
  const r = {
    status: "COMPLETED",
    poRingkas: { lines: [{ id: "pl1", progres: { dipesan: 100, belumDatang: 40 } }, { id: "pl2", progres: { dipesan: 10, belumDatang: 10 } }] },
    lines: [
      { id: "a", purchaseOrderLineId: "pl1", orderedQty: 60, receivedQty: 60, acceptedQty: 55, rejectedQty: 5, material: { code: "BUSA-1", name: "Busa", unit: "KG" }, purchaseOrderLine: { purchaseUnit: "karung", unit: "KG", conversionFactor: 10 } },
      { id: "b", purchaseOrderLineId: "pl2", orderedQty: 5, receivedQty: null, acceptedQty: null, rejectedQty: null, material: { code: "LEM-1", name: "Lem", unit: "LTR" }, purchaseOrderLine: { unit: "LTR" } },
    ],
  };
  const [x, y] = barisPerItem(r);
  assert.equal(x.dipesan, 100); assert.equal(x.dijadwalkan, 60); assert.equal(x.tiba, 60); assert.equal(x.baik, 55); assert.equal(x.ditolak, 5);
  assert.equal(x.masukStok, 55); assert.equal(x.masukStokStok, 550); assert.equal(x.sisaPO, 40); assert.equal(x.satuan, "karung");
  assert.equal(y.tiba, null); assert.equal(y.baik, null); assert.equal(y.masukStok, 0);
  assert.match(kalimatBaris(y), /tiba —/);
  assert.match(kalimatBaris(x), /pesan 100.*jadwal 60.*tiba 60.*baik 55.*ditolak 5.*masuk stok 55 karung/);
  // belum masuk stok bila dokumen belum COMPLETED
  assert.equal(barisPerItem({ ...r, status: "READY_FOR_PUTAWAY" })[0].masukStok, 0);
  assert.deepEqual(catatanBaris({ tiba: 70, dijadwalkan: 60, baik: 10, ditolak: 0 }), ["Tiba lebih banyak dari yang dijadwalkan"]);
  assert.deepEqual(catatanBaris({ tiba: 10, dijadwalkan: 10, baik: 8, ditolak: 5 }), ["Baik + ditolak melebihi jumlah tiba"]);
});

test("validasi isian pemeriksaan dan panel aksi", () => {
  assert.equal(galatIsianPemeriksaan({ a: "5", b: "", c: "0.125" }), "");
  assert.match(galatIsianPemeriksaan({ a: "-1" }), /0 atau lebih/);
  assert.match(galatIsianPemeriksaan({ a: "1.2345" }), /3 angka/);
  const panel = { bidang: [{ nama: "alasan", label: "Alasan", wajib: true, min: 3, maks: 300 }, { nama: "tgl", label: "Tanggal", tipe: "date" }] };
  assert.match(galatPanel(panel, { alasan: "" }), /wajib/);
  assert.match(galatPanel(panel, { alasan: "ab" }), /minimal 3/);
  assert.match(galatPanel(panel, { alasan: "uji coba", tgl: "18-10-2026" }), /tidak valid/);
  assert.equal(galatPanel(panel, { alasan: "uji coba", tgl: "2026-10-18" }), "");
});

test("aksi relevan hanya yang disebut server; tidak ada Edit/Undo/Hapus; aksi utama = jenis maju", () => {
  const tampilan = { aksi: [{ kode: "UBAH_JADWAL", jenis: "ubah" }, { kode: "CATAT_TIBA", jenis: "maju" }, { kode: "KEMBALI_DRAFT", jenis: "ubah" }, { kode: "BATALKAN_JADWAL", jenis: "batal" }, { kode: "ASING", jenis: "ubah" }] };
  assert.deepEqual(aksiRelevan(tampilan).map((a) => a.kode), ["UBAH_JADWAL", "CATAT_TIBA", "KEMBALI_DRAFT", "BATALKAN_JADWAL"], "kode yang tak dikenal UI tidak ditampilkan");
  assert.equal(aksiUtama(tampilan).kode, "CATAT_TIBA");
  assert.equal(aksiUtama({ aksi: [] }), null);
  assert.deepEqual(aksiRelevan(null), []);
  for (const k of Object.keys(CARA_AKSI)) assert.doesNotMatch(k, /EDIT|UNDO|HAPUS|DELETE/);
});

test("Stok & Lokasi: saldo '—' (belum ada catatan) berbeda dari 0; minimum 'belum diatur' berbeda dari 0", () => {
  assert.equal(teksSaldo({ saldo: null }), "—");
  assert.equal(teksSaldo({ saldo: 0 }), "0");
  assert.equal(teksSaldo({ saldo: -3 }), "-3");
  assert.equal(teksBatasMinimum({ batasMinimum: null }), "belum diatur");
  assert.equal(teksBatasMinimum({ batasMinimum: 0 }), "0");
  const rows = [
    { aktif: true, kode: "A1", nama: "Busa Ocean", vendor: "PT OCEAN", kategori: "RAW_MATERIAL", keadaan: "ADA" },
    { aktif: true, kode: "B2", nama: "Lem", vendor: null, kategori: null, keadaan: "BELUM_ADA_CATATAN" },
    { aktif: false, kode: "C3", nama: "Lama", vendor: null, kategori: "WIP", keadaan: "NONAKTIF" },
  ];
  assert.deepEqual(saringStok(rows, {}).map((r) => r.kode), ["A1", "B2"], "nonaktif disembunyikan");
  assert.deepEqual(saringStok(rows, { nonaktif: true }).map((r) => r.kode), ["A1", "B2", "C3"]);
  assert.deepEqual(saringStok(rows, { cari: "ocean" }).map((r) => r.kode), ["A1"], "cari juga lewat vendor");
  assert.deepEqual(saringStok(rows, { tab: "none" }).map((r) => r.kode), ["B2"]);
  assert.deepEqual(saringStok(rows, { keadaan: "BELUM_ADA_CATATAN" }).map((r) => r.kode), ["B2"]);
  assert.ok(FILTER_KEADAAN.some((f) => f.key === "BELUM_ADA_CATATAN") && FILTER_KEADAAN.some((f) => f.key === "NOL_TERHITUNG"));
});

test("Beranda: satu halaman tugas dari server, tanpa angka stok/KPI ala dashboard kedua; setiap kartu punya tautan", () => {
  const s = baca("pages/warehouse/WarehouseDashboard.jsx");
  assert.match(s, /api\.getBerandaGudang\(\)/);
  assert.match(s, /to=\{t\.tautan\}/);
  assert.match(s, /Beranda Gudang/);
  assert.doesNotMatch(s, /KpiCard|warehouseMock|getWarehouseReportSummary|Akurasi Stok/);
  for (const k of ["AKAN_DATANG", "PERLU_DICATAT_TIBA", "BELUM_MASUK_STOK"]) assert.match(s, new RegExp(k));
  assert.match(s, /belum memengaruhi stok/);
});

test("Navigasi Gudang: dikelompokkan menurut alur, semua rute lama tetap ada, Dashboard → Beranda", () => {
  const s = baca("components/Layout.jsx");
  const w = s.slice(s.indexOf('  warehouse: {\n    label: "Warehouse"'), s.indexOf("// ── DELIVERY & FULFILLMENT"));
  const sections = [...w.matchAll(/section: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sections, ["HARI INI", "PENERIMAAN BARANG", "STOK", "UNTUK PRODUKSI", "KONTROL & BIAYA", "LAPORAN"]);
  const rute = [...w.matchAll(/to: "([^"]+)"/g)].map((m) => m[1]);
  for (const r of ["/warehouse/dashboard", "/warehouse/barang-akan-datang", "/warehouse/goods-receipt", "/warehouse/retur-supplier", "/warehouse/inventory", "/warehouse/material-issue", "/warehouse/transfers", "/warehouse/replenishment", "/warehouse/adjustments", "/warehouse/antrean-produksi", "/warehouse/unit-custody", "/warehouse/material-pickup", "/warehouse/finished-goods", "/warehouse/stock-count", "/finance/persediaan-awal", "/komplain", "/warehouse/pengajuan-biaya", "/warehouse/laporan-biaya", "/warehouse/reports", "/warehouse/kpi"]) assert.ok(rute.includes(r), `menu ${r} hilang`);
  assert.equal(new Set(rute).size, rute.length, "tidak ada menu ganda");
  assert.match(w, /label: "Beranda"/); assert.doesNotMatch(w, /label: "Dashboard"/);
  assert.match(w, /bolehPeran: \["ADMIN", "OWNER", "FINANCE", "APPROVER", "WAREHOUSE"\]/, "pembatasan peran Pengajuan Biaya tetap");
});

test("Daftar Penerimaan: identitas lengkap, filter tahap, detail sebagai halaman (bukan drawer), kartu sempit, tautan lama ?buka=", () => {
  const s = baca("pages/warehouse/WarehouseGoodsReceipt.jsx");
  assert.match(s, /navigate\(`\/warehouse\/goods-receipt\/\$\{id\}`/);
  assert.match(s, /identitasPenerimaan/); assert.match(s, /r\.receiptNumber/); assert.match(s, /No\. PO/); assert.match(s, /Supplier/);
  assert.match(s, /sp\.get\("buka"\)/);
  assert.match(s, /md:hidden/); assert.match(s, /hidden md:block/);
  assert.match(s, /<SumberPO receipt=\{r\} \/>/);
  assert.doesNotMatch(s, /GoodsReceiptDetailDrawer/);
  assert.match(s, /Belum memengaruhi stok/);
  assert.doesNotMatch(s, /Putaway|Siap Ditempatkan/);
});

test("Halaman detail Penerimaan: identitas, alur, tabel per item, aksi dari server, koreksi resmi; tanpa Edit/Undo umum", () => {
  const s = baca("features/warehouse/penerimaan/PenerimaanDetail.jsx");
  for (const id of ["kartu-identitas", "id-nomor", "id-po", "id-pembuat", "status-penerimaan", "penjelasan-status", "kartu-aksi"]) assert.match(s, new RegExp(`data-testid="${id}"`), id);
  assert.match(s, /<AlurPenerimaan/); assert.match(s, /<TabelPerItem/); assert.match(s, /<AksiDokumen/);
  assert.match(s, /KartuJalurKoreksi/); assert.match(s, /ringkas/);
  assert.match(s, /ModalKoreksiKedatangan/); assert.match(s, /KoreksiPenerimaanModal/);
  assert.doesNotMatch(s, />\s*Undo\s*</); assert.doesNotMatch(s, />\s*Hapus\s*</); assert.doesNotMatch(s, /reversal|idempoten/i);
  // aksi hanya muncul dari tampilan.aksi (server), bukan dari status yang ditebak di browser
  assert.match(s, /tampilan/);
  const r = baca("routes/pageRegistry.jsx");
  assert.match(r, /path: "\/warehouse\/goods-receipt\/:id"/);
});

test("Teks pengguna tidak memuat istilah teknis reversal/idempotensi di layar baru", () => {
  for (const f of ["pages/warehouse/WarehouseDashboard.jsx", "pages/warehouse/WarehouseInventory.jsx", "pages/warehouse/WarehouseGoodsReceipt.jsx", "features/warehouse/penerimaan/PenerimaanDetail.jsx", "features/warehouse/penerimaan/AlurPenerimaan.jsx", "features/warehouse/penerimaan/TabelPerItem.jsx", "features/warehouse/aksi/AksiDokumen.jsx"]) {
    const tampil = baca(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(tampil, /reversal|idempoten/i, f);
  }
});

test("Tata letak sempit: target sentuh min-h-11, kartu/daftar bergantian dengan tabel, tanpa lebar tetap yang memaksa gulir", () => {
  for (const f of ["pages/warehouse/WarehouseGoodsReceipt.jsx", "pages/warehouse/WarehouseInventory.jsx", "features/warehouse/aksi/AksiDokumen.jsx", "features/warehouse/penerimaan/TabelPerItem.jsx"]) assert.match(baca(f), /max-sm:min-h-11/, f);
  assert.match(baca("features/warehouse/penerimaan/TabelPerItem.jsx"), /md:hidden/);
  assert.match(baca("pages/warehouse/WarehouseInventory.jsx"), /md:hidden/);
});

test("Saldo: belum diketahui, nol, dan minus tampil BERBEDA; lokasi hanya sebagai riwayat penerimaan (bukan lokasi stok saat ini)", () => {
  assert.equal(tampilSaldo({ saldo: null }).jenis, "BELUM_DIKETAHUI"); assert.equal(tampilSaldo({ saldo: null }).teks, "belum diketahui");
  assert.equal(tampilSaldo({ saldo: 0 }).jenis, "NOL"); assert.equal(tampilSaldo({ saldo: 0 }).teks, "0");
  assert.equal(tampilSaldo({ saldo: -388.5 }).jenis, "MINUS"); assert.match(tampilSaldo({ saldo: -388.5 }).keterangan, /dihitung fisik/);
  assert.equal(tampilSaldo({ saldo: 12 }).jenis, "ADA");
  assert.equal(riwayatLokasi({ lokasiTerakhir: null }), null);
  const l = riwayatLokasi({ lokasiTerakhir: { lokasi: "RAK-A1", waktu: "2026-10-12T03:00:00Z" } });
  assert.match(l.teks, /^Terakhir diterima di RAK-A1/);
  const s = baca("pages/warehouse/WarehouseInventory.jsx");
  assert.match(s, /Riwayat penerimaan/); assert.match(s, /bukan lokasi stok saat ini/); assert.doesNotMatch(s, />Lokasi terakhir</); assert.doesNotMatch(s, />Lokasi</);
  assert.match(s, /sel-riwayat-lokasi/); assert.match(s, /data-jenis=/);
});

test("Pemulihan dokumen: Batalkan catatan tiba / Pulihkan / Buat penerimaan baru tersedia di halaman detail dengan alasan; jejak dengan tautan; tanpa Hapus/Undo", () => {
  const d = baca("features/warehouse/penerimaan/PenerimaanDetail.jsx");
  for (const k of ["BATALKAN_TIBA", "PULIHKAN", "BUAT_ULANG"]) assert.ok(d.includes(`${k}: { panel`), k);
  for (const m of ["batalkanTibaGoodsReceipt", "pulihkanGoodsReceipt", "buatUlangGoodsReceipt"]) { assert.ok(d.includes(`api.${m}`), m); assert.ok(baca("api.js").includes(`${m}:`), m); }
  assert.ok(d.includes("navigate(`/warehouse/goods-receipt/${baru.id}`)"));
  assert.match(d, /data-testid="jejak-dokumen"/); assert.match(d, /tidak dihapus/);
  assert.doesNotMatch(d, />\s*(Hapus|Undo)\s*</);
  for (const k of ["BATALKAN_TIBA", "PULIHKAN", "BUAT_ULANG"]) assert.ok(k in CARA_AKSI, k);
});
