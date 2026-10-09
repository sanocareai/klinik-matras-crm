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
    { id: "l1", kode: "BUSA-R50", nama: "Busa", satuan: "KG", dipesan: 10, belumDatang: 10, belumDipenuhiSupplier: 10, menungguPengganti: 0, pendamping: { satuan: "LEMBAR", mode: "AKTUAL", rasio: null, estimasi: 2, aktual: null, teks: "perkiraan 2 lembar" } },
    { id: "l2", kode: "LEM-1", nama: "Lem", satuan: "DUS", dipesan: 3, belumDatang: 3, belumDipenuhiSupplier: 3, menungguPengganti: 0, pendamping: { satuan: "KALENG", mode: "TETAP", rasio: 12, estimasi: 36, aktual: null, teks: "setara 36 kaleng" } },
    { id: "l3", kode: "KAIN", nama: "Kain", satuan: "METER", dipesan: 5, belumDatang: 0, belumDipenuhiSupplier: 0, menungguPengganti: 0, pendamping: null },
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
  f.lines[0].jumlahDatang = "11"; assert.match(galatKedatangan(f), /melebihi yang belum datang.*merevisi jumlah PO/);
  f.lines[0].jumlahDatang = "5"; assert.equal(galatKedatangan(f), null);
  assert.deepEqual(kekuranganIsian(f), ["Surat jalan belum dilampirkan", "Bukti kedatangan belum dilampirkan", "Jumlah lembar aktual BUSA-R50 belum diisi"]);
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

test("ringkas kuantitas daftar: dibaca dari server (po.progres), tidak dihitung ulang di layar", () => {
  const r = ringkasKuantitas({ lines: [{ satuan: "KG", dipesan: 10, datang: 8, masukStok: 5 }], progres: { teks: "5 / 10 KG masuk stok · 8 sudah datang", persenMasukStok: 50 } });
  assert.equal(r.teks, "5 / 10 KG masuk stok · 8 sudah datang"); assert.equal(r.persen, 50);
  assert.equal(ringkasKuantitas({ lines: [] }).persen, 0, "tanpa progres dari server: tidak mengarang angka");
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

test("progres: semua angka & definisi dari server — tidak ada label Sisa tanpa arti, tidak ada hitung ulang di layar", () => {
  const panel = baca("../src/features/kedatangan/PanelKedatangan.jsx");
  assert.doesNotMatch(panel, /<TH[^>]*>\s*Sisa\s*</, "tidak ada kolom Sisa polos");
  assert.doesNotMatch(panel, /dt className="text-ink3">Sisa</);
  assert.match(panel, /definisi=\{po\.progresDefinisi\}/); assert.match(panel, /LegendaProgres/); assert.match(panel, /title=\{d\.definisi\}/);
  const fin = baca("../src/pages/finance/FinancePurchaseOrders.jsx");
  assert.match(fin, /l\.progres\.belumDatang/); assert.match(fin, /l\.progres\.masukStok/); assert.match(fin, /l\.progres\.belumMasukStok/);
  assert.doesNotMatch(fin, /l\.belumDiterima|l\.diterimaBaik/, "Finance tidak lagi memakai kolom lama");
  assert.match(fin, /<LegendaProgres definisi=\{po\.progresDefinisi\}/);
  const logic = baca("../src/features/kedatangan/kedatanganLogic.js") + baca("../src/features/finance/purchaseOrderLogic.js");
  assert.doesNotMatch(logic, /\.reduce\(\(s, l\) => s \+ Math\.min\(l\.(masukStok|diterimaBaik)/, "ringkasan progres tidak dijumlah di klien");
});

test("Finance-first: tombol Catat Barang Tiba di PO menyiapkan draf idempoten dulu (Finance & Gudang), disembunyikan bila draf sudah ada; surat jalan/bukti kosong tampil Belum dilampirkan", () => {
  const panel = baca("../src/features/kedatangan/PanelKedatangan.jsx");
  assert.match(panel, /siapkanDrafKedatanganFinance/); assert.match(panel, /siapkanDrafKedatanganGudang/);
  assert.match(panel, /bisaMenerima && !adaDraf/);
  assert.match(panel, /receiptId=\{dialog\.receiptId \?\? null\}/);
  const api = baca("../src/api.js");
  assert.match(api, /siapkanDrafKedatanganFinance[\s\S]*draf-penerimaan/); assert.match(api, /siapkanDrafKedatanganGudang[\s\S]*draf-penerimaan/);
  assert.match(panel, /Belum dilampirkan/g);
  assert.ok((panel.match(/Belum dilampirkan/g) ?? []).length >= 2, "surat jalan dan bukti");
});

test("formulir: tidak melebihi yang belum datang (dari server); pendamping aktual negatif ditolak di layar", () => {
  const po = { orderDate: "2026-10-01", lines: [{ id: "l1", kode: "BUSA", nama: "Busa", satuan: "KG", dipesan: 10, belumDatang: 2, belumDipenuhiSupplier: 2, menungguPengganti: 0, pendamping: { satuan: "LEMBAR", mode: "AKTUAL", rasio: null, estimasi: 2 } }] };
  const f = formKedatanganAwal(po);
  f.penerima = "Budi"; f.catatan = "ok"; f.tanggalTiba = "2026-10-05";
  f.lines[0].jumlahDatang = "3";
  assert.match(galatKedatangan(f, { tanggalPO: po.orderDate }), /melebihi yang belum datang \(2 KG\)/);
  f.lines[0].jumlahDatang = "2"; f.lines[0].jumlahPendamping = "-1";
  assert.match(galatKedatangan(f, { tanggalPO: po.orderDate }), /tidak boleh negatif/);
  f.lines[0].jumlahPendamping = "1"; assert.equal(galatKedatangan(f, { tanggalPO: po.orderDate }), null);
});

test("pengganti: item yang menunggu pengganti ditawarkan walau belum datang 0; centang pengganti dibatasi sisa penolakan, tidak menaikkan batas PO; body membawa pengganti", () => {
  const po = { orderDate: "2026-10-01", lines: [{ id: "l1", kode: "BUSA", nama: "Busa", satuan: "KG", dipesan: 10, belumDatang: 0, menungguPengganti: 1, belumDipenuhiSupplier: 1, asalPengganti: [{ lineId: "x", sisa: 1 }], pendamping: null }] };
  const f = formKedatanganAwal(po);
  assert.equal(f.lines.length, 1, "tetap ditawarkan karena menunggu pengganti");
  f.penerima = "Budi"; f.catatan = "ok"; f.tanggalTiba = "2026-10-05"; f.lines[0].jumlahDatang = "1";
  assert.match(galatKedatangan(f, { tanggalPO: po.orderDate }), /melebihi yang belum datang.*centang pengiriman pengganti/, "tanpa centang: dibatasi belum datang (0) dan diberi petunjuk");
  f.lines[0].pengganti = true; assert.equal(galatKedatangan(f, { tanggalPO: po.orderDate }), null);
  f.lines[0].jumlahDatang = "2"; assert.match(galatKedatangan(f, { tanggalPO: po.orderDate }), /menunggu pengganti \(1 KG\)/);
  f.lines[0].jumlahDatang = "1";
  assert.equal(bodyKedatangan(f, "r1").lines[0].pengganti, true);
  assert.equal("pengganti" in bodyKedatangan({ ...f, lines: [{ ...f.lines[0], pengganti: false }] }, "r1").lines[0], false);
  const panel = baca("../src/features/kedatangan/PanelKedatangan.jsx");
  assert.match(panel, /centang-pengganti/); assert.match(panel, /Pengganti untuk/); assert.match(panel, /belumDipenuhiSupplier/);
});

test("pengganti: pilihan penolakan asal membatasi jumlah pengganti per baris asal; body membawa penggantiDariBarisId", () => {
  const po = { orderDate: "2026-10-01", lines: [{ id: "l1", kode: "BUSA", nama: "Busa", satuan: "KG", dipesan: 10, belumDatang: 0, menungguPengganti: 3, belumDipenuhiSupplier: 3, asalPengganti: [{ lineId: "a1", receiptNumber: "GR-1", sisa: 1 }, { lineId: "a2", receiptNumber: "GR-2", sisa: 2 }], pendamping: null }] };
  const f = formKedatanganAwal(po);
  assert.equal(f.lines[0].asalId, "a1", "bawaan = penolakan tertua");
  f.penerima = "Budi"; f.catatan = "ok"; f.tanggalTiba = "2026-10-05"; f.lines[0].pengganti = true; f.lines[0].jumlahDatang = "2";
  assert.match(galatKedatangan(f, { tanggalPO: po.orderDate }), /menunggu pengganti \(1 KG\)/, "asal GR-1 hanya 1 KG");
  f.lines[0].asalId = "a2"; assert.equal(galatKedatangan(f, { tanggalPO: po.orderDate }), null, "asal GR-2 sisa 2 KG");
  assert.deepEqual([bodyKedatangan(f, "r1").lines[0].pengganti, bodyKedatangan(f, "r1").lines[0].penggantiDariBarisId], [true, "a2"]);
  const panel = baca("../src/features/kedatangan/PanelKedatangan.jsx");
  assert.match(panel, /pilih-asal-pengganti/); assert.match(panel, /batas-pengganti/); assert.match(panel, /Batas jumlah pengganti/);
});

test("progres: rincian berlabel Indonesia dari definisi server (asli tiba, pengganti tiba, total fisik tiba, belum datang, menunggu pengganti, baik belum disimpan, belum dipenuhi supplier, belum masuk stok)", () => {
  const src = fs.readFileSync(path.join(dir, "../../backend/src/services/finance/progresPO.js"), "utf8");
  for (const label of ["Pengiriman asli tiba", "Pengganti tiba", "Total fisik tiba", "Belum datang", "Menunggu pengganti", "Baik belum disimpan", "Belum dipenuhi supplier", "Belum masuk stok"]) assert.ok(src.includes(`label: "${label}"`), label);
  assert.match(baca("../src/features/kedatangan/PanelKedatangan.jsx"), /definisi\.filter\(\(d\) => d\.kunci !== "dipesan"\)/, "kolom progres = definisi server (tidak ditulis ulang di layar)");
});
