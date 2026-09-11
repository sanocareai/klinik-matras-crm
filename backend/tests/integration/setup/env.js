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
