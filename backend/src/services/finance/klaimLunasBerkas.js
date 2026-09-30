// BERKAS BUKTI PEMBAYARAN untuk Klaim Lunas Sales — seluruh perlindungan upload ada di sini (satu tempat, bisa dites tanpa HTTP).
//
// Kenapa bukan jalur lama (/orders/:id/payments/proof): jalur itu menerima tipe dari header klien (`file.mimetype`) dan mempertahankan ekstensi dari
// NAMA file klien, lalu menyajikannya lewat express.static publik. Berkas ".html" berlabel "image/png" akan tersimpan dan tersaji dari origin aplikasi.
// Di sini: (1) tipe ditentukan dari ISI berkas (magic bytes) — label klien diabaikan; (2) ekstensi/nama di disk dibuat server (acak), nama klien hanya
// disimpan sebagai label tampilan yang sudah dibersihkan; (3) batas ukuran; (4) TIDAK pernah disajikan statis — hanya lewat
// routes/klaimLunas.js#klaimLunasFilePathRouter (Bearer pemilik/Finance atau URL bertanda-tangan berumur pendek, label kunci terpisah dari media lain).

import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { signFile, verifyFileSignature } from "../../lib/mediaSigning.js";

export const KLAIM_DIR = process.env.KLAIM_LUNAS_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../data/klaim-lunas");

export const MAKS_UKURAN_BYTE = 8 * 1024 * 1024;
export const MAKS_BERKAS_PER_KLAIM = 10;
export const URL_PREFIX = "/media/klaim-lunas";
export const KUNCI_TTL_DETIK = 15 * 60;
const PURPOSE = "klaim-lunas-v1";
/** Nama berkas di disk: 32 heks acak + ekstensi dari tipe TERDETEKSI. Pola ini juga yang diterima penyaji. */
export const POLA_NAMA = /^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/;

export class BerkasError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = "BerkasError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Tentukan tipe dari ISI berkas. null = bukan tipe yang diizinkan (JPEG, PNG, WEBP, PDF). */
export function deteksiTipe(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  return null;
}

/** Nama label untuk tampilan: buang path, karakter kontrol & pemisah, batasi panjang. Bukan dipakai sebagai nama di disk. */
export function bersihkanNamaAsli(nama) {
  const dasar = String(nama ?? "").split(/[\\/]/).pop() || "";
  const bersih = dasar.normalize("NFKC").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return bersih || "bukti";
}

/**
 * Validasi + simpan satu berkas. `berkas` = { buffer, originalname } (hasil multer memoryStorage).
 * Mengembalikan metadata untuk baris OrderPaymentClaimEvidence. Menulis ke disk HANYA setelah semua pemeriksaan lolos.
 */
export function simpanBerkas(berkas) {
  if (!berkas?.buffer?.length) throw new BerkasError("Berkas bukti wajib diisi", 400, "BERKAS_KOSONG");
  if (berkas.buffer.length > MAKS_UKURAN_BYTE) {
    throw new BerkasError(`Ukuran berkas maksimal ${MAKS_UKURAN_BYTE / 1024 / 1024} MB`, 413, "BERKAS_TERLALU_BESAR");
  }
  const tipe = deteksiTipe(berkas.buffer);
  if (!tipe) throw new BerkasError("Jenis berkas tidak diizinkan. Gunakan foto (JPG, PNG, WEBP) atau PDF.", 415, "TIPE_TIDAK_DIIZINKAN");
  const storedName = `${randomBytes(16).toString("hex")}.${tipe.ext}`;
  fs.mkdirSync(KLAIM_DIR, { recursive: true });
  fs.writeFileSync(path.join(KLAIM_DIR, storedName), berkas.buffer, { flag: "wx" });
  return {
    storedName,
    originalName: bersihkanNamaAsli(berkas.originalname),
    mimeType: tipe.mime,
    sizeBytes: berkas.buffer.length,
    sha256: createHash("sha256").update(berkas.buffer).digest("hex"),
  };
}

export const pathBerkas = (storedName) => path.join(KLAIM_DIR, storedName);

/** Server mengonfirmasi berkas benar-benar tersimpan (ada di disk dengan ukuran yang tercatat). */
export function berkasTersimpan(storedName, sizeBytes) {
  if (!POLA_NAMA.test(storedName)) return false;
  try { return fs.statSync(pathBerkas(storedName)).size === sizeBytes; } catch { return false; }
}

export function hapusBerkasDisk(storedName) {
  if (!POLA_NAMA.test(storedName)) return;
  try { fs.unlinkSync(pathBerkas(storedName)); } catch { /* sudah tidak ada — tidak apa-apa */ }
}

/** URL bertanda-tangan (berumur pendek) untuk satu berkas bukti — dikirim ke UI yang berhak melihatnya. */
export function urlBertandaTangan(storedName, { now = Date.now() } = {}) {
  const { exp, sig } = signFile(storedName, { ttlSeconds: KUNCI_TTL_DETIK, now, purpose: PURPOSE });
  return `${URL_PREFIX}/${storedName}?exp=${exp}&sig=${sig}`;
}

export const tandaTanganSah = (storedName, exp, sig, opsi = {}) => verifyFileSignature(storedName, exp, sig, { ...opsi, purpose: PURPOSE });

/**
 * Salin berkas klaim ke folder bukti Payment (nama deterministik dari id bukti → aman diulang) dan kembalikan URL-nya. Dipakai saat Finance
 * memverifikasi: bukti klaim menjadi bukti Payment resmi tanpa Finance mengunggah ulang, dan pembaca bukti Payment yang sudah ada tetap jalan.
 */
export function salinKeBuktiPayment(evidence, { dirTujuan }) {
  const nama = `klaim-${evidence.id}.${evidence.storedName.split(".").pop()}`;
  fs.mkdirSync(dirTujuan, { recursive: true });
  try {
    fs.copyFileSync(pathBerkas(evidence.storedName), path.join(dirTujuan, nama), fs.constants.COPYFILE_EXCL);
  } catch (e) {
    if (e.code !== "EEXIST") throw new BerkasError("Berkas bukti klaim tidak ditemukan di server — minta Sales mengunggah ulang", 409, "BERKAS_HILANG");
  }
  return `/media/payment-proofs/${nama}`;
}
