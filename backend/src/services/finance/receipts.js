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
// Foto DIKOMPRES saat upload (lihat simpanFotoBukti) dan disimpan dengan nama =
// SHA-256 isi hasil kompres, jadi foto yang sama selalu punya URL yang sama —
// dasar deteksi "nota dipakai dua kali". Deteksi ini PERINGATAN, bukan blokir:
// satu nota sah bisa mencakup dua catatan (mis. belanja campuran bahan baku +
// perlengkapan). Catatan: foto yang dijepret ULANG dari nota yang sama
// menghasilkan file berbeda dan tidak terdeteksi — itu batas metode ini.

import { createHash } from "node:crypto";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettingRaw, parseIntOr, SETTING_KEYS } from "./settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// FINANCE_RECEIPTS_DIR hanya untuk tes/deploy khusus; default = data/finance-receipts.
export const RECEIPTS_DIR = process.env.FINANCE_RECEIPTS_DIR || path.join(__dirname, "../../../data/finance-receipts");
export const RECEIPTS_URL_PREFIX = "/media/finance-receipts";

// Kategori yang buktinya memang bukan nota toko (slip gaji/mutasi bank).
const KATEGORI_TANPA_NOTA = new Set(["GAJI_KARYAWAN", "UPAH_PRODUKSI", "ADMIN_BANK"]);

// Batas ukuran hasil kompres — cukup tajam untuk membaca angka & nama toko di
// nota, tapi jauh lebih kecil dari foto HP asli (biasanya 3–8 MB → ~150–400 KB).
// Sisi terpanjang dibatasi 2200px supaya nota panjang (struk) tetap terbaca.
const MAKS_LEBAR = 1600;
const MAKS_TINGGI = 2200;
const KUALITAS_UTAMA = 78;
const SISI_THUMB = 400;
const KUALITAS_THUMB = 70;

/**
 * Kompres foto bukti (seperti WhatsApp: diperkecil + JPEG, bukan HD asli),
 * simpan ke disk, balikkan URL publik. Yang disimpan:
 *   <hash>.jpg    foto utama terkompres (dibuka saat foto diklik)
 *   <hash>_t.jpg  thumbnail 400px (dipakai di tabel supaya daftar ringan)
 * Nama file = hash ISI HASIL KOMPRES → idempoten, dan dasar deteksi "nota
 * dipakai dua kali". Orientasi EXIF diterapkan lalu metadata (termasuk GPS
 * lokasi pemotretan) dibuang. `dir` hanya untuk tes.
 */
export async function simpanFotoBukti(buffer, { dir = RECEIPTS_DIR } = {}) {
  let utama;
  let kecil;
  try {
    const dasar = sharp(buffer, { failOn: "none" }).rotate().flatten({ background: "#ffffff" });
    utama = await dasar.clone()
      .resize({ width: MAKS_LEBAR, height: MAKS_TINGGI, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: KUALITAS_UTAMA, mozjpeg: true }).toBuffer();
    kecil = await dasar.clone()
      .resize({ width: SISI_THUMB, height: SISI_THUMB, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: KUALITAS_THUMB, mozjpeg: true }).toBuffer();
  } catch {
    throw Object.assign(new Error("File bukan gambar yang valid"), { statusCode: 400 });
  }

  const hash = createHash("sha256").update(utama).digest("hex").slice(0, 40);
  fs.mkdirSync(dir, { recursive: true });
  for (const [nama, isi] of [[`${hash}.jpg`, utama], [`${hash}_t.jpg`, kecil]]) {
    const target = path.join(dir, nama);
    if (!fs.existsSync(target)) fs.writeFileSync(target, isi);
  }
  return {
    url: `${RECEIPTS_URL_PREFIX}/${hash}.jpg`,
    ukuranAsli: buffer.length,
    ukuranAkhir: utama.length,
  };
}

/**
 * Apakah dokumen ini WAJIB bernota sebelum disetujui?
 *  - Pembelian: selalu.
 *  - Pengeluaran REIMBURSEMENT: selalu (uang ditalangi orang lain).
 *  - Pengeluaran lain: nominal >= ambang (default Rp500rb), kecuali kategori
 *    yang buktinya bukan nota (gaji, upah, admin bank).
 */
export async function ambangNota(db) {
  return parseIntOr(await getSettingRaw(db, SETTING_KEYS.RECEIPT_REQUIRED_THRESHOLD), 500000);
}

/** Aturan yang SAMA dengan notaWajib(), tanpa akses DB — untuk menandai banyak baris daftar sekaligus (ambang dibaca sekali). */
export function notaWajibDenganAmbang({ jenis, mode, amount, categoryCode }, ambang) {
  if (jenis === "purchase") return true;
  if (categoryCode && KATEGORI_TANPA_NOTA.has(categoryCode)) return false;
  if (mode === "REIMBURSEMENT") return true;
  return Number(amount) >= ambang;
}

export async function notaWajib(db, { jenis, mode, amount, categoryCode }) {
  return notaWajibDenganAmbang({ jenis, mode, amount, categoryCode }, await ambangNota(db));
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
