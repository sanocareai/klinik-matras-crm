// KOMPONEN LAMA DARI UNIT PELANGGAN (dipasang di /api/production). Komponen bongkaran milik kasur pelanggan yang dipakai kembali / dilepas — BUKAN stok perusahaan.
//   GET  /units/:id/komponen-lama                       keadaan terkini + riwayat versi + total terpisah                         UNIT_READ
//   POST /units/:id/komponen-lama                       catat komponen (Idempotency-Key)                                          UNIT_MATERIAL_WRITE
//   POST /units/:id/komponen-lama/:itemId/koreksi       koreksi berjejak (versi baru, alasan wajib, expectedVersion)              UNIT_MATERIAL_WRITE
//   POST /units/:id/komponen-lama/:itemId/batal         batalkan karena salah input (versi VOIDED, alasan wajib)                  UNIT_MATERIAL_WRITE
//   POST /units/:id/komponen-lama/foto                  unggah foto bukti (JPG/PNG/WEBP, maks 3)                                  UNIT_MATERIAL_WRITE
// TIDAK ada endpoint di sini yang menulis pergerakan stok, Material Issue, reservasi, jurnal, harga persediaan, penerimaan Gudang, atau pesan pelanggan.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { EVIDENCE_DIR, EVIDENCE_TMP_DIR, ensureEvidenceDirs } from "../lib/productionEvidenceStore.js";
import { EVIDENCE_URL_PREFIX } from "../lib/domain/productionSteps.js";
import { signEvidenceUrl } from "./productionEvidenceMedia.js";
import { sniffImageType } from "../services/productionUnitPhotoService.js";
import { OUTCOME, PHOTO_MAX, UOM_LIST, ambilKomponenLama, catatKomponenLama, koreksiKomponenLama } from "../services/productionComponentReuseService.js";

ensureEvidenceDirs();
const IMAGE_MAX = 15 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({
  storage: multer.diskStorage({ destination: (_r, _f, cb) => cb(null, EVIDENCE_TMP_DIR), filename: (_r, _f, cb) => cb(null, `${crypto.randomUUID()}.part`) }),
  limits: { fileSize: IMAGE_MAX, files: PHOTO_MAX }, preservePath: true, fileFilter: (_r, file, cb) => cb(null, IMAGE_MIME.has(file.mimetype)),
});
const cleanupIncoming = (req) => { for (const f of req.files || []) { try { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { /* abaikan */ } } };

export const productionComponentReuseRouter = express.Router();
productionComponentReuseRouter.use(requireAuth);

function handleErr(err, res) {
  if (Number.isInteger(err?.statusCode) && err.code) return res.status(err.statusCode).json({ error: err.message, code: err.code, ...(err.details ? { detail: err.details } : {}) });
  console.error("Komponen lama error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}
const kunci = (req) => req.get("Idempotency-Key");
const meta = (user) => ({ boleh: hasPermission(user, P.UNIT_MATERIAL_WRITE), hasil: Object.values(OUTCOME).map((o) => ({ key: o.key, label: o.label, pemakaian: o.pemakaian })), satuan: UOM_LIST, fotoMaks: PHOTO_MAX });

productionComponentReuseRouter.get("/units/:id/komponen-lama", requirePermission(P.UNIT_READ), wajibUuid(), async (req, res) => {
  try { res.set("Cache-Control", "no-store"); res.json({ ...(await ambilKomponenLama(prisma, req.params.id, { tandaiFoto: signEvidenceUrl })), izin: meta(req.user) }); } catch (err) { handleErr(err, res); }
});
productionComponentReuseRouter.post("/units/:id/komponen-lama", requirePermission(P.UNIT_MATERIAL_WRITE), wajibUuid(), async (req, res) => {
  try {
    const r = await catatKomponenLama(prisma, { unitId: req.params.id, input: req.body, actorId: req.user.id, idempotencyKey: kunci(req) });
    res.status(r.replayed ? 200 : 201).json(r);
  } catch (err) { handleErr(err, res); }
});
productionComponentReuseRouter.post("/units/:id/komponen-lama/:itemId/koreksi", requirePermission(P.UNIT_MATERIAL_WRITE), wajibUuid(), async (req, res) => {
  try {
    const r = await koreksiKomponenLama(prisma, { unitId: req.params.id, itemId: req.params.itemId, kind: "CORRECTED", input: req.body?.data, reason: req.body?.reason, expectedVersion: req.body?.expectedVersion, actorId: req.user.id, idempotencyKey: kunci(req) });
    res.status(r.replayed ? 200 : 201).json(r);
  } catch (err) { handleErr(err, res); }
});
productionComponentReuseRouter.post("/units/:id/komponen-lama/:itemId/batal", requirePermission(P.UNIT_MATERIAL_WRITE), wajibUuid(), async (req, res) => {
  try {
    const r = await koreksiKomponenLama(prisma, { unitId: req.params.id, itemId: req.params.itemId, kind: "VOIDED", reason: req.body?.reason, expectedVersion: req.body?.expectedVersion, actorId: req.user.id, idempotencyKey: kunci(req) });
    res.status(r.replayed ? 200 : 201).json(r);
  } catch (err) { handleErr(err, res); }
});
productionComponentReuseRouter.post("/units/:id/komponen-lama/foto", requirePermission(P.UNIT_MATERIAL_WRITE), wajibUuid(), (req, res, next) => {
  upload.array("files", PHOTO_MAX)(req, res, (err) => {
    if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Foto terlalu besar (maksimal 15 MB)", code: "KOMPONEN_FOTO_BESAR" });
    if (err?.code === "LIMIT_FILE_COUNT") return res.status(400).json({ error: `Maksimal ${PHOTO_MAX} foto`, code: "KOMPONEN_FOTO_TERLALU_BANYAK" });
    if (err) return next(err);
    return next();
  });
}, async (req, res) => {
  try {
    const files = req.files || [];
    const unit = await prisma.unit.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan", code: "UNIT_TIDAK_ADA" });
    if (["CANCELLED", "DELIVERED"].includes(unit.status)) return res.status(409).json({ error: "Unit sudah selesai/dibatalkan", code: "UNIT_TIDAK_AKTIF" });
    if (!files.length) return res.status(400).json({ error: "Pilih foto JPG/PNG/WEBP", code: "KOMPONEN_FOTO_KOSONG" });
    const items = [];
    for (const f of files) {
      const buf = fs.readFileSync(f.path); const sniffed = sniffImageType(buf);
      if (!sniffed) return res.status(415).json({ error: "Berkas bukan JPEG/PNG/WebP yang valid", code: "KOMPONEN_FOTO_TIPE" });
      if (sniffed.mimeType !== f.mimetype) return res.status(415).json({ error: "Tipe berkas tidak sesuai isinya", code: "KOMPONEN_FOTO_TIPE" });
      const name = `${crypto.createHash("sha1").update(buf).digest("hex")}.${sniffed.ext}`; const abs = path.join(EVIDENCE_DIR, name);
      if (!abs.startsWith(path.resolve(EVIDENCE_DIR))) return res.status(400).json({ error: "Nama berkas tidak valid", code: "KOMPONEN_FOTO_NAMA" });
      if (fs.existsSync(abs)) fs.unlinkSync(f.path); else fs.renameSync(f.path, abs);
      const url = `${EVIDENCE_URL_PREFIX}${name}`; items.push({ url, previewUrl: signEvidenceUrl(url) });
    }
    res.status(201).json({ items });
  } catch (err) { handleErr(err, res); } finally { cleanupIncoming(req); }
});
