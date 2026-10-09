// PO terintegrasi Finance–Gudang: logika murni layar (formulir catat/koreksi kedatangan, pendamping, status) + pemasangan di Gudang, Finance, dan drawer penerimaan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATUS_AKAN_DATANG, TAB_AKAN_DATANG, jumlahTeks, formKedatanganAwal, galatKedatangan, kekuranganIsian, bodyKedatangan, formKoreksiAwal, bodyKoreksi, galatKoreksi,
  kalimatRiwayat, ringkasKuantitas, pendamping0, adaPendamping, galatPendamping, bodyPendamping, pendampingDariPO, teksPratinjauPendamping, teksPendampingAktual, hariIniISO,
} from "../src/features/kedatangan/kedatanganLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

const po = () => ({
  id: "po1", poNumber: "PO-01102026-001", orderDate: "2026-09-01", status: "DISETUJUI",
  lines: [
    { id: "l1", kode: "BUSA-R50", nama: "Busa", satuan: "KG", dipesan: 10, sisaDatang: 10, pendamping: { satuan: "LEMBAR", mode: "AKTUAL", rasio: null, estimasi: 2, aktual: null, teks: "perkiraan 2 lembar" } },
    { id: "l2", kode: "LEM-1", nama: "Lem", satuan: "DUS", dipesan: 3, sisaDatang: 3, pendamping: { satuan: "KALENG", mode: "TETAP", rasio: 12, estimasi: 36, aktual: null, teks: "setara 36 kaleng" } },
    { id: "l3", kode: "KAIN", nama: "Kain", satuan: "METER", dipesan: 5, sisaDatang: 0, pendamping: null },
  ],
});

test("status Barang Akan Datang: tujuh status Gudang, label Indonesia, tab semua + tujuh", () => {
  assert.deepEqual(Object.keys(STATUS_AKAN_DATANG), ["MENUNGGU_KEDATANGAN", "DITERIMA_SEBAGIAN", "TERLAMBAT", "PERLU_DIPERIKSA", "SIAP_DISIMPAN", "SELESAI", "DIBATALKAN"]);
  assert.deepEqual(TAB_AKAN_DATANG.map((t) => t.label), ["Semua", "Menunggu Kedatangan", "Diterima Sebagian", "Terlambat", "Perlu Diperiksa", "Siap Disimpan", "Selesai", "Dibatalkan"]);
});

test("formulir catat tiba: hanya item yang masih boleh datang; PIC, catatan, tanggal, jumlah wajib; tidak boleh melebihi sisa PO; surat jalan/bukti opsional tetapi kekurangannya terlihat", () => {
  const f = formKedatanganAwal(po());
  assert.deepEqual(f.lines.map((l) => l.kode), ["BUSA-R50", "LEM-1"], "item tanpa sisa tidak ditawarkan");
  assert.equal(f.tanggalTiba, hariIniISO());
  assert.match(galatKedatangan(f), /PIC/);
  f.penerima = "Budi"; assert.match(galatKedatangan(f), /catatan/);
  f.catatan = "Dus utuh"; assert.match(galatKedatangan(f), /jumlah datang minimal satu/);
  f.lines[0].jumlahDatang = "11"; assert.match(galatKedatangan(f), /melebihi sisa PO.*merevisi jumlah PO/);
  f.lines[0].jumlahDatang = "5"; assert.equal(galatKedatangan(f), null);
  assert.deepEqual(kekuranganIsian(f), ["Surat jalan belum diisi", "Bukti kedatangan belum diunggah", "Jumlah lembar aktual BUSA-R50 belum diisi"]);
  f.suratJalan = "SJ-1"; f.bukti = ["/media/receipt-proofs/x.jpg"]; f.lines[0].jumlahPendamping = "1";
  assert.deepEqual(kekuranganIsian(f), []);
  assert.deepEqual(bodyKedatangan(f, "r1"), {
    receiptId: "r1", tanggalTiba: f.tanggalTiba, penerima: "Budi", catatan: "Dus utuh", suratJalan: "SJ-1", bukti: ["/media/receipt-proofs/x.jpg"],
    lines: [{ purchaseOrderLineId: "l1", jumlahDatang: 5, jumlahPendamping: 1 }],
  });
  f.tanggalTiba = "2999-01-01"; assert.match(galatKedatangan(f), /masa depan/);
  f.tanggalTiba = "2026-08-01"; assert.match(galatKedatangan(f, { tanggalPO: "2026-09-01" }), /sebelum tanggal PO/);
  // aktor/peran/workspace TIDAK ada di body: dari sesi server
  assert.equal(JSON.stringify(bodyKedatangan(f)).match(/peran|workspace|aktor|role/i), null);
});

test("koreksi: alasan wajib, hanya field yang berubah dikirim, jumlah terkunci setelah pemeriksaan; riwayat sebelum–sesudah dibaca manusia", () => {
  const r = { id: "r1", nomor: "GR-1", status: "ARRIVED", revisi: 1, tanggalTiba: "2026-10-01", penerima: "Budi", catatan: "ok", suratJalan: "SJ-1", bukti: [], lines: [{ purchaseOrderLineId: "l1", kode: "BUSA-R50", satuan: "KG", datang: 5, pendamping: { satuan: "LEMBAR", mode: "AKTUAL", aktual: 1 } }] };
  const f = formKoreksiAwal(r);
  assert.equal(f.bolehUbahJumlah, true);
  assert.match(galatKoreksi(f, r), /Alasan koreksi/);
  f.alasan = "Salah ketik tanggal";
  assert.match(galatKoreksi(f, r), /Belum ada yang diubah/);
  f.tanggalTiba = "2026-09-30"; f.lines[0].jumlahDatang = "4";
  assert.equal(galatKoreksi(f, r), null);
  assert.deepEqual(bodyKoreksi(f, r), { revisi: 1, alasan: "Salah ketik tanggal", perubahan: { tanggalTiba: "2026-09-30", lines: [{ purchaseOrderLineId: "l1", jumlahDatang: 4 }] } });
  const terkunci = formKoreksiAwal({ ...r, status: "INSPECTION" });
  assert.equal(terkunci.bolehUbahJumlah, false);
  terkunci.lines[0].jumlahDatang = "3"; terkunci.alasan = "x yyyy";
  assert.equal(bodyKoreksi(terkunci, { ...r, status: "INSPECTION" }).perubahan.lines, undefined, "jumlah tidak dikirim setelah pemeriksaan");
  const k = kalimatRiwayat({ jenis: "KEDATANGAN_DIKOREKSI", oleh: "Sari", workspace: "FINANCE", alasan: "Salah ketik", sebelum: { tanggalTiba: "2026-10-01", lines: [{ purchaseOrderLineId: "l1", kode: "BUSA", datang: 5 }] }, sesudah: { tanggalTiba: "2026-09-30", lines: [{ purchaseOrderLineId: "l1", kode: "BUSA", datang: 4 }] } });
  assert.match(k, /Sari \(Finance\) mengoreksi kedatangan/); assert.match(k, /datang 5 → 4/); assert.match(k, /Alasan: Salah ketik/);
  assert.match(kalimatRiwayat({ jenis: "KEDATANGAN_DICATAT", oleh: "Budi", workspace: "GUDANG", sesudah: { tanggalTiba: "2026-10-01" } }), /Budi \(Gudang\) mencatat barang tiba/);
});

test("pendamping pada PO: dua mode, validasi dini, tidak digabung konversi satuan, pratinjau '10 KG — perkiraan 2 lembar'", () => {
  assert.equal(adaPendamping(pendamping0()), false);
  assert.equal(galatPendamping(pendamping0()), null);
  assert.match(galatPendamping({ satuan: "LEMBAR", mode: "", rasio: "", estimasi: "" }), /Pilih mode/);
  assert.match(galatPendamping({ satuan: "", mode: "AKTUAL", rasio: "", estimasi: "" }), /satuan pendamping/i);
  assert.match(galatPendamping({ satuan: "KALENG", mode: "TETAP", rasio: "", estimasi: "" }), /rasio/i);
  assert.match(galatPendamping({ satuan: "KALENG", mode: "TETAP", rasio: "12", estimasi: "" }, { adaKonversi: true }), /tidak bisa digabung/);
  assert.equal(galatPendamping({ satuan: "LEMBAR", mode: "AKTUAL", rasio: "", estimasi: "2" }), null);
  assert.deepEqual(bodyPendamping({ satuan: " LEMBAR ", mode: "AKTUAL", rasio: "", estimasi: "2" }), { satuan: "LEMBAR", mode: "AKTUAL", estimasi: 2 });
  assert.deepEqual(bodyPendamping({ satuan: "KALENG", mode: "TETAP", rasio: "12", estimasi: "" }), { satuan: "KALENG", mode: "TETAP", rasio: 12 });
  assert.equal(bodyPendamping(pendamping0()), undefined);
  assert.equal(teksPratinjauPendamping({ satuan: "LEMBAR", mode: "AKTUAL", rasio: "", estimasi: "2" }, "10", "KG"), "10 KG — perkiraan 2 lembar");
  assert.equal(teksPratinjauPendamping({ satuan: "KALENG", mode: "TETAP", rasio: "12", estimasi: "" }, "3", "DUS"), "3 DUS — setara 36 kaleng");
  assert.equal(pendampingDariPO({ pendamping: { satuan: "LEMBAR", mode: "AKTUAL", estimasi: 2 } }).estimasi, "2");
  assert.equal(teksPendampingAktual({ pendamping: { satuan: "LEMBAR", mode: "AKTUAL", aktual: null } }), "lembar belum diisi");
  assert.equal(teksPendampingAktual({ pendamping: { satuan: "LEMBAR", mode: "AKTUAL", aktual: 1 } }), "1 lembar");
  assert.equal(jumlahTeks(1234.5), "1.234,5");
});

test("ringkas kuantitas daftar: datang dan masuk stok dari dipesan", () => {
  const r = ringkasKuantitas({ lines: [{ satuan: "KG", dipesan: 10, datang: 5, masukStok: 5, sisa: 5 }] });
  assert.equal(r.teks, "5 datang · 5 masuk stok / 10 KG"); assert.equal(r.persen, 50);
});

test("pemasangan: halaman Gudang tanpa harga, menu & rute, Finance memakai panel yang sama, drawer penerimaan mengarahkan ke Catat Barang Tiba", () => {
  const g = baca("../src/pages/warehouse/WarehouseBarangAkanDatang.jsx");
  assert.match(g, /api\.getBarangAkanDatang/); assert.match(g, /workspace="GUDANG"/);
  assert.doesNotMatch(g, /hargaSatuan|nilaiDipesan|totalDipesan|formatUang|Rp\b/, "Gudang tidak menampilkan harga/nilai");
  assert.match(baca("../src/routes/pageRegistry.jsx"), /"\/warehouse\/barang-akan-datang"/);
  assert.match(baca("../src/components/Layout.jsx"), /Barang Akan Datang/);
  assert.match(baca("../src/components/Topbar.jsx"), /Barang Akan Datang/);
  const fin = baca("../src/pages/finance/FinancePurchaseOrders.jsx");
  assert.match(fin, /<PanelKedatangan[\s\S]*workspace="FINANCE"/);
  assert.match(fin, /Jadwal jatuh tempo per penerimaan/); assert.match(fin, /Menunggu tanggal penerimaan/);
  assert.match(fin, /pendamping-po/);
  const panel = baca("../src/features/kedatangan/PanelKedatangan.jsx");
  assert.match(panel, /Dicatat otomatis atas nama akun Anda/); assert.match(panel, /Koreksi Kedatangan/); assert.match(panel, /Alasan koreksi/);
  assert.match(baca("../src/features/warehouse/components/GoodsReceiptDetailDrawer.jsx"), /catat-tiba-drawer/);
  assert.match(baca("../src/api.js"), /catatKedatanganGudang[\s\S]*Idempotency-Key/);
});
