// Foto bahan (Okt 2026): satu foto utama per bahan, diunggah dari Stok & Lokasi.
// Pemrosesan di server (sharp): putar sesuai EXIF, batasi sisi terpanjang 1280px, simpan WebP, dan BUANG metadata (EXIF/GPS) — foto dari HP tidak membawa lokasi ke penyimpanan.
// Tiap unggahan memakai nama berkas BARU (acak): URL lama tak pernah berubah isinya, sehingga cache browser aman dan tab yang terbuka tidak menampilkan foto campur.
// Foto TIDAK menyentuh stok/ledger/harga/valuasi; hanya kolom photo_file + photo_updated_at pada materials.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FOTO_BAHAN_DIR = process.env.FOTO_BAHAN_DIR || path.join(__dirname, "../../data/material-photos"); // env hanya dipakai tes (folder sementara)
export const FOTO_BAHAN_URL_PREFIX = "/media/material-photos";
export const BATAS_BYTE = 10 * 1024 * 1024;
export const SISI_MAKS = 1280;
export const SISI_THUMB = 192;
const FORMAT_DITERIMA = new Set(["jpeg", "png", "webp", "heif", "gif", "tiff", "avif"]);

export class FotoBahanError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

/** Nama berkas foto utama valid: <uuid>-<12 hex>.webp (dipakai juga untuk mencegah path traversal saat menghapus). */
export const NAMA_VALID = /^[0-9a-f-]{36}-[0-9a-f]{12}\.webp$/;
export const namaThumb = (nama) => nama.replace(/\.webp$/, "-t.webp");
export const urlFoto = (nama) => (nama ? `${FOTO_BAHAN_URL_PREFIX}/${nama}` : null);
export const urlThumb = (nama) => (nama ? `${FOTO_BAHAN_URL_PREFIX}/${namaThumb(nama)}` : null);

/** Tambah fotoUrl/fotoThumbUrl/fotoDiperbarui pada baris bahan (tanpa membuka nama berkas mentah). */
export function denganUrlFoto(m) {
  if (!m) return m;
  const { photoFile, photoUpdatedAt, ...sisa } = m;
  return { ...sisa, fotoUrl: urlFoto(photoFile), fotoThumbUrl: urlThumb(photoFile), fotoDiperbarui: photoFile ? photoUpdatedAt ?? null : null };
}

function pastikanDir() { fs.mkdirSync(FOTO_BAHAN_DIR, { recursive: true }); }

/**
 * Proses gambar mentah → { nama, utama(Buffer), thumb(Buffer) } tanpa menulis apa pun.
 * `putar` (derajat kelipatan 90) dipakai untuk memutar foto yang sudah tersimpan.
 */
export async function olahFoto(buffer, materialId, { putar = 0 } = {}) {
  let meta;
  try { meta = await sharp(buffer, { failOn: "error" }).metadata(); } catch { throw new FotoBahanError("Berkas bukan gambar yang bisa dibaca. Pilih foto JPG, PNG, atau WebP."); }
  if (!meta.format || !FORMAT_DITERIMA.has(meta.format)) throw new FotoBahanError("Format gambar tidak didukung. Pilih foto JPG, PNG, atau WebP.");
  if ((meta.pages ?? 1) > 1 && meta.format === "gif") throw new FotoBahanError("GIF beranimasi tidak didukung. Pilih foto biasa.");
  if ((meta.width ?? 0) < 32 || (meta.height ?? 0) < 32) throw new FotoBahanError("Gambar terlalu kecil (minimal 32×32 piksel).");
  if ((meta.width ?? 0) * (meta.height ?? 0) > 100_000_000) throw new FotoBahanError("Dimensi gambar terlalu besar. Perkecil foto lalu coba lagi.");
  // Unggahan baru: ikuti EXIF (.rotate() tanpa argumen). Putar manual dipakai pada foto TERSIMPAN (sudah tanpa EXIF), jadi cukup satu rotasi eksplisit.
  const dasar = sharp(buffer, { failOn: "error", limitInputPixels: 100_000_000 });
  const p = putar ? dasar.rotate(putar) : dasar.rotate();
  const utama = await p.resize(SISI_MAKS, SISI_MAKS, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(); // metadata dibuang (default sharp)
  const thumb = await sharp(utama).resize(SISI_THUMB, SISI_THUMB, { fit: "cover" }).webp({ quality: 75 }).toBuffer();
  const nama = `${materialId}-${crypto.randomBytes(6).toString("hex")}.webp`;
  return { nama, utama, thumb };
}

export async function tulisFoto({ nama, utama, thumb }) {
  pastikanDir();
  await fs.promises.writeFile(path.join(FOTO_BAHAN_DIR, nama), utama, { flag: "wx" });
  await fs.promises.writeFile(path.join(FOTO_BAHAN_DIR, namaThumb(nama)), thumb, { flag: "wx" });
}

export async function bacaFoto(nama) {
  if (!NAMA_VALID.test(nama ?? "")) throw new FotoBahanError("Nama berkas foto tidak valid", 500);
  try { return await fs.promises.readFile(path.join(FOTO_BAHAN_DIR, nama)); } catch { throw new FotoBahanError("Berkas foto tidak ditemukan di penyimpanan", 404); }
}

/** Hapus berkas (utama + thumbnail). Best-effort: kegagalan hanya dicatat; baris DB adalah sumber kebenaran. */
export async function hapusBerkasFoto(nama) {
  if (!NAMA_VALID.test(nama ?? "")) return;
  for (const f of [nama, namaThumb(nama)]) {
    try { await fs.promises.unlink(path.join(FOTO_BAHAN_DIR, f)); } catch (e) { if (e.code !== "ENOENT") console.error("Foto bahan: gagal menghapus berkas", f, e.message); }
  }
}
