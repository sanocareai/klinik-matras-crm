// COVERAGE EXPORT EXCEL FINANCE (B3.9): setiap halaman Finance harus punya tombol export untuk modul yang benar, ATAU tercantum sebagai
// "tidak diekspor" dengan alasan (docs/FINANCE-EXPORT-COVERAGE.md). Halaman baru yang lupa diklasifikasikan membuat tes ini gagal.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const halaman = path.join(akar, "frontend/src/pages/finance");
const exportDir = path.join(akar, "backend/src/services/finance/export");
const baca = (p) => fs.readFileSync(p, "utf8");

const DIEKSPOR = {
  "FinancePemasukan.jsx": ["pemasukan"],
  "FinancePayments.jsx": ["pembayaran"],
  "FinanceExpenses.jsx": ["pengeluaran"],
  "FinancePurchases.jsx": ["pembelian"],
  "FinanceKasbon.jsx": ["kasbon"],
  "FinanceUangMuka.jsx": ["uang-muka"],
  "FinanceReceivables.jsx": ["piutang-refund"],
  "FinanceSuppliers.jsx": ["supplier-utang"],
  "FinanceReconciliation.jsx": ["rekonsiliasi"],
  "FinanceJournal.jsx": ["jurnal-umum"],
  "FinanceLedger.jsx": ["buku-besar"],
};
// Tombol export yang hidup di komponen fitur (bukan langsung di halaman): kartu Selisih Sales–Finance di Pembayaran & Verifikasi.
const DIEKSPOR_DI_FITUR = { "src/features/finance/KartuSelisihSalesFinance.jsx": ["rekon-sales-finance"] };
// Export lewat ENDPOINT SENDIRI (izin per divisi, bukan registri modul Finance): Laporan Divisi (Fase 2) — POST /api/laporan-divisi/export.
const DIEKSPOR_ENDPOINT_SENDIRI = { "FinanceLaporanDivisi.jsx": { komponen: "src/features/laporanDivisi/LaporanDivisi.jsx", panggilan: "api.exportLaporanDivisi" } };
// Sengaja TIDAK diekspor (alasan lengkap di docs/FINANCE-EXPORT-COVERAGE.md bagian B).
const TIDAK_DIEKSPOR = {
  "FinanceDashboard.jsx": "kartu KPI/grafik, tanpa tabel transaksi",
  "FinanceCash.jsx": "Kas & Bank: Pemasukan Lain tercakup export Pemasukan; mutasi/saldo tercakup Buku Besar, Jurnal Umum, Rekonsiliasi",
  "FinanceInvoices.jsx": "faktur pelanggan; tercakup Piutang & Refund dan Pembayaran",
  "FinancePersediaanAwal.jsx": "alur input/pemeriksaan snapshot cutover",
  "FinanceReports.jsx": "laporan terhitung (Laba Rugi/Neraca/Arus Kas/Neraca Saldo), ditelusuri dari Buku Besar & Jurnal Umum",
  "FinanceAccounts.jsx": "master bagan akun",
  "FinanceSettings.jsx": "konfigurasi",
};

test("setiap halaman Finance: punya tombol export modul yang benar atau tercantum sebagai tidak diekspor", () => {
  const berkas = fs.readdirSync(halaman).filter((f) => /^Finance.*\.jsx$/.test(f));
  for (const f of berkas) {
    assert.ok(f in DIEKSPOR || f in TIDAK_DIEKSPOR || f in DIEKSPOR_ENDPOINT_SENDIRI, `halaman ${f} belum diklasifikasikan (export atau tidak) di financeExportCoverage.test.js + docs/FINANCE-EXPORT-COVERAGE.md`);
  }
  for (const [f, moduls] of Object.entries(DIEKSPOR)) {
    const s = baca(path.join(halaman, f));
    for (const m of moduls) {
      assert.match(s, new RegExp(`<TombolExportExcel[^>]*modul="${m}"`, "s"), `${f}: tombol export modul "${m}" tidak ada`);
    }
    assert.match(s, /ambilBody=/, `${f}: tombol export harus mengirim filter aktif (ambilBody)`);
  }
  for (const [f, { komponen, panggilan }] of Object.entries(DIEKSPOR_ENDPOINT_SENDIRI)) {
    assert.match(baca(path.join(akar, "frontend", komponen)), new RegExp(panggilan.replace(".", "\.")), `${f}: komponen ${komponen} tidak memanggil ${panggilan}`);
    assert.match(baca(path.join(akar, "docs/FINANCE-EXPORT-COVERAGE.md")), /laporan-divisi/, "dokumen coverage belum memuat Laporan Divisi");
  }
  for (const f of Object.keys(TIDAK_DIEKSPOR)) assert.doesNotMatch(baca(path.join(halaman, f)), /<TombolExportExcel/, `${f}: tercantum tidak diekspor tetapi punya tombol — perbarui daftar & dokumen`);
});

test("setiap modul yang dipanggil tombol ada di registri backend; 12 modul semuanya punya tombol; dokumen coverage memuat tiap modul & halaman", () => {
  const modulBackend = fs.readdirSync(exportDir).filter((f) => f.endsWith(".js") && !["excel.js", "registry.js", "label.js"].includes(f)).map((f) => f.replace(/\.js$/, ""));
  const dipakai = new Set([...Object.values(DIEKSPOR).flat(), ...Object.values(DIEKSPOR_DI_FITUR).flat()]);
  for (const [f, moduls] of Object.entries(DIEKSPOR_DI_FITUR)) for (const m of moduls) assert.match(baca(path.join(akar, "frontend", f)), new RegExp(`<TombolExportExcel[^>]*modul="${m}"`, "s"), `${f}: tombol export modul "${m}" tidak ada`);
  for (const m of dipakai) assert.ok(modulBackend.includes(m), `modul "${m}" dipanggil halaman tetapi tidak ada di backend/src/services/finance/export`);
  for (const m of modulBackend) assert.ok(dipakai.has(m), `modul backend "${m}" tidak punya tombol di halaman mana pun`);
  assert.equal(modulBackend.length, 12);
  const doc = baca(path.join(akar, "docs/FINANCE-EXPORT-COVERAGE.md"));
  for (const m of modulBackend) assert.ok(doc.includes(`\`${m}\``), `dokumen coverage belum memuat modul ${m}`);
});
