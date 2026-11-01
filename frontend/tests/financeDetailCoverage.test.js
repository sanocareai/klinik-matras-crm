// COVERAGE PANEL DETAIL FINANCE: setiap halaman Finance yang punya daftar/tabel harus bisa dibuka rinciannya dengan klik baris (panel samping),
// ATAU tercantum sebagai halaman dengan mekanisme detail sendiri / tanpa daftar dokumen. Halaman baru yang lupa diklasifikasikan membuat tes ini gagal.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const halaman = path.join(akar, "src/pages/finance");
const baca = (p) => fs.readFileSync(p, "utf8").split("\r\n").join("\n");

// Memakai PanelDetail + klikBuka (klik baris/kartu membuka panel samping).
const PANEL = [
  "FinanceExpenses.jsx", "FinancePurchases.jsx", "FinanceKasbon.jsx", "FinanceUangMuka.jsx", "FinanceReceivables.jsx",
  "FinanceSuppliers.jsx", "FinanceCash.jsx", "FinanceLedger.jsx", "FinanceReconciliation.jsx", "FinancePenjualanKaryawan.jsx", "FinancePengecualianLunas.jsx",
];
// Detail lewat dialog/panel milik komponen lain yang dipanggil dari baris.
const DETAIL_SENDIRI = {
  "FinancePayments.jsx": "baris/kartu membuka PanelPemeriksaan (pemeriksaan bukti + tindakan) via DaftarPembayaran.bukaBaris → onPeriksa",
  "FinancePemasukan.jsx": "klik baris memanggil onBuka(b) → rincian sumber pemasukan",
  "FinanceInvoices.jsx": "klik baris memanggil onBuka(inv) → RincianInvoice (panel samping sendiri, features/finance/InvoicePanels.jsx); tombol chevron membuka rincian yang sama",
  "FinanceJournal.jsx": "klik baris membuka detail jurnal (setDetail)",
  "FinanceBiayaBahan.jsx": "klik unit membuka panel jejak biaya (JejakBiayaBahan) di sebelah daftar",
  "FinancePurchaseOrders.jsx": "klik baris membuka ModalDetailPO (setDetailId): item, progres penerimaan, tagihan, riwayat",
  "FinanceReturSupplier.jsx": "klik kartu retur / debit note membuka dialog rincian (DetailRetur, DialogDebitNote: jurnal & dampak dari server); saldo kredit punya dialog pakai/batal sendiri",
  "FinanceLaporanDivisi.jsx": "drill-down sendiri di features/laporanDivisi: kategori → Transaksi (dokumen sumber + aturan atribusi) → tombol 'Buka di Finance' ke modul sumber",
};
const TANPA_DAFTAR = {
  "FinanceDashboard.jsx": "kartu KPI/grafik", "FinanceReports.jsx": "laporan terhitung", "FinanceAccounts.jsx": "master bagan akun (diedit inline)",
  "FinanceSettings.jsx": "konfigurasi", "FinancePersediaanAwal.jsx": "alur input snapshot",
};

test("setiap halaman Finance: punya panel detail (klik baris), detail sendiri, atau tercantum tanpa daftar dokumen", () => {
  const berkas = fs.readdirSync(halaman).filter((f) => /^Finance.*\.jsx$/.test(f));
  for (const f of berkas) {
    assert.ok(PANEL.includes(f) || f in DETAIL_SENDIRI || f in TANPA_DAFTAR, `halaman ${f} belum diklasifikasikan di financeDetailCoverage.test.js (panel detail / detail sendiri / tanpa daftar)`);
  }
  for (const f of PANEL) {
    const s = baca(path.join(halaman, f));
    assert.match(s, /<PanelDetail spec=\{panelRincian\}/, `${f}: PanelDetail tidak dipasang`);
    // Pengeluaran merender daftarnya lewat features/finance/PengeluaranPanels.jsx (klikBuka ada di sana; halaman hanya menyambungkan onBuka ke panel).
    if (f === "FinanceExpenses.jsx") { assert.match(s, /onBuka=\{\(e\) => setPanelRincian\(/, `${f}: onBuka daftar harus membuka panel rincian`); continue; }
    assert.match(s, /klikBuka\(\(\) => (setPanelRincian|onBuka)\(/, `${f}: baris tabel belum bisa diklik (klikBuka)`);
  }
  const panelPengeluaran = baca(path.join(akar, "src/features/finance/PengeluaranPanels.jsx"));
  assert.match(panelPengeluaran, /klikBuka\(buka\)/, "Pengeluaran: baris daftar harus bisa diklik (klikBuka)");
  assert.match(panelPengeluaran, /propBaris\(\(\) => onBuka\(e\)\)/, "Pengeluaran: klik baris memanggil onBuka(e)");
  const panelInvoice = baca(path.join(akar, "src/features/finance/InvoicePanels.jsx"));
  assert.match(panelInvoice, /klikBuka\(buka\)/, "Invoice: baris daftar harus bisa diklik (klikBuka)");
  assert.match(panelInvoice, /propBaris\(\(\) => onBuka\(inv\)\)/, "Invoice: klik baris memanggil onBuka(inv)");
  assert.match(baca(path.join(halaman, "FinanceInvoices.jsx")), /onBuka=\{setPanelRincian\}/, "Invoice: onBuka daftar harus membuka rincian");
  assert.match(baca(path.join(halaman, "FinanceInvoices.jsx")), /<RincianInvoice invoice=\{panelRincian\}/, "Invoice: RincianInvoice tidak dipasang");
  // Verifikasi pembayaran: klik baris/kartu MEMBUKA panel pemeriksaan (tidak memverifikasi); panel memuat bukti, rekening tujuan, dan tindakan.
  const daftarBayar = baca(path.join(akar, "src/features/finance/verifikasi/DaftarPembayaran.jsx"));
  assert.match(daftarBayar, /onClick=\{\(e\) => bukaBaris\(e, p\)\}/, "Pembayaran: klik baris harus membuka panel pemeriksaan");
  assert.match(daftarBayar, /fin-vf-kartu-klik" onClick=\{\(e\) => bukaBaris\(e, p\)\}/, "Pembayaran: kartu (HP) juga bisa dibuka");
  assert.match(baca(path.join(halaman, "FinancePayments.jsx")), /<PanelPemeriksaan model=\{panel\}/, "Pembayaran: PanelPemeriksaan harus dipasang");
});

test("halaman berdaftar dengan kartu (HP) juga bisa dibuka: RowCard memakai onClick", () => {
  // Pengeluaran tidak lagi memakai RowCard: satu daftar <li> melayani desktop & HP (CSS container query); seluruh baris diklik lewat klikBuka (diuji di atas).
  for (const f of ["FinancePurchases.jsx", "FinanceKasbon.jsx", "FinanceUangMuka.jsx", "FinanceReceivables.jsx", "FinanceSuppliers.jsx", "FinancePenjualanKaryawan.jsx", "FinancePengecualianLunas.jsx"]) {
    const s = baca(path.join(halaman, f));
    const kartu = (s.match(/<RowCard\n/g) || []).length;
    const ber = (s.match(/<RowCard\n\s+key=\{[^}]+\}\n\s+onClick=/g) || []).length;
    assert.ok(kartu > 0 && ber === kartu, `${f}: ${kartu} RowCard tetapi hanya ${ber} yang punya onClick`);
  }
});

test("PanelDetail: klik pada tombol/tautan/portal tidak membuka panel; Enter/Spasi membuka; dokumentasi penggunaan ada", () => {
  const s = baca(path.join(akar, "src/features/finance/PanelDetail.jsx"));
  assert.match(s, /e\.currentTarget\.contains\(e\.target\)/, "peristiwa dari portal harus diabaikan");
  assert.match(s, /closest\("button, a, input, select, textarea, label/, "elemen interaktif di dalam baris harus diabaikan");
  assert.match(s, /e\.key === "Enter" \|\| e\.key === " "/, "akses keyboard");
});
