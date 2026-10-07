// Bukti foto Checklist Persiapan Perjalanan — TIDAK statis publik (audit
// keamanan 7 Okt 2026). Baca: GET /media/checklist-proof/<proofId> dengan
// Bearer (JOB_WRITE, ATAU driver/helper rute pemilik bukti ini) ATAU URL
// bertanda-tangan (exp/sig, kunci turunan "checklist-proof-v1", SUBJEK =
// id baris RoutePrepChecklistProof — BUKAN nama berkas, supaya URL tidak
// pernah membocorkan nama berkas di disk). Pola identik productionUnitPhoto.js.
//
// Ditandatangani SEGAR setiap kali GET /routes/:id/prep-checklist dipanggil
// (lihat signChecklistProofUrl di routes/armada.js) — umur pendek (30 menit)
// supaya URL yang kebetulan bocor (screenshot, riwayat browser, log proxy)
// tidak berlaku selamanya.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db.js";
import { authenticateBearer } from "../middleware/auth.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { signFile, verifyFileSignature } from "../lib/mediaSigning.js";
import { CHECKLIST_PROOF_PHOTO_DIR, CHECKLIST_PROOF_FILE_PATTERN } from "../lib/checklistProofPhotoStore.js";

export const CHECKLIST_PROOF_SIGN_PURPOSE = "checklist-proof-v1";
export const CHECKLIST_PROOF_SIGN_TTL_SECONDS = 30 * 60;

export function signChecklistProofUrl(proofId, { now = Date.now() } = {}) {
  const { exp, sig } = signFile(proofId, { ttlSeconds: CHECKLIST_PROOF_SIGN_TTL_SECONDS, now, purpose: CHECKLIST_PROOF_SIGN_PURPOSE });
  return `/media/checklist-proof/${proofId}?exp=${exp}&sig=${sig}`;
}

// Driver/helper rute pemilik ATAU JOB_WRITE — pola SAMA dengan
// loadOwnedRoute (routes/armada.js), diduplikasi tipis di sini supaya
// modul media tidak perlu mengimpor armada.js (lingkaran impor).
async function bolehLihat(user, routeDriverId, routeHelperId) {
  if (!user) return false;
  if (hasPermission(user, P.JOB_WRITE)) return true;
  if (!hasPermission(user, P.JOB_OWN_WRITE)) return false;
  return user.id === routeDriverId || user.id === routeHelperId;
}

async function kirim(req, res) {
  const proofId = String(req.params.proofId || "");
  if (!/^[0-9a-f-]{36}$/i.test(proofId)) return res.status(404).json({ error: "Foto tidak ditemukan" });

  if (req.query.sig) {
    if (!verifyFileSignature(proofId, req.query.exp, req.query.sig, { purpose: CHECKLIST_PROOF_SIGN_PURPOSE })) {
      return res.status(403).json({ error: "Tautan foto tidak valid atau sudah kedaluwarsa" });
    }
  } else {
    const user = await authenticateBearer(req);
    if (!user) return res.status(401).json({ error: "Belum login" });
    const proof = await prisma.routePrepChecklistProof.findUnique({
      where: { id: proofId },
      select: { route: { select: { driverId: true, helperId: true } } },
    });
    if (!proof) return res.status(404).json({ error: "Foto tidak ditemukan" });
    if (!(await bolehLihat(user, proof.route.driverId, proof.route.helperId))) {
      return res.status(403).json({ error: "Anda tidak punya akses untuk melihat foto ini" });
    }
  }

  const proof = await prisma.routePrepChecklistProof.findUnique({ where: { id: proofId }, select: { photoUrl: true } });
  if (!proof || !proof.photoUrl) return res.status(404).json({ error: "Foto tidak ditemukan" });

  // photoUrl HANYA berisi nama berkas (bukan path publik) sejak audit ini —
  // lihat catatan panjang checklistProofPhotoStore.js.
  const filename = proof.photoUrl;
  if (!CHECKLIST_PROOF_FILE_PATTERN.test(filename)) return res.status(404).json({ error: "Foto tidak ditemukan" });
  const abs = path.join(CHECKLIST_PROOF_PHOTO_DIR, filename);
  if (!abs.startsWith(path.resolve(CHECKLIST_PROOF_PHOTO_DIR))) return res.status(404).json({ error: "Foto tidak ditemukan" });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "Foto tidak ditemukan" });

  const stat = fs.statSync(abs);
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(abs).on("error", () => res.destroy()).pipe(res);
}

export const checklistProofMediaPathRouter = express.Router();
checklistProofMediaPathRouter.get("/:proofId", (req, res) => {
  kirim(req, res).catch((err) => {
    console.error("[checklistProofMedia] kirim:", err);
    if (!res.headersSent) res.status(500).json({ error: "Terjadi kesalahan di server" });
  });
});
