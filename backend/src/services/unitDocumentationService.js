// DOKUMENTASI TAMBAHAN UNIT (14 Nov 2026, permintaan Owner) — foto dokumentasi untuk unit yang TIDAK bisa memakai Dokumentasi
// Produksi V2 (/production-v2/documentation/*): unit tanpa pekerjaan V2 (mis. order lama yang sudah terkirim) atau unit yang V2-nya
// belum dinyalakan. Satu unit selalu punya SATU tujuan unggah — jalur ini tidak pernah aktif bila Dokumentasi V2 bisa menerima foto,
// jadi foto tidak terpecah di dua tempat.
// Informasi saja: TIDAK mengubah status produksi/QC/stok/Finance. Append-only (tidak ada hapus/ubah lewat aplikasi).
// Berkas: data/unit-photos (sha1 isi + ekstensi dari ISI berkas), dilayani di /media/unit-photos/ — sama dengan foto tahap produksi
// lama, sehingga otomatis ikut berkas dokumentasi order (GET /production/orders/:orderId/documentation) dan alur kirim ke pelanggan.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DOC_CATEGORIES, DOC_CATEGORY_BY_KEY, DOC_GROUPS } from "../lib/domain/productionDocumentation.js";
import { sniffImageType } from "./productionUnitPhotoService.js";
import { isProductionReaderEnabledFor, isProductionWriterEnabledFor, loadV2Flags, PRODUCTION_READER_MODE, resolveProductionReaderState, resolveProductionWriterState } from "./v2FeatureFlags.js";

export const UNIT_PHOTOS_DIR = process.env.UNIT_PHOTOS_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data/unit-photos");
export const UNIT_PHOTOS_URL_PREFIX = "/media/unit-photos/";
export const DOK_TAMBAHAN_MAKS_FOTO = 6;
export const DOK_TAMBAHAN_MAKS_BYTES = 15 * 1024 * 1024;

export function dokError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

export const PESAN_DOK_TAMBAHAN = Object.freeze({
  V2: "Unit ini memakai Dokumentasi Produksi (per kategori) — tambahkan foto di sana.",
  DIBATALKAN: "Order/unit ini dibatalkan; dokumentasi tidak bisa ditambah.",
  HANYA_LIHAT: "Akun Anda hanya bisa melihat dokumentasi.",
});

/**
 * MURNI: apakah unit ini memakai jalur Dokumentasi Tambahan, dan bolehkah akun ini mengunggah.
 *   v2BisaUnggah = unit punya pekerjaan V2 yang tidak dibatalkan DAN pembaca + penulis V2 menyala untuk unit itu.
 * Jalur tambahan aktif HANYA bila V2 tidak bisa menerima unggahan karena alasan struktural (tanpa pekerjaan V2 / V2 belum menyala) —
 * bukan karena dibatalkan dan bukan karena izin akun.
 */
export function putusanDokumentasiTambahan({ unitStatus, run, bacaOn, tulisOn, izinTulis }) {
  if (unitStatus === "CANCELLED" || run?.status === "CANCELLED") return { aktif: false, bolehUnggah: false, alasan: PESAN_DOK_TAMBAHAN.DIBATALKAN };
  const v2BisaUnggah = !!run && !!bacaOn && !!tulisOn;
  if (v2BisaUnggah) return { aktif: false, bolehUnggah: false, alasan: PESAN_DOK_TAMBAHAN.V2 };
  if (!izinTulis) return { aktif: true, bolehUnggah: false, alasan: PESAN_DOK_TAMBAHAN.HANYA_LIHAT };
  return { aktif: true, bolehUnggah: true, alasan: null };
}

/** Status jalur untuk satu unit (membaca unit, pekerjaan V2 terbaru, dan flag V2). null bila unit tidak ada. */
export async function statusDokumentasiTambahan(prisma, unitId, { izinTulis }) {
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, status: true } });
  if (!unit) return null;
  // Pekerjaan V2 yang dipakai SAMA dengan GET /units/:id/ruang-kerja: yang masih berjalan, selain itu yang terbaru.
  const run = await prisma.productionRun.findFirst({ where: { unitId, status: { notIn: ["COMPLETED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } })
    ?? await prisma.productionRun.findFirst({ where: { unitId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
  const flags = await loadV2Flags(prisma);
  const pembaca = resolveProductionReaderState(flags);
  const bacaOn = pembaca.mode !== PRODUCTION_READER_MODE.OFF && isProductionReaderEnabledFor(pembaca, unitId);
  const tulisOn = isProductionWriterEnabledFor(resolveProductionWriterState(flags), unitId);
  return putusanDokumentasiTambahan({ unitStatus: unit.status, run, bacaOn, tulisOn, izinTulis });
}

/** MURNI: baris tersimpan → SEMUA kategori DOC_CATEGORIES (urutan & label sama), foto terlama lebih dulu. */
export function susunKategori(rows, namaPengunggah = new Map()) {
  return DOC_CATEGORIES.map((c) => {
    const foto = rows.filter((r) => r.category === c.key).map((r) => ({
      id: r.id, url: `${UNIT_PHOTOS_URL_PREFIX}${r.storageKey}`, kind: "image", createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      oleh: namaPengunggah.get(r.uploadedById) ?? null,
    }));
    return { key: c.key, label: c.label, group: c.group, groupLabel: DOC_GROUPS[c.group], count: foto.length, items: foto };
  });
}

export async function daftarDokumentasiTambahan(prisma, unitId) {
  const rows = await prisma.unitDocumentationPhoto.findMany({ where: { unitId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const ids = [...new Set(rows.map((r) => r.uploadedById))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return { categories: susunKategori(rows, new Map(users.map((u) => [u.id, u.name]))), total: rows.length };
}

/**
 * Catat foto (sudah diunggah ke berkas sementara oleh multer) ke satu kategori. Isi berkas diperiksa (magic byte), disimpan dengan
 * nama sha1 isinya; berkas identik di kategori yang sama dilewati (aman diulang). Mengembalikan jumlah foto baru.
 */
export async function catatDokumentasiTambahan(prisma, { unitId, category, files, actorId, izinTulis }) {
  if (!DOC_CATEGORY_BY_KEY[category]) throw dokError("Kategori dokumentasi tidak dikenal", 400, "DOK_KATEGORI_TIDAK_DIKENAL");
  if (!files?.length) throw dokError("Pilih foto (JPG/PNG/WEBP)", 400, "DOK_KOSONG");
  if (files.length > DOK_TAMBAHAN_MAKS_FOTO) throw dokError(`Maksimal ${DOK_TAMBAHAN_MAKS_FOTO} foto sekali unggah`, 400, "DOK_TERLALU_BANYAK");
  const st = await statusDokumentasiTambahan(prisma, unitId, { izinTulis });
  if (!st) throw dokError("Unit tidak ditemukan", 404, "UNIT_TIDAK_ADA");
  if (!st.aktif || !st.bolehUnggah) throw dokError(st.alasan ?? "Dokumentasi tidak bisa ditambah untuk unit ini", st.aktif ? 403 : 409, st.aktif ? "DOK_HANYA_LIHAT" : "DOK_PAKAI_JALUR_LAIN");

  const siap = [];
  for (const f of files) {
    const buf = fs.readFileSync(f.path);
    const jenis = sniffImageType(buf);
    if (!jenis) throw dokError("Berkas bukan foto JPG/PNG/WEBP yang valid", 415, "DOK_BUKAN_FOTO");
    if (buf.length > DOK_TAMBAHAN_MAKS_BYTES) throw dokError("Foto terlalu besar (maksimal 15 MB)", 413, "DOK_TERLALU_BESAR");
    siap.push({ buf, jenis, storageKey: `${crypto.createHash("sha1").update(buf).digest("hex")}.${jenis.ext}` });
  }
  fs.mkdirSync(UNIT_PHOTOS_DIR, { recursive: true });
  for (const s of siap) {
    const abs = path.join(UNIT_PHOTOS_DIR, s.storageKey);
    if (!abs.startsWith(path.resolve(UNIT_PHOTOS_DIR))) throw dokError("Nama berkas tidak valid", 400, "DOK_NAMA_TIDAK_VALID");
    if (!fs.existsSync(abs)) fs.writeFileSync(abs, s.buf);
  }
  const r = await prisma.unitDocumentationPhoto.createMany({
    data: siap.map((s) => ({ unitId, category, storageKey: s.storageKey, mimeType: s.jenis.mimeType, sizeBytes: s.buf.length, uploadedById: actorId })),
    skipDuplicates: true,
  });
  return { ditambah: r.count, dilewati: siap.length - r.count };
}

/** Entri untuk berkas dokumentasi order (bentuk sama dengan entri tahap produksi): satu entri per unit per kategori. */
export async function entriBerkasOrder(prisma, orderId) {
  const rows = await prisma.unitDocumentationPhoto.findMany({
    where: { unit: { orderId } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { unitId: true, category: true, storageKey: true, createdAt: true, unit: { select: { unitCode: true } } },
  });
  const grup = new Map();
  for (const r of rows) {
    const k = `${r.unitId}|${r.category}`;
    if (!grup.has(k)) grup.set(k, { kategori: "PRODUKSI", unitCode: r.unit.unitCode, stageLabel: `${DOC_CATEGORY_BY_KEY[r.category]?.label ?? r.category} (dokumentasi tambahan)`, photoUrls: [], note: null, recordedAt: r.createdAt });
    const e = grup.get(k);
    e.photoUrls.push(`${UNIT_PHOTOS_URL_PREFIX}${r.storageKey}`);
    if (r.createdAt > e.recordedAt) e.recordedAt = r.createdAt;
  }
  return [...grup.values()];
}
