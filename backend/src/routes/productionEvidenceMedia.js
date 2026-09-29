// Media BUKTI tahap produksi V2 (P8) — foto & video PIC Table/Corner. TIDAK publik-by-URL.
//
// Unggah: POST /api/production-v2/evidence/upload (multipart, field "files", maks 6 berkas; foto <= 15 MB, video <= 80 MB).
//   Hanya pemegang UNIT_STAGE_WRITE dan hanya untuk unit yang writer V2-nya aktif (cohort; fail-closed) — unit non-cohort tidak pernah
//   mendapat berkas V2. Nama berkas = sha1 isi + ekstensi dari MIME yang diizinkan (bukan nama asli); unggah ulang berkas sama = URL sama.
// Lihat: GET /media/production-evidence/<file> dengan Bearer (UNIT_READ + reader cohort memuat unit pemilik bukti) ATAU URL bertanda-tangan
//   (exp/sig, kunci turunan "production-evidence-v1", 60 menit) — dipakai <img>/<video> di web yang tidak bisa mengirim header.
// Penandatanganan dilakukan server saat menyajikan kartu/laporan (read-model), tidak ada endpoint tanda tangan bebas.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { prisma } from "../db.js";
import { authenticateBearer } from "../middleware/auth.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { signFile, verifyFileSignature } from "../lib/mediaSigning.js";
import { EVIDENCE_FILE_PATTERN, EVIDENCE_URL_PREFIX } from "../lib/domain/productionSteps.js";
import { EVIDENCE_DIR, EVIDENCE_TMP_DIR, ensureEvidenceDirs } from "../lib/productionEvidenceStore.js";
import { isProductionReaderEnabledFor, isProductionWriterEnabledFor, loadV2Flags, resolveProductionReaderState, resolveProductionWriterState } from "../services/v2FeatureFlags.js";

ensureEvidenceDirs();

export const EVIDENCE_SIGN_PURPOSE = "production-evidence-v1";
export const EVIDENCE_SIGN_TTL_SECONDS = 60 * 60;
const MIME_EXT = Object.freeze({
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
});
const EXT_MIME = Object.freeze({ jpg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" });
const IMAGE_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 80 * 1024 * 1024;

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha1");
    fs.createReadStream(file).on("data", (chunk) => h.update(chunk)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

// Bersihkan berkas sementara dari unggahan yang ditolak di tengah jalan (validasi setelah multer).
function cleanupIncoming(req) {
  for (const f of req.files || []) { try { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { /* abaikan */ } }
}

function evidenceError(res, status, message, code) {
  return res.status(status).json({ error: message, code });
}

export function signEvidenceUrl(url, { now = Date.now() } = {}) {
  const s = String(url || "");
  if (!s.startsWith(EVIDENCE_URL_PREFIX)) return null;
  const file = s.slice(EVIDENCE_URL_PREFIX.length);
  if (!EVIDENCE_FILE_PATTERN.test(file)) return null;
  const { exp, sig } = signFile(file, { ttlSeconds: EVIDENCE_SIGN_TTL_SECONDS, now, purpose: EVIDENCE_SIGN_PURPOSE });
  return `${EVIDENCE_URL_PREFIX}${file}?exp=${exp}&sig=${sig}`;
}

const upload = multer({
  // Disk (bukan memori): video besar tidak ditahan di RAM. Berkas sementara dihapus setelah dipindah/ditolak.
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, EVIDENCE_TMP_DIR),
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.part`),
  }),
  limits: { fileSize: VIDEO_MAX, files: 6 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(MIME_EXT[file.mimetype])),
});

// Router di bawah /api/production-v2 (requireAuth sudah dipasang di index.js).
export const productionEvidenceUploadRouter = express.Router();

productionEvidenceUploadRouter.post("/evidence/upload", (req, res, next) => {
  if (!hasPermission(req.user, P.UNIT_STAGE_WRITE)) return evidenceError(res, 403, "Anda tidak punya akses mengunggah bukti produksi", "EVIDENCE_FORBIDDEN");
  upload.array("files", 6)(req, res, (err) => {
    if (err?.code === "LIMIT_FILE_SIZE") return evidenceError(res, 413, "Berkas terlalu besar (video maksimal 80 MB, foto maksimal 15 MB)", "EVIDENCE_TOO_LARGE");
    if (err?.code === "LIMIT_FILE_COUNT") return evidenceError(res, 400, "Maksimal 6 berkas per unggahan", "EVIDENCE_TOO_MANY");
    if (err) return next(err);
    return next();
  });
}, async (req, res) => {
  try {
    const runId = String(req.body?.runId || "");
    if (!runId) return evidenceError(res, 400, "runId wajib diisi", "EVIDENCE_RUN_REQUIRED");
    const run = await prisma.productionRun.findUnique({ where: { id: runId }, select: { unitId: true, status: true } });
    if (!run) return evidenceError(res, 404, "Production Run tidak ditemukan", "EVIDENCE_RUN_NOT_FOUND");
    const writer = resolveProductionWriterState(await loadV2Flags(prisma));
    if (!isProductionWriterEnabledFor(writer, run.unitId)) return evidenceError(res, 503, "Produksi V2 tidak aktif untuk unit ini", "EVIDENCE_WRITER_OFF");
    if (["COMPLETED", "CANCELLED"].includes(run.status)) return evidenceError(res, 409, "Produksi unit ini sudah selesai/dibatalkan", "EVIDENCE_RUN_TERMINAL");
    const files = req.files || [];
    if (files.length === 0) return evidenceError(res, 400, "Pilih foto atau video (JPG/PNG/WEBP/MP4/WEBM/MOV)", "EVIDENCE_EMPTY");
    if (files.some((f) => !f.mimetype.startsWith("video/") && f.size > IMAGE_MAX)) {
      return evidenceError(res, 413, "Foto terlalu besar (maksimal 15 MB)", "EVIDENCE_TOO_LARGE");
    }
    const items = [];
    for (const f of files) {
      const ext = MIME_EXT[f.mimetype];
      const digest = await sha1File(f.path);
      const name = `${digest}.${ext}`;
      const abs = path.join(EVIDENCE_DIR, name);
      if (fs.existsSync(abs)) fs.unlinkSync(f.path);
      else fs.renameSync(f.path, abs);
      const url = `${EVIDENCE_URL_PREFIX}${name}`;
      items.push({ url, kind: f.mimetype.startsWith("video/") ? "video" : "image", size: f.size, previewUrl: signEvidenceUrl(url) });
    }
    res.status(201).json({ items });
  } catch (err) {
    console.error("[productionEvidenceMedia] upload:", err);
    res.status(500).json({ error: "Terjadi kesalahan di server saat menyimpan bukti" });
  } finally {
    cleanupIncoming(req); // berkas yang sudah dipindah tidak ada lagi di .incoming -> no-op
  }
});

// Bearer: bukti hanya boleh dilihat bila unit pemiliknya ada di reader cohort dan user punya UNIT_READ.
async function bolehLihat(user, file) {
  if (!user || !hasPermission(user, P.UNIT_READ)) return false;
  const reader = resolveProductionReaderState(await loadV2Flags(prisma));
  const url = `${EVIDENCE_URL_PREFIX}${file}`;
  const rows = await prisma.$queryRaw`SELECT DISTINCT r.unit_id::text AS "unitId" FROM production_step_evidence_v2 e JOIN production_runs_v2 r ON r.id = e.run_id
    WHERE e.media @> ${JSON.stringify([{ url }])}::jsonb LIMIT 5`;
  return rows.some((row) => isProductionReaderEnabledFor(reader, row.unitId));
}

async function kirim(req, res) {
  const file = String(req.params.file || "");
  if (!EVIDENCE_FILE_PATTERN.test(file)) return res.status(404).json({ error: "Bukti tidak ditemukan" });
  if (req.query.sig) {
    if (!verifyFileSignature(file, req.query.exp, req.query.sig, { purpose: EVIDENCE_SIGN_PURPOSE })) {
      return res.status(403).json({ error: "Tautan bukti tidak valid atau sudah kedaluwarsa" });
    }
  } else {
    const user = await authenticateBearer(req);
    if (!user) return res.status(401).json({ error: "Belum login" });
    if (!(await bolehLihat(user, file))) return res.status(403).json({ error: "Anda tidak punya akses untuk melihat bukti ini" });
  }
  const abs = path.join(EVIDENCE_DIR, file);
  if (!abs.startsWith(path.resolve(EVIDENCE_DIR)) || !fs.existsSync(abs)) return res.status(404).json({ error: "Bukti tidak ditemukan" });
  const mime = EXT_MIME[file.split(".").pop()];
  const stat = fs.statSync(abs);
  res.setHeader("Content-Type", mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=600");
  res.setHeader("Accept-Ranges", "bytes");
  // Range untuk pemutaran video di browser/HP.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (range && mime.startsWith("video/")) {
    const start = range[1] === "" ? Math.max(stat.size - Number(range[2] || 0), 0) : Number(range[1]);
    const end = range[1] !== "" && range[2] !== "" ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) { res.status(416).setHeader("Content-Range", `bytes */${stat.size}`); return res.end(); }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", end - start + 1);
    return fs.createReadStream(abs, { start, end }).on("error", () => res.destroy()).pipe(res);
  }
  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(abs).on("error", () => res.destroy()).pipe(res);
}

// Jalur publik bertanda-tangan (di luar /api), seperti /media/bukti-pembayaran.
export const productionEvidencePathRouter = express.Router();
productionEvidencePathRouter.get("/:file", (req, res) => {
  kirim(req, res).catch((err) => {
    console.error("[productionEvidenceMedia] kirim:", err);
    if (!res.headersSent) res.status(500).json({ error: "Terjadi kesalahan di server" });
  });
});
