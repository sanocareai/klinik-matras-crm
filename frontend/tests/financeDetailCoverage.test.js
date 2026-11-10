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
  "FinanceSuppliers.jsx", "FinanceLedger.jsx", "FinanceReconciliation.jsx", "FinancePenjualanKaryawan.jsx", "FinancePengecualianLunas.jsx",
];
// Detail lewat dialog/panel milik komponen lain yang dipanggil dari baris.
const DETAIL_SENDIRI = {
  "FinancePayments.jsx": "baris/kartu membuka PanelPemeriksaan (pemeriksaan bukti + tindakan) via DaftarPembayaran.bukaBaris → onPeriksa",
  "FinancePemasukan.jsx": "klik baris memanggil onBuka(b) → rincian sumber pemasukan",
  "FinanceCash.jsx": "Kas & Bank (redesain): klik kartu rekening membuka Mutasi Buku; klik baris mutasi/transfer/pemasukan lain membuka RincianKb (panel samping sendiri, features/finance/kasbank/); menu rekening punya Rincian rekening",
  "FinanceInvoices.jsx": "klik baris memanggil onBuka(inv) → RincianInvoice (panel samping sendiri, features/finance/InvoicePanels.jsx); tombol chevron membuka rincian yang sama",
  "FinanceJournal.jsx": "klik baris membuka detail jurnal (setDetail)",
  "FinanceBiayaBahan.jsx": "klik unit membuka panel jejak biaya (JejakBiayaBahan) di sebelah daftar",
  "FinanceHppOrder.jsx": "klik baris antrean membuka PanelUnit (baris biaya, catatan tertahan, form biaya tanpa stok); persetujuan menampilkan rincian per entri; laporan punya jembatan per baris jurnal",
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
    if (f === "FinancePurchases.jsx") {
      // Redesain Pembelian: satu daftar `fin-dl` melayani desktop & HP; klik/Enter/Spasi pada baris membuka panel, aksi di dalam baris (tombol, menu, input) tidak ikut membuka.
      assert.match(s, /const buka = \(\) => setPanelRincian\(specPembelian\(/, `${f}: baris harus membuka panel rincian pembelian`);
      assert.ok(s.includes(`onClick={(e) => { if (e.target.closest("button, a, input, select, textarea, label, [role='menuitem'], [data-tanpa-detail]")) return; buka(); }}`), `${f}: klik baris harus mengabaikan kontrol di dalamnya`);
      assert.ok(s.includes('e.key === "Enter" || e.key === " "'), `${f}: baris harus bisa dibuka dengan Enter/Spasi`);
      continue;
    }
    if (f === "FinanceSuppliers.jsx") {
      // Tab Pembayaran & Daftar supplier memakai daftar `fin-dl`; baris Tagihan dibuka di DaftarTagihan (diuji di tagihanTabelLayout/uji Tagihan). Klik baris mengabaikan kontrol di dalamnya.
      const klik = s.match(/onClick=\{\(e\) => \{ if \(e\.target\.closest\("button, a, input, select, \[role='menuitem'\], \[data-tanpa-detail\]"\)\) return; setPanelRincian\(specOtomatis\(/g) || [];
      assert.ok(klik.length >= 2, `${f}: baris Pembayaran & Supplier harus bisa diklik (ditemukan ${klik.length})`);
      assert.ok(s.includes('e.key === "Enter" || e.key === " "'), `${f}: baris harus bisa dibuka dengan Enter/Spasi`);
      continue;
    }
    assert.match(s, /klikBuka\(\(\) => (setPanelRincian|onBuka)\(/, `${f}: baris tabel belum bisa diklik (klikBuka)`);
  }
  const panelPengeluaran = baca(path.join(akar, "src/features/finance/PengeluaranPanels.jsx"));
  assert.match(panelPengeluaran, /klikBuka\(buka\)/, "Pengeluaran: baris daftar harus bisa diklik (klikBuka)");
  assert.match(panelPengeluaran, /propBaris\(\(\) => onBuka\(e\)\)/, "Pengeluaran: klik baris memanggil onBuka(e)");
  const panelKas = baca(path.join(akar, "src/features/finance/kasbank/TransferPanels.jsx"));
  assert.ok(panelKas.includes("klikBuka(buka)"), "Kas & Bank: baris transfer/pemasukan lain harus bisa diklik (klikBuka)");
  assert.ok(panelKas.includes("propBaris(() => onBuka(t))"), "Kas & Bank: klik baris transfer memanggil onBuka(t)");
  assert.ok(baca(path.join(akar, "src/features/finance/kasbank/MutasiBukuKb.jsx")).includes("propBaris(() => onBuka(b))"), "Kas & Bank: klik baris mutasi memanggil onBuka(b)");
  assert.ok(baca(path.join(halaman, "FinanceCash.jsx")).includes("<RincianKb spec={panelRincian}"), "Kas & Bank: RincianKb tidak dipasang");
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
  // Pembelian ikut pola yang sama (tanpa RowCard): daftar `fin-dl` dengan baris role="row" yang bisa diklik (diuji di atas).
  assert.doesNotMatch(baca(path.join(halaman, "FinancePurchases.jsx")), /<RowCard\n/, "Pembelian: tidak lagi memakai RowCard");
  for (const f of ["FinanceKasbon.jsx", "FinanceUangMuka.jsx", "FinanceReceivables.jsx", "FinancePenjualanKaryawan.jsx", "FinancePengecualianLunas.jsx"]) {
    const s = baca(path.join(halaman, f));
    const kartu = (s.match(/<RowCard\n/g) || []).length;
    const ber = (s.match(/<RowCard\n\s+key=\{[^}]+\}\n\s+onClick=/g) || []).length;
    assert.ok(kartu > 0 && ber === kartu, `${f}: ${kartu} RowCard tetapi hanya ${ber} yang punya onClick`);
  }
});

test("Tagihan supplier: baris daftar dibuka lewat klik & Enter/Spasi (aksi di baris tidak ikut membuka), rincian punya panel sendiri dengan akses ke seluruh bidang dokumen", () => {
  const d = baca(path.join(akar, "src/features/finance/tagihan/DaftarTagihan.jsx"));
  assert.ok(d.includes("onClick={bukaDariKlik}") && d.includes('e.key === "Enter" || e.key === " "'));
  assert.ok(d.includes(`closest("button, a, input, select, textarea, [role='menuitem'], [data-tanpa-detail]")`));
  const r = baca(path.join(akar, "src/features/finance/tagihan/RincianTagihan.jsx"));
  assert.ok(r.includes("Semua rincian dokumen") && r.includes("spec?.bagian"));
  const hal = baca(path.join(halaman, "FinanceSuppliers.jsx")); assert.ok(hal.includes("<RincianTagihan") && hal.includes("specOtomatis("));
});

test("PanelDetail: klik pada tombol/tautan/portal tidak membuka panel; Enter/Spasi membuka; dokumentasi penggunaan ada", () => {
  const s = baca(path.join(akar, "src/features/finance/PanelDetail.jsx"));
  assert.match(s, /e\.currentTarget\.contains\(e\.target\)/, "peristiwa dari portal harus diabaikan");
  assert.match(s, /closest\("button, a, input, select, textarea, label/, "elemen interaktif di dalam baris harus diabaikan");
  assert.match(s, /e\.key === "Enter" \|\| e\.key === " "/, "akses keyboard");
});
