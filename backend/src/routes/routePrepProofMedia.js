// Media BUKTI Checklist Persiapan Perjalanan — foto muatan/kaki kasur/plastik/tali yang diunggah driver. TIDAK publik-by-URL.
//
// SEBELUMNYA bukti disimpan di data/job-photos yang disajikan express.static publik: siapa pun yang tahu/menebak URL (tanpa login) bisa membukanya.
// Kini disimpan di data/route-prep-proofs (BUKAN direktori statis) dan hanya disajikan lewat jalur ini:
//   1. Bearer (klien native/fetch): pemegang JOB_READ (dispatcher/admin) ATAU driver/helper rute pemilik bukti; driver lain ditolak 403.
//   2. URL bertanda-tangan berumur pendek (exp/sig; kunci turunan "route-prep-proof-v1") — untuk <img> di web yang tak bisa mengirim header. Tanda tangan
//      hanya dikeluarkan server saat melayani daftar checklist kepada pembaca yang sah (tidak ada endpoint tanda tangan bebas).
// Tanpa login dan tanpa tanda tangan -> 401/403, tidak pernah 200.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { prisma } from "../db.js";
import { authenticateBearer } from "../middleware/auth.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { signFile, verifyFileSignature } from "../lib/mediaSigning.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PREP_PROOF_DIR = path.join(__dirname, "../../data/route-prep-proofs");
export const PREP_PROOF_PREFIX = "/media/route-prep-proofs/";
export const PREP_PROOF_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
export const PREP_PROOF_SIGN_PURPOSE = "route-prep-proof-v1";
export const PREP_PROOF_SIGN_TTL_SECONDS = 60 * 60;
const MIME_EXT = Object.freeze({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" });
const EXT_MIME = Object.freeze({ jpg: "image/jpeg", png: "image/png", webp: "image/webp" });
if (!fs.existsSync(PREP_PROOF_DIR)) fs.mkdirSync(PREP_PROOF_DIR, { recursive: true });

// Unggahan bukti checklist: nama berkas = UUID acak + ekstensi dari MIME (bukan nama asli klien).
export const prepProofUpload = multer({
  storage: multer.diskStorage({
    destination: PREP_PROOF_DIR,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}.${MIME_EXT[file.mimetype] || "jpg"}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!MIME_EXT[file.mimetype]) return cb(new Error("Hanya foto JPG/PNG/WEBP yang diperbolehkan"));
    cb(null, true);
  },
});

// Hanya URL internal bukti checklist yang ditandatangani; URL lama (/media/job-photos/…) dikembalikan apa adanya.
export function signPrepProofUrl(url, { now = Date.now() } = {}) {
  const s = String(url || "");
  if (!s.startsWith(PREP_PROOF_PREFIX)) return s || null;
  const file = s.slice(PREP_PROOF_PREFIX.length);
  if (!PREP_PROOF_FILE_PATTERN.test(file)) return null;
  const { exp, sig } = signFile(file, { ttlSeconds: PREP_PROOF_SIGN_TTL_SECONDS, now, purpose: PREP_PROOF_SIGN_PURPOSE });
  return `${PREP_PROOF_PREFIX}${file}?exp=${exp}&sig=${sig}`;
}

// Pemegang bukti = rute yang memuat bukti itu. JOB_READ (admin/dispatcher) atau crew rute (driver/helper) — driver lain tidak.
async function bolehLihat(user, file) {
  if (!user) return false;
  const proof = await prisma.routePrepChecklistProof.findFirst({
    where: { photoUrl: `${PREP_PROOF_PREFIX}${file}` },
    select: { route: { select: { driverId: true, helperId: true } } },
  });
  if (!proof) return false;
  if (hasPermission(user, P.JOB_READ)) return true;
  const own = hasPermission(user, P.JOB_OWN_READ) || hasPermission(user, P.JOB_OWN_WRITE);
  return own && (proof.route.driverId === user.id || proof.route.helperId === user.id);
}

async function kirim(req, res) {
  const file = String(req.params.file || "");
  if (!PREP_PROOF_FILE_PATTERN.test(file)) return res.status(404).json({ error: "Bukti tidak ditemukan" });
  if (req.query.sig) {
    if (!verifyFileSignature(file, req.query.exp, req.query.sig, { purpose: PREP_PROOF_SIGN_PURPOSE })) {
      return res.status(403).json({ error: "Tautan bukti tidak valid atau sudah kedaluwarsa" });
    }
  } else {
    const user = await authenticateBearer(req);
    if (!user) return res.status(401).json({ error: "Belum login" });
    if (!(await bolehLihat(user, file))) return res.status(403).json({ error: "Anda tidak punya akses untuk melihat bukti ini" });
  }
  const abs = path.join(PREP_PROOF_DIR, file);
  if (!abs.startsWith(path.resolve(PREP_PROOF_DIR)) || !fs.existsSync(abs)) return res.status(404).json({ error: "Bukti tidak ditemukan" });
  res.setHeader("Content-Type", EXT_MIME[file.split(".").pop()]);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  fs.createReadStream(abs).on("error", () => res.destroy()).pipe(res);
}

export const prepProofPathRouter = express.Router();
prepProofPathRouter.get("/:file", (req, res) => {
  kirim(req, res).catch((err) => {
    console.error("[routePrepProofMedia] kirim:", err);
    if (!res.headersSent) res.status(500).json({ error: "Terjadi kesalahan di server" });
  });
});
