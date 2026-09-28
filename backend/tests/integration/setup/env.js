// Side-effect ONLY — WAJIB jadi import PALING PERTAMA di setiap file test
// integrasi, SEBELUM file apa pun yang meng-import src/db.js (PrismaClient
// dibuat sekali saat modul itu pertama kali di-import, membaca
// process.env.DATABASE_URL PERSIS SAAT ITU — kalau env ini belum di-set,
// prisma singleton akan terlanjur menunjuk ke database yang salah dan
// tidak bisa diganti lagi untuk sisa proses).
//
// Pola sama dengan "dotenv/config" (side-effect import, tanpa named
// export) — lihat juga tests/integration/setup/bootstrapTestDb.js yang
// mengasumsikan urutan eksekusi ini.
import "dotenv/config"; // ambil JWT_SECRET dkk dari backend/.env yang sudah ada
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_TEST_DB_URL = "postgresql://klinik:KlinikMatras2026Aman@localhost:5432/klinik_matras_test";
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DB_URL;

// PAGAR KEAMANAN — SATU-SATUNYA yang berdiri antara test integrasi dan
// database sungguhan kalau TEST_DATABASE_URL suatu saat salah diset (mis.
// disalin dari .env produksi tanpa sengaja). Nama database WAJIB
// mengandung "test" — kalau tidak, PROSES BERHENTI TOTAL sebelum satu
// baris pun tersentuh, bukan cuma warning.
const dbNameMatch = TEST_DATABASE_URL.match(/\/([^/?]+)(\?.*)?$/);
const dbName = dbNameMatch ? dbNameMatch[1] : "";
if (!/test/i.test(dbName)) {
  throw new Error(
    `Menolak jalan: nama database tes "${dbName}" tidak mengandung "test". ` +
    `TEST_DATABASE_URL="${TEST_DATABASE_URL}". ` +
    `Ini pagar keamanan supaya salah konfigurasi TIDAK PERNAH bisa menulis ke database sungguhan.`
  );
}

process.env.DATABASE_URL = TEST_DATABASE_URL;

// Foto nota hasil upload tes (expenseSubmissions, financeTransactions /receipts/upload) SELALU ke folder sementara — bukan
// backend/data/finance-receipts (pernah 32 JPEG artefak tes ikut ter-commit). RECEIPTS_DIR dibaca saat services/finance/receipts.js
// diimpor, jadi ini wajib terjadi di sini (import pertama tiap tes). Dihapus saat proses tes selesai; receiptsTmpEnv.js boleh menimpanya.
const TMP_RECEIPTS = fs.mkdtempSync(path.join(os.tmpdir(), "km-receipts-"));
process.env.FINANCE_RECEIPTS_DIR = TMP_RECEIPTS;
process.on("exit", () => { try { fs.rmSync(TMP_RECEIPTS, { recursive: true, force: true }); } catch { /* sudah hilang */ } });
