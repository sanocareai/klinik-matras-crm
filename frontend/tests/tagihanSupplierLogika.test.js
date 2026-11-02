// Logika murni layar Tagihan supplier: sisa utang yang jujur, kelompok status, jatuh tempo WIB, asal dokumen, pencocokan penerimaan↔supplier, KPI, penjaga respons usang.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  tampilSisa, statusTempo, masukTab, hitungTab, asalTagihan, nomorFakturTampil, ringkasKpi, normalisasiNama, cocokSupplierPenerimaan, kelompokPenerimaan,
  perluKonfirmasiPenerimaan, ringkasPOPemilih, penjagaPermintaan, FILTER_STATUS_PO, STATUS_UTANG, BATAS_DAFTAR_TAGIHAN, BATAS_PENERIMAAN_BELUM_DITAGIH, teksCari,
} from "../src/features/finance/tagihan/tagihanLogika.js";

const baca = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const b = (o = {}) => ({ id: "x", billNumber: "BILL-1", status: "DISETUJUI", amount: 1000, terbayar: 0, sisa: 1000, dueDate: "2026-11-30T00:00:00.000Z", supplier: { name: "PT A" }, ...o });

test("Sisa utang: angka server hanya untuk dokumen yang sudah menjadi utang; draf/menunggu/ditolak/dibatalkan tampil '—' dengan penjelasan (nilai tidak diubah)", () => {
  for (const st of ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"]) assert.deepEqual(tampilSisa(b({ status: st, sisa: 250 })), { tampil: true, nilai: 250, alasan: "" }, st);
  for (const st of ["DRAFT", "MENUNGGU_APPROVAL", "DITOLAK", "DIBATALKAN"]) {
    const t = tampilSisa(b({ status: st, sisa: 1000 }));
    assert.equal(t.tampil, false, st); assert.equal(t.nilai, null); assert.ok(t.alasan.length > 10, st);
  }
  assert.match(tampilSisa(b({ status: "DIBATALKAN" })).alasan, /jurnal utangnya sudah dibalik/);
  assert.deepEqual([...STATUS_UTANG], ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"]);
});

test("Jatuh tempo: 'lewat' hanya bila masih ada sisa & status utang; tanggal dibandingkan sebagai kunci WIB (tanpa konversi zona)", () => {
  assert.equal(statusTempo(b({ dueDate: "2026-10-20T00:00:00.000Z" }), "2026-11-02"), "lewat");
  assert.equal(statusTempo(b({ dueDate: "2026-11-02T00:00:00.000Z" }), "2026-11-02"), "belum", "jatuh tempo hari ini belum lewat");
  assert.equal(statusTempo(b({ dueDate: "2026-11-01T00:00:00.000Z" }), "2026-11-02"), "lewat");
  assert.equal(statusTempo(b({ dueDate: "2026-10-20", status: "LUNAS", sisa: 0 }), "2026-11-02"), "belum");
  assert.equal(statusTempo(b({ dueDate: "2026-10-20", status: "MENUNGGU_APPROVAL" }), "2026-11-02"), "belum", "belum jadi utang → tidak 'lewat'");
  assert.equal(statusTempo(b({ dueDate: "2026-10-20", sisa: 0 }), "2026-11-02"), "belum");
  assert.equal(statusTempo(b({ dueDate: null }), "2026-11-02"), "tanpa");
});

test("Kelompok status: Perlu diproses = draf/menunggu + disetujui lewat tempo; Belum lunas; Lunas; Semua memuat dokumen nonaktif; hitungan konsisten", () => {
  const hari = "2026-11-02";
  const daftar = [
    b({ id: "1", status: "MENUNGGU_APPROVAL" }), b({ id: "2", status: "DRAFT" }), b({ id: "3", dueDate: "2026-10-01" }), b({ id: "4" }),
    b({ id: "5", status: "DIBAYAR_SEBAGIAN", sisa: 400 }), b({ id: "6", status: "LUNAS", sisa: 0 }), b({ id: "7", status: "DITOLAK" }), b({ id: "8", status: "DIBATALKAN" }),
  ];
  const ids = (t) => daftar.filter((x) => masukTab(x, t, hari)).map((x) => x.id);
  assert.deepEqual(ids("proses"), ["1", "2", "3"]);
  assert.deepEqual(ids("belum"), ["3", "4", "5"]);
  assert.deepEqual(ids("lunas"), ["6"]);
  assert.deepEqual(ids("semua"), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.deepEqual(hitungTab(daftar, hari), { proses: 3, belum: 3, lunas: 1, semua: 8 });
});

test("Asal dokumen: PO (faktur atas PO), penerimaan (tagihan menaut satu GR), atau tanpa PO; nomor faktur placeholder dianggap belum diisi", () => {
  assert.deepEqual(asalTagihan(b({ purchaseOrderId: "p1", purchaseOrder: { id: "p1", poNumber: "PO-1" } })), { jenis: "PO", nomor: "PO-1", id: "p1", label: "Dari PO" });
  assert.equal(asalTagihan(b({ goodsReceipt: { id: "g", receiptNumber: "GR-9" } })).jenis, "PENERIMAAN");
  const tanpa = asalTagihan(b({ jenisTagihan: { label: "Jasa / Operasional" } }));
  assert.equal(tanpa.jenis, "TANPA_PO"); assert.equal(tanpa.jenisTagihan, "Jasa / Operasional");
  assert.equal(nomorFakturTampil(b({ supplierRef: "000123/IV/2026" })), "000123/IV/2026");
  for (const x of [null, "", "  ", "---"]) assert.equal(nomorFakturTampil(b({ supplierRef: x })), null, JSON.stringify(x));
  assert.ok(teksCari(b({ supplierRef: "INV-1", purchaseOrder: { poNumber: "PO-7" } }), (n) => String(n)).includes("PO-7"));
});

test("Pencocokan penerimaan↔supplier: nama/alias dinormalisasi; beda & kosong TIDAK dipasangkan otomatis dan wajib konfirmasi", () => {
  const sup = { name: "CV Tekstil Nusantara", aliases: ["CV. Tekstil Nusantara Jaya"] };
  assert.equal(normalisasiNama("  CV.  Tekstil-Nusantara "), "cv tekstil nusantara");
  assert.equal(cocokSupplierPenerimaan("cv tekstil nusantara", sup), "cocok");
  assert.equal(cocokSupplierPenerimaan("CV TEKSTIL NUSANTARA JAYA", sup), "cocok", "alias");
  assert.equal(cocokSupplierPenerimaan("PT Lain", sup), "beda");
  assert.equal(cocokSupplierPenerimaan("CV Tekstil", sup), "beda", "kemiripan sebagian bukan kecocokan");
  assert.equal(cocokSupplierPenerimaan(null, sup), "kosong");
  assert.equal(cocokSupplierPenerimaan("   ", sup), "kosong");
  const penerimaan = [{ id: "a", supplier: "CV Tekstil Nusantara" }, { id: "b", supplier: "PT Lain" }, { id: "c", supplier: null }];
  const k = kelompokPenerimaan(penerimaan, sup);
  assert.deepEqual([k.cocok.map((x) => x.id), k.beda.map((x) => x.id), k.kosong.map((x) => x.id)], [["a"], ["b"], ["c"]]);
  assert.equal(k.terpotong, false);
  assert.equal(perluKonfirmasiPenerimaan(penerimaan[0], sup), false);
  assert.equal(perluKonfirmasiPenerimaan(penerimaan[1], sup), true);
  assert.equal(perluKonfirmasiPenerimaan(penerimaan[2], sup), true);
  assert.equal(perluKonfirmasiPenerimaan(null, sup), false);
  const banyak = Array.from({ length: BATAS_PENERIMAAN_BELUM_DITAGIH }, (_, i) => ({ id: String(i), supplier: null }));
  assert.equal(kelompokPenerimaan(banyak, sup).terpotong, true, "daftar server penuh dianggap mungkin terpotong");
});

test("KPI: populasi mengikuti server (aging) dan daftar yang dimuat; penanda terpotong bila daftar penuh", () => {
  const aging = { total: 5000, baris: [{ hariLewat: 3, sisa: 700 }, { hariLewat: 0, sisa: 4300 }] };
  const k = ringkasKpi({ aging, bills: [b({ status: "MENUNGGU_APPROVAL" }), b()], uangMuka: { kartu: { uangMukaBelumDiterapkan: 900 }, suppliers: [{ uangMukaBelumDiterapkan: 900 }, { uangMukaBelumDiterapkan: 0 }] }, unbilled: [{}, {}] });
  assert.deepEqual(k.sisaUtang, { nilai: 5000, jumlah: 2 });
  assert.deepEqual(k.lewatTempo, { nilai: 700, jumlah: 1 });
  assert.deepEqual(k.menunggu, { jumlah: 1, terpotong: false });
  assert.deepEqual(k.uangMuka, { nilai: 900, supplier: 1 });
  assert.deepEqual(k.penerimaan, { jumlah: 2, terpotong: false });
  const penuh = Array.from({ length: BATAS_DAFTAR_TAGIHAN }, (_, i) => b({ id: String(i) }));
  assert.equal(ringkasKpi({ aging: null, bills: penuh, uangMuka: null, unbilled: [] }).menunggu.terpotong, true);
  assert.deepEqual(ringkasKpi({ aging: null, bills: [], uangMuka: null, unbilled: [] }).sisaUtang, { nilai: 0, jumlah: 0 });
});

test("Jalur Dari PO: filter status PO sama dengan syarat faktur; ringkasan hanya angka dari daftar PO; peringatan bila belum ada barang", () => {
  assert.equal(FILTER_STATUS_PO, "DISETUJUI,DITERIMA_SEBAGIAN,SELESAI");
  const adaBarang = ringkasPOPemilih({ progres: { dijumlah: true, teks: "98,25 / 224,79 KG masuk stok", total: { datang: 130, masukStok: 98 } } });
  assert.equal(adaBarang.adaBarang, true); assert.equal(adaBarang.peringatan, ""); assert.match(adaBarang.teks, /KG/);
  const kosong = ringkasPOPemilih({ progres: { dijumlah: true, teks: "0 / 5 dus masuk stok", total: { datang: 0, masukStok: 0 } } });
  assert.equal(kosong.adaBarang, false); assert.match(kosong.peringatan, /tertahan/);
  assert.match(ringkasPOPemilih({ progres: { dijumlah: false, teks: "x", total: {} } }).teks, /Satuan berbeda/, "satuan berbeda tidak dijumlahkan");
});

test("Penjaga respons usang: hanya permintaan terakhir yang sah", () => {
  const p = penjagaPermintaan();
  const a = p.mulai(); const c = p.mulai();
  assert.equal(p.sahkan(a), false); assert.equal(p.sahkan(c), true);
  p.batalkan(); assert.equal(p.sahkan(c), false);
});

test("Pemasangan: Catat tagihan = tiga asal ke kontrak yang ada; payload form lama dipertahankan; klik ganda dijaga sinkron; izin; tanpa endpoint baru", () => {
  const c = baca("../src/features/finance/tagihan/CatatTagihan.jsx");
  for (const k of ["Dari PO", "Dari penerimaan", "Tanpa PO"]) assert.ok(c.includes(k), k);
  assert.ok(c.includes("import { ModalFaktur } from"), "jalur PO memakai form faktur PO yang sudah ada");
  assert.ok(c.includes("api.getPurchaseOrders({ status: FILTER_STATUS_PO, supplierId: supplier.id })"));
  assert.ok(c.includes("await api.createFinanceBill(body)"), "jalur manual memakai POST /finance/bills yang sama");
  assert.ok(c.includes("{ supplierId: supplier.id, ...dasar, ...bodyJenis(f), ...bodyTermin(termin) }"), "bentuk payload sama dengan form lama");
  assert.ok(c.includes("billType: asal === \"PENERIMAAN\" ? \"BAHAN_BAKU\" : \"\""));
  assert.ok(c.includes("kunciKirim.current"), "penjaga klik ganda sinkron");
  assert.ok(c.includes("perluKonfirmasiPenerimaan(gr, supplier)") && c.includes("konfirmasi penerimaan"), "penerimaan beda nama wajib konfirmasi eksplisit");
  assert.ok(c.includes("sembunyikanPenerimaan"), "Tanpa PO tidak menjadi jalan pintas penerimaan");
  assert.ok(c.includes("penjaga.current.sahkan(id)") && c.includes("penjaga.current.batalkan()"), "respons lambat tidak memasang ulang data lama");
  assert.ok(c.includes("pencocokan per item") || c.includes("bukan per item"), "tidak mengklaim pencocokan per item pada jalur penerimaan");
  assert.ok(!/autoSelect|setGoodsReceiptId\(.*cocok/.test(c), "tidak memasangkan penerimaan otomatis");
  assert.ok(!/api\.(approve|pay|createFinanceSupplierPayment|terapkan|updateHarga)/i.test(c), "tidak menyetujui, membayar, atau menerapkan uang muka");
  const h = baca("../src/pages/finance/FinanceSuppliers.jsx");
  assert.ok(h.includes("disabled={tab === \"tagihan\" && !bolehCatat}"), "izin mencatat");
  assert.ok(h.includes("<CatatTagihan") && !h.includes("ModalTagihanIsi"), "form Tagihan Baru lama dihapus");
  assert.ok(h.includes('title={tab === "tagihan" ? "Tagihan supplier" : "Supplier & Utang"}'));
  assert.ok(h.includes("api.createFinanceSupplierPayment(d, kunci)"), "pembayaran tetap");
  const d = baca("../src/features/finance/tagihan/DaftarTagihan.jsx");
  assert.ok(d.includes("tampilSisa(b)") && d.includes("fin-tg-strip"), "kolom Sisa utang memakai aturan sisa jujur");
  assert.ok(!/paginat|aria-sort|onSort|urutkan|halaman \d/i.test(d), "tidak ada pagination/sorting palsu");
});
