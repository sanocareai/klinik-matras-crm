// Lokasi penyimpanan berkas bukti tahap produksi V2 (P8). Dipakai router media (unggah/sajikan) dan command bukti (cek berkas ada).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVIDENCE_FILE_PATTERN, EVIDENCE_URL_PREFIX } from "./domain/productionSteps.js";

export const EVIDENCE_DIR = process.env.PRODUCTION_EVIDENCE_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data/production-evidence");
export const EVIDENCE_TMP_DIR = path.join(EVIDENCE_DIR, ".incoming");

export function ensureEvidenceDirs() {
  fs.mkdirSync(EVIDENCE_TMP_DIR, { recursive: true });
}

// Berkas bukti untuk URL kanonis ada di penyimpanan? (URL di luar pola = false)
export function evidenceFileExists(url) {
  const s = String(url || "");
  if (!s.startsWith(EVIDENCE_URL_PREFIX)) return false;
  const file = s.slice(EVIDENCE_URL_PREFIX.length);
  if (!EVIDENCE_FILE_PATTERN.test(file)) return false;
  return fs.existsSync(path.join(EVIDENCE_DIR, file));
}
