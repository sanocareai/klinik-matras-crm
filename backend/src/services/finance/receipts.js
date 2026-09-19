// KEBIJAKAN BUKTI (NOTA) — pengeluaran & pembelian.
//
// Konteks (19 Sep 2026): yang menginput SEMUA transaksi adalah finance
// (Natasha) sendiri — bawahan yang ada pengadaan melapor ke dia. Jadi
// "approver memeriksa nota" tidak berfungsi sebagai kontrol (orangnya sama
// dengan pembuat). Desainnya karena itu dua lapis:
//   1. WAJIB NOTA sebelum disetujui (aturan di bawah) — memaksa nota
//      dari bawahan benar-benar diunggah, bukan cuma "nanti menyusul".
//   2. VERIFIKASI oleh ORANG LAIN — pembuat transaksi TIDAK BOLEH memverifikasi
//      buktinya sendiri (owner/admin lain mengecek berkala lewat antrean).
//
// Foto disimpan dengan nama = SHA-256 isi file, jadi foto yang persis sama
// selalu punya URL yang sama — itulah dasar deteksi "nota dipakai dua kali".
// Deteksi ini PERINGATAN, bukan blokir: satu nota sah bisa mencakup dua
// catatan (mis. belanja campuran bahan baku + perlengkapan).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettingRaw, parseIntOr, SETTING_KEYS } from "./settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RECEIPTS_DIR = path.join(__dirname, "../../../data/finance-receipts");
export const RECEIPTS_URL_PREFIX = "/media/finance-receipts";

// Kategori yang buktinya memang bukan nota toko (slip gaji/mutasi bank).
const KATEGORI_TANPA_NOTA = new Set(["GAJI_KARYAWAN", "UPAH_PRODUKSI", "ADMIN_BANK"]);

const EXT_BY_MIME = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif" };

/** Simpan buffer foto ke disk (idempoten — isi sama = file sama). Balikkan URL publik. */
export function simpanFotoBukti(buffer, mimetype) {
  const ext = EXT_BY_MIME[mimetype] || ".jpg";
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 40);
  const filename = `${hash}${ext}`;
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  const target = path.join(RECEIPTS_DIR, filename);
  if (!fs.existsSync(target)) fs.writeFileSync(target, buffer);
  return `${RECEIPTS_URL_PREFIX}/${filename}`;
}

/**
 * Apakah dokumen ini WAJIB bernota sebelum disetujui?
 *  - Pembelian: selalu.
 *  - Pengeluaran REIMBURSEMENT: selalu (uang ditalangi orang lain).
 *  - Pengeluaran lain: nominal >= ambang (default Rp500rb), kecuali kategori
 *    yang buktinya bukan nota (gaji, upah, admin bank).
 */
export async function notaWajib(db, { jenis, mode, amount, categoryCode }) {
  if (jenis === "purchase") return true;
  if (categoryCode && KATEGORI_TANPA_NOTA.has(categoryCode)) return false;
  if (mode === "REIMBURSEMENT") return true;
  const ambang = parseIntOr(await getSettingRaw(db, SETTING_KEYS.RECEIPT_REQUIRED_THRESHOLD), 500000);
  return Number(amount) >= ambang;
}

/** Lempar error kalau nota wajib tapi belum diunggah. */
export async function pastikanNotaLengkap(db, { jenis, doc, categoryCode, err }) {
  if (doc.receiptUrl) return;
  if (await notaWajib(db, { jenis, mode: doc.mode, amount: doc.amount, categoryCode })) {
    throw err(
      jenis === "purchase"
        ? "Pembelian wajib punya foto nota sebelum disetujui — unggah dulu buktinya."
        : "Pengeluaran ini wajib punya foto nota sebelum disetujui (reimbursement atau nominal di atas ambang) — unggah dulu buktinya.",
      422
    );
  }
}

/** Dokumen lain (bukan dirinya) yang memakai foto yang sama & belum batal/ditolak. */
export async function cariPemakaiBukti(db, receiptUrl, { kecuali = null } = {}) {
  const aktif = { status: { notIn: ["DIBATALKAN", "DITOLAK"] }, receiptUrl };
  const [ex, pu] = await Promise.all([
    db.finExpense.findMany({ where: { ...aktif, ...(kecuali ? { id: { not: kecuali } } : {}) }, select: { expenseNumber: true }, take: 5 }),
    db.finPurchase.findMany({ where: { ...aktif, ...(kecuali ? { id: { not: kecuali } } : {}) }, select: { purchaseNumber: true }, take: 5 }),
  ]);
  return [...ex.map((e) => e.expenseNumber), ...pu.map((p) => p.purchaseNumber)];
}

export async function tanggalMulaiKebijakan(db) {
  const raw = await getSettingRaw(db, SETTING_KEYS.RECEIPT_POLICY_SINCE);
  const d = new Date(`${raw}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? new Date("2026-09-19T00:00:00+07:00") : d;
}
