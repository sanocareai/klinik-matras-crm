// Simplifikasi Production slice 3 — Catatan Komponen kanonis per unit: /api/production-v2/component-notes/*. requireAuth sudah dipasang di productionExperienceRouter.
// Baca: UNIT_READ/INVENTORY_READ + production_v2_reader (cohort; OFF -> readerMode OFF, non-cohort -> 404). Tanpa harga/stok/jurnal di payload mana pun.
// Tulis (data + foto): UNIT_STAGE_WRITE (Meja/Corner/Lead/QC/Admin) ATAU PRODUCTION_DOCUMENTATION_WRITE (Dokumentasi) + production_v2_writer (cohort, fail-closed).
// Sales/Gudang/Driver hanya membaca. Catatan = informasi: tidak memotong stok dan tidak menjadi BOM/pemakaian/retur.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { prisma } from "../db.js";
import { hasPermission, requireAnyPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { EVIDENCE_DIR, EVIDENCE_TMP_DIR, ensureEvidenceDirs } from "../lib/productionEvidenceStore.js";
import { EVIDENCE_URL_PREFIX } from "../lib/domain/productionSteps.js";
import { signEvidenceUrl } from "./productionEvidenceMedia.js";
import { sniffImageType } from "../services/productionUnitPhotoService.js";
import { PRODUCTION_READER_MODE, isProductionWriterEnabledFor, loadV2Flags, resolveProductionReaderState, resolveProductionWriterState } from "../services/v2FeatureFlags.js";
import { assertCanUploadComponentMedia, getComponentNotes, recordComponentSection, searchComponentMaterials } from "../services/productionComponentNoteService.js";
import { componentError } from "../lib/domain/productionComponents.js";

ensureEvidenceDirs();
const IMAGE_MAX = 15 * 1024 * 1024;
const MAX_FILES = 6;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const upload = multer({
  storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, EVIDENCE_TMP_DIR), filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.part`) }),
  limits: { fileSize: IMAGE_MAX, files: MAX_FILES }, preservePath: true, fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
});

export const productionComponentNotesRouter = express.Router();
const READ_PERMS = [P.UNIT_READ, P.INVENTORY_READ];
const WRITE_PERMS = [P.UNIT_STAGE_WRITE, P.PRODUCTION_DOCUMENTATION_WRITE];
const canWriteRole = (user) => WRITE_PERMS.some((p) => hasPermission(user, p));
const idem = (req) => req.get("Idempotency-Key") || req.body?.idempotencyKey;

function handleErr(err, res) {
  if (Number.isInteger(err?.statusCode)) return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.details ? { details: err.details } : {}) });
  if (err?.code === "P2002") return res.status(409).json({ error: "Data yang sama sedang diproses — muat ulang lalu coba lagi", code: "COMPONENT_VERSION_CONFLICT" });
  if (err?.code === "P2028" || err?.code === "P2034") return res.status(409).json({ error: "Server sedang sibuk memproses perintah lain untuk unit ini — coba lagi", code: "PRODUCTION_V2_BUSY" });
  console.error("Production component notes error:", err);
  return res.status(500).json({ error: "Terjadi kesalahan di server" });
}
async function readerCohort() {
  const state = resolveProductionReaderState(await loadV2Flags(prisma));
  if (state.mode === PRODUCTION_READER_MODE.OFF) return null;
  const ids = [...state.unitIds];
  return ids.length ? ids : null;
}
function cleanupIncoming(req) { for (const f of req.files || []) { try { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { /* abaikan */ } } }
const SAFE_NAME = (name) => typeof name === "string" && name.length > 0 && name.length <= 255 && !/[\\/\u0000-\u001f]/.test(name) && !name.includes("..");

// GET /component-notes/materials?q= — katalog bahan resmi (id, kode, nama, satuan) untuk menautkan; tanpa stok/harga.
productionComponentNotesRouter.get("/materials", requireAnyPermission(...WRITE_PERMS), async (req, res) => {
  try { res.json({ items: await searchComponentMaterials(prisma, req.query.q) }); } catch (err) { handleErr(err, res); }
});

// GET /component-notes/units/:unitId — bacaan kanonis (seksi terkini, perbandingan Sebelum→Sesudah, histori, saran dari bahan terpakai).
productionComponentNotesRouter.get("/units/:unitId", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const { unitId } = req.params;
    if (!UUID.test(String(unitId))) return res.status(400).json({ error: "ID unit tidak valid", code: "ID_INVALID" });
    const unitIds = await readerCohort();
    if (!unitIds) return res.json({ readerMode: "OFF", canWrite: false, sections: {}, comparison: null, history: [] });
    if (!unitIds.includes(unitId)) return res.status(404).json({ error: "Unit tidak ditemukan atau di luar cohort", code: "UNIT_NOT_FOUND" });
    const notes = await getComponentNotes(prisma, unitId, { includeSuggestions: canWriteRole(req.user) });
    if (!notes) return res.status(404).json({ error: "Unit tidak ditemukan atau di luar cohort", code: "UNIT_NOT_FOUND" });
    const writerOn = isProductionWriterEnabledFor(resolveProductionWriterState(await loadV2Flags(prisma)), unitId);
    res.json({ readerMode: "COHORT", canWrite: canWriteRole(req.user) && writerOn, ...notes });
  } catch (err) { handleErr(err, res); }
});

// POST /component-notes/units/:unitId/upload (multipart: files[]) -> { items: [{ url, kind, size, previewUrl }] } — foto saja, magic byte diperiksa, berkas masuk store bukti yang sama.
productionComponentNotesRouter.post("/units/:unitId/upload", requireAnyPermission(...WRITE_PERMS), (req, res, next) => {
  upload.array("files", MAX_FILES)(req, res, (err) => {
    if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Foto terlalu besar (maksimal 15 MB)", code: "COMPONENT_TOO_LARGE" });
    if (err?.code === "LIMIT_FILE_COUNT") return res.status(400).json({ error: `Maksimal ${MAX_FILES} foto per unggahan`, code: "COMPONENT_TOO_MANY" });
    if (err) return next(err);
    return next();
  });
}, async (req, res) => {
  try {
    const files = req.files || [];
    await assertCanUploadComponentMedia(prisma, { unitId: req.params.unitId });
    if (files.length === 0) throw componentError("Pilih foto (JPG/PNG/WEBP) — berkas lain ditolak", 400, "COMPONENT_EMPTY");
    for (const f of files) if (!SAFE_NAME(f.originalname)) throw componentError("Nama berkas tidak valid", 400, "COMPONENT_FILENAME_INVALID");
    const items = [];
    for (const f of files) {
      const buf = fs.readFileSync(f.path);
      const sniffed = sniffImageType(buf);
      if (!sniffed) throw componentError("Berkas bukan JPEG/PNG/WebP yang valid", 415, "COMPONENT_INVALID_TYPE");
      if (sniffed.mimeType !== f.mimetype) throw componentError("Tipe berkas tidak sesuai isinya", 415, "COMPONENT_TYPE_MISMATCH");
      const name = `${crypto.createHash("sha1").update(buf).digest("hex")}.${sniffed.ext}`;
      const abs = path.join(EVIDENCE_DIR, name);
      if (!abs.startsWith(path.resolve(EVIDENCE_DIR))) throw componentError("Nama berkas tidak valid", 400, "COMPONENT_FILENAME_INVALID");
      if (fs.existsSync(abs)) fs.unlinkSync(f.path); else fs.renameSync(f.path, abs);
      const url = `${EVIDENCE_URL_PREFIX}${name}`;
      items.push({ url, kind: "image", size: buf.length, previewUrl: signEvidenceUrl(url) });
    }
    res.status(201).json({ items });
  } catch (err) { handleErr(err, res); } finally { cleanupIncoming(req); }
});

// POST /component-notes/units/:unitId/sections/:section { expectedVersion, data, media?, reason? } — Idempotency-Key. Versi baru; yang lama tetap ada.
productionComponentNotesRouter.post("/units/:unitId/sections/:section", requireAnyPermission(...WRITE_PERMS), async (req, res) => {
  try {
    const result = await recordComponentSection(prisma, {
      unitId: req.params.unitId, section: req.params.section, actor: { id: req.user.id }, idempotencyKey: idem(req),
      expectedVersion: req.body?.expectedVersion, data: req.body?.data, media: req.body?.media, reason: req.body?.reason,
    });
    res.status(result.replayed || result.unchanged ? 200 : 201).json(result);
  } catch (err) { handleErr(err, res); }
});
