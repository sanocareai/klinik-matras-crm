// Foto bahan (Okt 2026): satu foto utama per bahan, diunggah dari Stok & Lokasi.
//
// PEMROSESAN (sharp): isi gambar divalidasi dari HEADER dulu (format, dimensi, jumlah piksel) SEBELUM ada piksel yang didekode; lalu putar sesuai EXIF, sisi terpanjang ≤ 1280px, simpan WebP,
// BUANG metadata (EXIF/GPS) dan buat thumbnail 192px. Content-Type kiriman klien tidak dipercaya — isi berkaslah yang menentukan.
// PENYIMPANAN: folder data/material-photos (volume persisten /app/data). Tiap unggahan memakai nama BARU (acak) dan tak pernah menimpa berkas: URL lama tak pernah berubah isinya.
// HAPUS: hanya berkas yang dikelola fitur ini — nama harus cocok pola, DAN diawali id bahan pemiliknya (nilai kolom yang rusak/dimanipulasi tidak bisa menghapus berkas bahan lain atau berkas lain di disk).
// AKSES: tidak ada penyajian statis direktori. Foto disajikan oleh routes/materialPhotoMedia.js (/api/inventory/foto-bahan/<nama>): Bearer (izin baca bahan) ATAU URL bertanda-tangan berumur pendek yang disisipkan hanya pada respons
// yang sudah berizin (daftar Stok & Lokasi, katalog bahan). Foto TIDAK menyentuh stok/ledger/harga/valuasi; hanya kolom photo_file + photo_updated_at pada materials.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { signFile } from "../lib/mediaSigning.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FOTO_BAHAN_DIR = process.env.FOTO_BAHAN_DIR || path.join(__dirname, "../../data/material-photos"); // env hanya dipakai tes/rehearsal (folder sementara)
// Disajikan oleh routes/materialPhotoMedia.js yang dipasang di inventoryRouter SEBELUM requireAuth (otentikasi sendiri: Bearer berizin atau URL bertanda-tangan). Dipasang di sini — bukan di index.js — agar index.js (dipatok tes kontrak) tidak berubah.
export const FOTO_BAHAN_URL_PREFIX = "/api/inventory/foto-bahan";
export const BATAS_BYTE = 10 * 1024 * 1024;
export const SISI_MAKS = 1280;
export const SISI_THUMB = 192;
// Batas sebelum pemrosesan: dihitung dari header, jadi gambar "bom dekompresi" (berkas kecil, dimensi raksasa) ditolak tanpa memakai memori.
export const BATAS_SISI_PIKSEL = 12000;
export const BATAS_TOTAL_PIKSEL = 64_000_000;
export const BATAS_HALAMAN = 1;
const FORMAT_DITERIMA = new Set(["jpeg", "png", "webp", "heif"]); // heif = AVIF/HEIF yang dapat didekode sharp; GIF/TIFF/SVG tidak diterima
export const SIGN_PURPOSE = "material-photo-v1";
export const SIGN_TTL_DETIK = 6 * 60 * 60;
const SIGN_BUCKET_MS = 60 * 60 * 1000; // exp dibulatkan per jam → URL sama sepanjang jam itu, cache peramban efektif; tetap berlaku ≥ 5 jam

export class FotoBahanError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Nama berkas foto utama valid: <uuid bahan>-<12 hex>.webp ; thumbnail: <uuid bahan>-<12 hex>-t.webp. */
export const NAMA_VALID = new RegExp(`^${UUID}-[0-9a-f]{12}\\.webp$`);
export const NAMA_THUMB_VALID = new RegExp(`^${UUID}-[0-9a-f]{12}-t\\.webp$`);
export const namaThumb = (nama) => nama.replace(/\.webp$/, "-t.webp");
/** Nama berkas yang disajikan (utama atau thumbnail) → true bila bentuknya sah. */
export const namaSajianValid = (nama) => typeof nama === "string" && (NAMA_VALID.test(nama) || NAMA_THUMB_VALID.test(nama));
/** Berkas ini milik bahan tersebut? (awalan id bahan) */
export const milikBahan = (nama, materialId) => typeof nama === "string" && typeof materialId === "string" && NAMA_VALID.test(nama) && nama.startsWith(`${materialId}-`);

function urlBertandaTangan(nama) {
  const { exp, sig } = signFile(nama, { ttlSeconds: SIGN_TTL_DETIK, now: Math.floor(Date.now() / SIGN_BUCKET_MS) * SIGN_BUCKET_MS, purpose: SIGN_PURPOSE });
  return `${FOTO_BAHAN_URL_PREFIX}/${nama}?exp=${exp}&sig=${sig}`;
}
export const urlFoto = (nama) => (nama && NAMA_VALID.test(nama) ? urlBertandaTangan(nama) : null);
export const urlThumb = (nama) => (nama && NAMA_VALID.test(nama) ? urlBertandaTangan(namaThumb(nama)) : null);

/** Tambah fotoUrl/fotoThumbUrl/fotoDiperbarui pada baris bahan (tanpa membuka nama berkas mentah). URL bertanda-tangan hanya untuk respons yang sudah lolos izin baca bahan. */
export function denganUrlFoto(m) {
  if (!m) return m;
  const { photoFile, photoUpdatedAt, ...sisa } = m;
  return { ...sisa, fotoUrl: urlFoto(photoFile), fotoThumbUrl: urlThumb(photoFile), fotoDiperbarui: photoFile && NAMA_VALID.test(photoFile) ? photoUpdatedAt ?? null : null };
}

function pastikanDir() { fs.mkdirSync(FOTO_BAHAN_DIR, { recursive: true }); }

/**
 * Proses gambar mentah → { nama, utama(Buffer), thumb(Buffer) } tanpa menulis apa pun.
 * `putar` (derajat kelipatan 90) dipakai untuk memutar foto yang sudah tersimpan.
 */
export async function olahFoto(buffer, materialId, { putar = 0 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new FotoBahanError("Pilih foto terlebih dahulu");
  if (buffer.length > BATAS_BYTE) throw new FotoBahanError(`Foto terlalu besar (maksimal ${BATAS_BYTE / 1024 / 1024} MB). Perkecil foto lalu coba lagi.`, 413);
  let meta;
  try { meta = await sharp(buffer, { failOn: "error", limitInputPixels: false }).metadata(); } catch { throw new FotoBahanError("Berkas bukan gambar yang bisa dibaca. Pilih foto JPG, PNG, atau WebP."); }
  if (!meta.format || !FORMAT_DITERIMA.has(meta.format)) throw new FotoBahanError("Format gambar tidak didukung. Pilih foto JPG, PNG, atau WebP.");
  if ((meta.pages ?? 1) > BATAS_HALAMAN) throw new FotoBahanError("Gambar beranimasi atau berhalaman banyak tidak didukung. Pilih foto biasa.");
  const w = meta.width ?? 0, h = meta.height ?? 0;
  if (w < 32 || h < 32) throw new FotoBahanError("Gambar terlalu kecil (minimal 32×32 piksel).");
  if (w > BATAS_SISI_PIKSEL || h > BATAS_SISI_PIKSEL || w * h > BATAS_TOTAL_PIKSEL) throw new FotoBahanError(`Dimensi gambar terlalu besar (maksimal ${BATAS_SISI_PIKSEL}×${BATAS_SISI_PIKSEL} piksel dan ${BATAS_TOTAL_PIKSEL / 1_000_000} megapiksel). Perkecil foto lalu coba lagi.`);
  // Unggahan baru: ikuti EXIF (.rotate() tanpa argumen). Putar manual dipakai pada foto TERSIMPAN (sudah tanpa EXIF), jadi cukup satu rotasi eksplisit.
  const dasar = sharp(buffer, { failOn: "error", limitInputPixels: BATAS_TOTAL_PIKSEL });
  const p = putar ? dasar.rotate(putar) : dasar.rotate();
  let utama, thumb;
  try {
    utama = await p.resize(SISI_MAKS, SISI_MAKS, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(); // metadata dibuang (default sharp)
    thumb = await sharp(utama).resize(SISI_THUMB, SISI_THUMB, { fit: "cover" }).webp({ quality: 75 }).toBuffer();
  } catch { throw new FotoBahanError("Gambar rusak atau tidak lengkap sehingga tidak bisa diproses. Pilih foto lain."); }
  const nama = `${materialId}-${crypto.randomBytes(6).toString("hex")}.webp`;
  return { nama, utama, thumb };
}

/** Tulis foto utama + thumbnail. Gagal di tengah → berkas yang sempat tertulis dibersihkan (tidak ada yatim), lalu galat diteruskan. Tidak pernah menimpa berkas lain (flag wx). */
export async function tulisFoto({ nama, utama, thumb }) {
  pastikanDir();
  const tulis = [];
  try {
    for (const [f, isi] of [[nama, utama], [namaThumb(nama), thumb]]) { await fs.promises.writeFile(path.join(FOTO_BAHAN_DIR, f), isi, { flag: "wx" }); tulis.push(f); }
  } catch (e) {
    for (const f of tulis) { try { await fs.promises.unlink(path.join(FOTO_BAHAN_DIR, f)); } catch { /* abaikan */ } }
    try { await fs.promises.unlink(path.join(FOTO_BAHAN_DIR, namaThumb(nama))); } catch { /* belum tertulis */ }
    throw e;
  }
}

/** Baca foto utama milik bahan itu (untuk diputar). Nama harus milik bahan tersebut. */
export async function bacaFoto(nama, materialId) {
  if (!milikBahan(nama, materialId)) throw new FotoBahanError("Data foto bahan ini tidak valid. Unggah ulang fotonya.", 409);
  try { return await fs.promises.readFile(path.join(FOTO_BAHAN_DIR, nama)); } catch { throw new FotoBahanError("Berkas foto tidak ditemukan di penyimpanan. Unggah ulang fotonya.", 404); }
}

/** Hapus berkas (utama + thumbnail) — HANYA bila nama sah dan milik bahan ini. Best-effort: kegagalan hanya dicatat; baris DB adalah sumber kebenaran. */
export async function hapusBerkasFoto(nama, materialId) {
  if (!milikBahan(nama, materialId)) { if (nama) console.error("Foto bahan: nama berkas tidak dikelola fitur ini, tidak dihapus:", String(nama).slice(0, 80)); return; }
  for (const f of [nama, namaThumb(nama)]) {
    try { await fs.promises.unlink(path.join(FOTO_BAHAN_DIR, f)); } catch (e) { if (e.code !== "ENOENT") console.error("Foto bahan: gagal menghapus berkas", f, e.message); }
  }
}
