// Lokasi penyimpanan unggahan foto identitas unit MANUAL (P9B.1, PRODUCTION_MANUAL saja — foto pickup driver
// dibaca langsung dari data/job-photos milik Delivery, tidak pernah disalin ke sini). Pola direktori sama
// persis dengan productionEvidenceStore.js (P8): nama berkas = sha1(isi)+ekstensi, unggah ulang berkas
// identik tidak menggandakan.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UNIT_PHOTO_DIR = process.env.PRODUCTION_UNIT_PHOTO_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data/unit-photo-evidence");
export const UNIT_PHOTO_TMP_DIR = path.join(UNIT_PHOTO_DIR, ".incoming");

export function ensureUnitPhotoDirs() {
  fs.mkdirSync(UNIT_PHOTO_TMP_DIR, { recursive: true });
}

export const UNIT_PHOTO_FILE_PATTERN = /^[a-f0-9]{40}\.(jpg|png|webp)$/;
