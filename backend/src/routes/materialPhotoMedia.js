// Penyajian foto bahan — TIDAK ADA penyajian statis direktori data. Pola sama dengan productionUnitPhoto.js / productionEvidenceMedia.js:
//   GET /api/inventory/foto-bahan/<nama>?exp=&sig=   URL bertanda-tangan (kunci turunan "material-photo-v1", subjek = nama berkas) yang hanya disisipkan pada respons berizin; ATAU
//   GET /api/inventory/foto-bahan/<nama> + Bearer    pemegang izin baca bahan (INVENTORY_READ atau UNIT_MATERIAL_WRITE — sama dengan daftar bahan).
// Nama berkas HARUS cocok pola ketat (uuid-bahan-hex.webp / ...-t.webp): tidak ada path, "..", direktori, atau berkas lain di folder yang bisa dijangkau. Daftar direktori tidak pernah tersedia.
// Cache: nama berkas tak pernah berubah isinya (unggah/putar/ganti = nama baru) → private, immutable; foto lama berhenti dirujuk sejak daftar/drawer memuat URL baru.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { authenticateBearer } from "../middleware/auth.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { verifyFileSignature } from "../lib/mediaSigning.js";
import { FOTO_BAHAN_DIR, SIGN_PURPOSE, namaSajianValid } from "../services/fotoBahan.js";

export const materialPhotoPathRouter = express.Router();

async function kirim(req, res) {
  const nama = String(req.params.nama || "");
  if (!namaSajianValid(nama)) return res.status(404).json({ error: "Foto tidak ditemukan" });
  if (req.query.sig) {
    if (!verifyFileSignature(nama, req.query.exp, req.query.sig, { purpose: SIGN_PURPOSE })) {
      return res.status(403).json({ error: "Tautan foto tidak valid atau sudah kedaluwarsa. Muat ulang halaman." });
    }
  } else {
    const user = await authenticateBearer(req);
    if (!user) return res.status(401).json({ error: "Belum login" });
    if (!hasPermission(user, P.INVENTORY_READ) && !hasPermission(user, P.UNIT_MATERIAL_WRITE)) return res.status(403).json({ error: "Anda tidak punya akses untuk melihat foto bahan" });
  }
  const abs = path.join(FOTO_BAHAN_DIR, nama);
  if (!abs.startsWith(path.resolve(FOTO_BAHAN_DIR) + path.sep)) return res.status(404).json({ error: "Foto tidak ditemukan" });
  let stat;
  try { stat = await fs.promises.stat(abs); } catch { return res.status(404).json({ error: "Foto tidak ditemukan" }); }
  if (!stat.isFile()) return res.status(404).json({ error: "Foto tidak ditemukan" });
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=86400, immutable");
  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(abs).on("error", () => res.destroy()).pipe(res);
}

materialPhotoPathRouter.get("/:nama", (req, res) => {
  kirim(req, res).catch((err) => {
    console.error("[materialPhotoMedia] kirim:", err);
    if (!res.headersSent) res.status(500).json({ error: "Terjadi kesalahan di server" });
  });
});
