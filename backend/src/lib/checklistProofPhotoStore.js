// Penyimpanan foto bukti Checklist Persiapan Perjalanan — dir TERPISAH dari
// data/job-photos (audit keamanan, 7 Okt 2026: "verifikasi akses URL foto
// checklist langsung — tanpa login, driver lain, pengguna berwenang").
//
// job-photos disajikan express.static TANPA auth (keamanan = nama berkas
// tak-tertebak saja) — itu sudah pola yang diterima untuk bukti job
// biasa, TAPI permintaan checklist fase ini eksplisit: "perbaiki jika
// bukti bisa bocor". Foto checklist sekarang disimpan di direktori yang
// TIDAK PERNAH di-mount sebagai express.static (lihat index.js) — satu-
// satunya jalan baca adalah routes/checklistProofMedia.js (Bearer+
// kepemilikan rute ATAU URL bertanda-tangan berumur pendek), pola SAMA
// PERSIS dengan data/production-unit-photos (lib/productionUnitPhotoStore.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CHECKLIST_PROOF_PHOTO_DIR = path.join(__dirname, "../../data/checklist-proof-photos");

export function ensureChecklistProofPhotoDir() {
  if (!fs.existsSync(CHECKLIST_PROOF_PHOTO_DIR)) fs.mkdirSync(CHECKLIST_PROOF_PHOTO_DIR, { recursive: true });
}

// Nama berkas SELALU dibuat server (multer filename callback, lihat
// routes/armada.js) — pola ini cuma lapis validasi kedua sebelum path.join,
// bukan satu-satunya pertahanan (sama prinsipnya dengan UNIT_PHOTO_FILE_PATTERN).
export const CHECKLIST_PROOF_FILE_PATTERN = /^[a-f0-9]{32}\.jpg$/;
