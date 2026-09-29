// Foto identitas unit (P9B.1) — kartu Status Produksi/Rencana Produksi. TIDAK publik-by-URL, sama pola dengan
// productionEvidenceMedia.js (P8):
//
// Baca: GET /media/unit-photo/<unitId> dengan Bearer (UNIT_READ + reader cohort unit ini) ATAU URL bertanda-
//   tangan (exp/sig, kunci turunan "production-unit-photo-v1", subjek = unitId — BUKAN nama berkas, supaya
//   URL tidak pernah mengekspos nama berkas Delivery/Production di disk). Sumber (pickup driver vs manual)
//   diresolusi ULANG di setiap request lewat resolveUnitPhoto() — TIDAK PERNAH menerima path/berkas dari klien.
// Unggah manual: POST /api/production-v2/units/:unitId/photo (multipart, field "photo", satu berkas).
//   Hanya PRODUCTION_ASSIGNMENT_WRITE (PRODUCTION_LEAD/ADMIN — BUKAN PRODUCTION_WORKER) dan hanya writer V2
//   aktif untuk unit ini; ditolak bila unit sudah punya foto pickup driver (lihat canUploadManualPhoto).
//   Validasi: JPEG/PNG/WebP, magic-byte (bukan sekadar Content-Type klien), <= 8 MB, satu berkas per unggahan.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { prisma } from "../db.js";
import { authenticateBearer } from "../middleware/auth.js";
import { hasPermission } from "../middleware/authorize.js";
import { requirePermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { signFile, verifyFileSignature } from "../lib/mediaSigning.js";
import { UNIT_PHOTO_DIR, UNIT_PHOTO_TMP_DIR, UNIT_PHOTO_FILE_PATTERN, ensureUnitPhotoDirs } from "../lib/productionUnitPhotoStore.js";
import { resolveUnitPhoto, resolveUnitPhotosBulk, uploadManualUnitPhoto } from "../services/productionUnitPhotoService.js";
import { isProductionReaderEnabledFor, isProductionWriterEnabledFor, loadV2Flags, resolveProductionReaderState, resolveProductionWriterState } from "../services/v2FeatureFlags.js";

ensureUnitPhotoDirs();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOB_PHOTOS_DIR = path.join(__dirname, "../../data/job-photos"); // BACA SAJA — milik Delivery, tidak pernah ditulis dari sini.
const JOB_PHOTO_EXT_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", gif: "image/gif" };

export const UNIT_PHOTO_SIGN_PURPOSE = "production-unit-photo-v1";
export const UNIT_PHOTO_SIGN_TTL_SECONDS = 60 * 60;

export function signUnitPhotoUrl(unitId, { now = Date.now() } = {}) {
  const { exp, sig } = signFile(unitId, { ttlSeconds: UNIT_PHOTO_SIGN_TTL_SECONDS, now, purpose: UNIT_PHOTO_SIGN_PURPOSE });
  return `/media/unit-photo/${unitId}?exp=${exp}&sig=${sig}`;
}

// Dipanggil dari read-model (kartu Status Produksi/Rencana Produksi) — null kalau tidak ada foto sama sekali,
// supaya frontend tidak perlu menebak dari 404.
export async function signUnitPhotoUrlIfAny(prisma_, unitId) {
  const resolved = await resolveUnitPhoto(prisma_, unitId);
  return resolved ? signUnitPhotoUrl(unitId) : null;
}

// Versi batch (2 query, bukan 2×N) — dipakai read-model kartu yang menampilkan banyak unit sekaligus.
export async function signUnitPhotoUrlsBulk(prisma_, unitIds) {
  const resolved = await resolveUnitPhotosBulk(prisma_, unitIds);
  const out = new Map();
  for (const [unitId, value] of resolved) out.set(unitId, value ? signUnitPhotoUrl(unitId) : null);
  return out;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UNIT_PHOTO_TMP_DIR),
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.part`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});

function cleanupIncoming(req) {
  if (req.file?.path && fs.existsSync(req.file.path)) { try { fs.unlinkSync(req.file.path); } catch { /* abaikan */ } }
}

export const productionUnitPhotoUploadRouter = express.Router();

productionUnitPhotoUploadRouter.post("/units/:unitId/photo", requirePermission(P.PRODUCTION_ASSIGNMENT_WRITE), (req, res, next) => {
  upload.single("photo")(req, res, (err) => {
    if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Foto terlalu besar (maksimal 8 MB)", code: "UNIT_PHOTO_TOO_LARGE" });
    if (err) return next(err);
    return next();
  });
}, async (req, res) => {
  try {
    const unitId = String(req.params.unitId || "");
    const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } });
    if (!unit) { cleanupIncoming(req); return res.status(404).json({ error: "Unit tidak ditemukan", code: "UNIT_PHOTO_UNIT_NOT_FOUND" }); }
    const writer = resolveProductionWriterState(await loadV2Flags(prisma));
    if (!isProductionWriterEnabledFor(writer, unitId)) { cleanupIncoming(req); return res.status(503).json({ error: "Produksi V2 tidak aktif untuk unit ini", code: "UNIT_PHOTO_WRITER_OFF" }); }
    if (!req.file) return res.status(400).json({ error: "Pilih satu foto (JPG/PNG/WEBP)", code: "UNIT_PHOTO_EMPTY" });
    const row = await uploadManualUnitPhoto(prisma, { unitId, actorId: req.user.id, tmpFilePath: req.file.path, declaredMimeType: req.file.mimetype });
    res.status(201).json({ id: row.id, photoUrl: signUnitPhotoUrl(unitId) });
  } catch (err) {
    cleanupIncoming(req);
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message, code: err.code });
    console.error("[productionUnitPhoto] upload:", err);
    res.status(500).json({ error: "Terjadi kesalahan di server saat menyimpan foto" });
  }
});

async function bolehLihat(user, unitId) {
  if (!user || !hasPermission(user, P.UNIT_READ)) return false;
  const reader = resolveProductionReaderState(await loadV2Flags(prisma));
  return isProductionReaderEnabledFor(reader, unitId);
}

async function kirim(req, res) {
  const unitId = String(req.params.unitId || "");
  if (!/^[0-9a-f-]{36}$/i.test(unitId)) return res.status(404).json({ error: "Foto tidak ditemukan" });
  if (req.query.sig) {
    if (!verifyFileSignature(unitId, req.query.exp, req.query.sig, { purpose: UNIT_PHOTO_SIGN_PURPOSE })) {
      return res.status(403).json({ error: "Tautan foto tidak valid atau sudah kedaluwarsa" });
    }
  } else {
    const user = await authenticateBearer(req);
    if (!user) return res.status(401).json({ error: "Belum login" });
    if (!(await bolehLihat(user, unitId))) return res.status(403).json({ error: "Anda tidak punya akses untuk melihat foto ini" });
  }
  const resolved = await resolveUnitPhoto(prisma, unitId);
  if (!resolved) return res.status(404).json({ error: "Unit ini belum punya foto" });

  let abs, mime;
  if (resolved.source === "DRIVER_PICKUP") {
    // jobPhotoFilename sudah divalidasi (tanpa "/" atau "..") di resolveUnitPhoto() — cek startsWith di
    // bawah tetap dipertahankan sebagai lapis kedua, bukan satu-satunya pertahanan.
    abs = path.join(JOB_PHOTOS_DIR, resolved.jobPhotoFilename);
    mime = resolved.mimeType || JOB_PHOTO_EXT_MIME[resolved.jobPhotoFilename.split(".").pop()?.toLowerCase()] || "image/jpeg";
    if (!abs.startsWith(path.resolve(JOB_PHOTOS_DIR))) return res.status(404).json({ error: "Foto tidak ditemukan" });
  } else {
    if (!UNIT_PHOTO_FILE_PATTERN.test(resolved.storageKey)) return res.status(404).json({ error: "Foto tidak ditemukan" });
    abs = path.join(UNIT_PHOTO_DIR, resolved.storageKey);
    mime = resolved.mimeType;
    if (!abs.startsWith(path.resolve(UNIT_PHOTO_DIR))) return res.status(404).json({ error: "Foto tidak ditemukan" });
  }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "Foto tidak ditemukan" });
  const stat = fs.statSync(abs);
  res.setHeader("Content-Type", mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(abs).on("error", () => res.destroy()).pipe(res);
}

export const productionUnitPhotoPathRouter = express.Router();
productionUnitPhotoPathRouter.get("/:unitId", (req, res) => {
  kirim(req, res).catch((err) => {
    console.error("[productionUnitPhoto] kirim:", err);
    if (!res.headersSent) res.status(500).json({ error: "Terjadi kesalahan di server" });
  });
});
