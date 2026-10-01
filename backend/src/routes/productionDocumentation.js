// Aplikasi Dokumentasi produksi V2 (P10B) — /api/production-v2/documentation/*. requireAuth sudah dipasang di productionExperienceRouter.
// Baca: UNIT_READ + production_v2_reader (cohort unitIds; OFF -> respons kosong readerMode OFF; non-cohort -> 404).
// Tulis: PRODUCTION_DOCUMENTATION_WRITE + production_v2_writer (cohort, fail-closed) (peran PRODUCTION_LEAD / PRODUCTION_DOCUMENTER) — tanpa pembatasan PIC; cohort mencegah IDOR lintas unit.
// Media: berkas disimpan di store bukti V2 yang SAMA (nama = sha1 isi, URL bertanda-tangan yang sama). Validasi: MIME deklarasi, MAGIC BYTE
// (bukan sekadar Content-Type), ukuran, nama berkas klien (ditolak bila mengandung pemisah path/..; tidak pernah dipakai sebagai nama simpan).
// Tidak ada harga/pembayaran/jurnal/Finance di payload mana pun.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { prisma } from "../db.js";
import { hasPermission, requirePermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { EVIDENCE_DIR, EVIDENCE_TMP_DIR, ensureEvidenceDirs } from "../lib/productionEvidenceStore.js";
import { EVIDENCE_URL_PREFIX } from "../lib/domain/productionSteps.js";
import { signEvidenceUrl } from "./productionEvidenceMedia.js";
import { sniffImageType } from "../services/productionUnitPhotoService.js";
import { assertCanUploadDocumentation, getDocumentationDetail, getDocumentationQueue, recordDocumentation } from "../services/productionDocumentationService.js";
import { DOC_CATEGORIES, DOC_GROUPS, DOC_QUEUE_FILTERS, DOC_SOURCES, docError } from "../lib/domain/productionDocumentation.js";
import { PRODUCTION_READER_MODE, loadV2Flags, resolveProductionReaderState, resolveProductionWriterState, isProductionWriterEnabledFor } from "../services/v2FeatureFlags.js";

ensureEvidenceDirs();
export const DOC_IMAGE_MAX = 15 * 1024 * 1024;
const MAX_FILES = 6;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, EVIDENCE_TMP_DIR), filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.part`) }),
  limits: { fileSize: DOC_IMAGE_MAX, files: MAX_FILES },
  preservePath: true, // jangan biarkan busboy diam-diam memangkas path: nama berkas ber-path/.. DITOLAK (SAFE_NAME), bukan dinormalkan
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
});

export const productionDocumentationRouter = express.Router();

function handleErr(err, res) {
  if (Number.isInteger(err?.statusCode)) return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.details ? { details: err.details } : {}) });
  if (err?.code === "P2002") return res.status(409).json({ error: "Data yang sama sedang diproses — muat ulang lalu coba lagi", code: "PRODUCTION_V2_DUPLICATE" });
  if (err?.code === "P2028" || err?.code === "P2034") return res.status(409).json({ error: "Server sedang sibuk memproses perintah lain untuk unit ini — coba lagi", code: "PRODUCTION_V2_BUSY" });
  console.error("Production documentation error:", err);
  return res.status(500).json({ error: "Terjadi kesalahan di server" });
}
async function readerCohort() {
  const state = resolveProductionReaderState(await loadV2Flags(prisma));
  if (state.mode === PRODUCTION_READER_MODE.OFF) return null;
  const ids = [...state.unitIds];
  return ids.length ? ids : null;
}
const idem = (req) => req.get("Idempotency-Key") || req.body?.idempotencyKey;
const actorOf = (user) => ({
  id: user.id, hasQcWrite: hasPermission(user, P.QC_WRITE), hasInventoryWrite: hasPermission(user, P.INVENTORY_WRITE),
});
function cleanupIncoming(req) { for (const f of req.files || []) { try { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { /* abaikan */ } } }
const SAFE_NAME = (name) => typeof name === "string" && name.length > 0 && name.length <= 255 && !/[\\/\u0000-\u001f]/.test(name) && !name.includes("..");

// ---- Bacaan -----------------------------------------------------------------------------------------------------------------
// Kontrak matriks (statis) — dipakai klien untuk label/filter tanpa menggandakan definisi.
productionDocumentationRouter.get("/matrix", requirePermission(P.UNIT_READ), (_req, res) => {
  res.json({
    categories: DOC_CATEGORIES.map((c) => ({ key: c.key, label: c.label, group: c.group, groupLabel: DOC_GROUPS[c.group], min: c.min })),
    groups: DOC_GROUPS, sources: DOC_SOURCES, filters: DOC_QUEUE_FILTERS,
  });
});

productionDocumentationRouter.get("/queue", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const unitIds = await readerCohort();
    const canWrite = hasPermission(req.user, P.PRODUCTION_DOCUMENTATION_WRITE);
    if (!unitIds) return res.json({ readerMode: "OFF", canWrite, filter: "ALL", counts: {}, items: [] });
    res.json({ readerMode: "COHORT", canWrite, ...(await getDocumentationQueue(prisma, { unitIds, filter: String(req.query.filter || "ALL"), q: String(req.query.q || ""), limit: req.query.limit })) });
  } catch (err) { handleErr(err, res); }
});

productionDocumentationRouter.get("/runs/:runId", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const unitIds = await readerCohort();
    if (!unitIds) return res.status(404).json({ error: "Dokumentasi tidak tersedia", code: "PRODUCTION_V2_READER_OFF" });
    const detail = await getDocumentationDetail(prisma, req.params.runId, { unitIds });
    if (!detail) return res.status(404).json({ error: "Unit tidak ditemukan atau di luar cohort", code: "RUN_NOT_FOUND" });
    const writerOn = isProductionWriterEnabledFor(resolveProductionWriterState(await loadV2Flags(prisma)), detail.unit.id);
    res.json({ readerMode: "COHORT", ...detail, canWrite: hasPermission(req.user, P.PRODUCTION_DOCUMENTATION_WRITE) && writerOn && detail.status !== "CANCELLED" });
  } catch (err) { handleErr(err, res); }
});

// ---- Tulis ------------------------------------------------------------------------------------------------------------------
// POST /documentation/upload (multipart: runId, files[]) -> { items: [{ url, kind, size, previewUrl }] }. Idempoten by isi (nama = sha1).
productionDocumentationRouter.post("/upload", requirePermission(P.PRODUCTION_DOCUMENTATION_WRITE), (req, res, next) => {
  upload.array("files", MAX_FILES)(req, res, (err) => {
    if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Foto terlalu besar (maksimal 15 MB)", code: "DOC_TOO_LARGE" });
    if (err?.code === "LIMIT_FILE_COUNT") return res.status(400).json({ error: `Maksimal ${MAX_FILES} foto per unggahan`, code: "DOC_TOO_MANY" });
    if (err) return next(err);
    return next();
  });
}, async (req, res) => {
  try {
    const files = req.files || [];
    await assertCanUploadDocumentation(prisma, { runId: req.body?.runId, });
    if (files.length === 0) throw docError("Pilih foto (JPG/PNG/WEBP) — berkas lain ditolak", 400, "DOC_EMPTY");
    for (const f of files) if (!SAFE_NAME(f.originalname)) throw docError("Nama berkas tidak valid", 400, "DOC_FILENAME_INVALID");
    const items = [];
    for (const f of files) {
      const buf = fs.readFileSync(f.path);
      const sniffed = sniffImageType(buf);
      if (!sniffed) throw docError("Berkas bukan JPEG/PNG/WebP yang valid", 415, "DOC_INVALID_TYPE");
      if (sniffed.mimeType !== f.mimetype) throw docError("Tipe berkas tidak sesuai isinya", 415, "DOC_TYPE_MISMATCH");
      const name = `${crypto.createHash("sha1").update(buf).digest("hex")}.${sniffed.ext}`;
      const abs = path.join(EVIDENCE_DIR, name);
      if (!abs.startsWith(path.resolve(EVIDENCE_DIR))) throw docError("Nama berkas tidak valid", 400, "DOC_FILENAME_INVALID");
      if (fs.existsSync(abs)) fs.unlinkSync(f.path); else fs.renameSync(f.path, abs);
      const url = `${EVIDENCE_URL_PREFIX}${name}`;
      items.push({ url, kind: "image", size: buf.length, previewUrl: signEvidenceUrl(url) });
    }
    res.status(201).json({ items });
  } catch (err) { handleErr(err, res); } finally { cleanupIncoming(req); }
});

// POST /documentation/runs/:runId/submit { category, items:[{url,caption,order}], note? } — Idempotency-Key.
productionDocumentationRouter.post("/runs/:runId/submit", requirePermission(P.PRODUCTION_DOCUMENTATION_WRITE), async (req, res) => {
  try {
    res.status(201).json(await recordDocumentation(prisma, {
      runId: req.params.runId, actor: actorOf(req.user), idempotencyKey: idem(req), category: req.body?.category, items: req.body?.items, note: req.body?.note,
    }));
  } catch (err) { handleErr(err, res); }
});

// POST /documentation/runs/:runId/correct { category, supersedesEvidenceId, reason, items } — versi baru; yang lama tetap ada.
productionDocumentationRouter.post("/runs/:runId/correct", requirePermission(P.PRODUCTION_DOCUMENTATION_WRITE), async (req, res) => {
  try {
    if (!req.body?.supersedesEvidenceId) throw docError("Pilih dokumentasi yang dikoreksi", 400, "DOC_CORRECTION_TARGET_REQUIRED");
    res.status(201).json(await recordDocumentation(prisma, {
      runId: req.params.runId, actor: actorOf(req.user), idempotencyKey: idem(req), category: req.body?.category, items: req.body?.items,
      note: req.body?.note, supersedesEvidenceId: req.body.supersedesEvidenceId, reason: req.body?.reason,
    }));
  } catch (err) { handleErr(err, res); }
});
