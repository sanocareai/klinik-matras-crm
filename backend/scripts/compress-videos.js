// Kompres video lama di uploads/ (lihat services/videoCompress.js untuk aturan & risikonya).
//
// DEFAULT = dry-run (hanya menampilkan kandidat). File asli DITIMPA saat --apply
// dan TIDAK BISA dikembalikan — coba dulu dengan --limit kecil dan periksa hasilnya.
//
//   docker compose exec backend node scripts/compress-videos.js --limit 20
//   docker compose exec backend node scripts/compress-videos.js --apply --limit 20
//   docker compose exec backend node scripts/compress-videos.js --apply --budget-min 120
//
// Opsi: --apply  --limit N  --min-age-hours N (24)  --min-size-mb N (1.5)  --max-size-mb N  --budget-min N
import path from "path";
import { fileURLToPath } from "url";
import { compressUploadsBatch } from "../src/services/videoCompress.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "../uploads");

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};

const apply = process.argv.includes("--apply");
console.log(apply ? "MODE APPLY — file asli akan ditimpa" : "MODE DRY-RUN — tidak ada file diubah (tambahkan --apply)");

const r = await compressUploadsBatch(uploadsDir, {
  apply,
  limit: arg("limit", Infinity),
  minAgeHours: arg("min-age-hours", 24),
  minSizeMb: arg("min-size-mb", 1.5),
  maxSizeMb: arg("max-size-mb", Infinity),
  budgetMinutes: arg("budget-min", Infinity),
  log: (m) => console.log(m),
});

const mb = (n) => (n / 1048576).toFixed(1);
console.log("\nRingkasan:", JSON.stringify({ ...r, bytesBefore: undefined, bytesAfter: undefined }));
if (r.compressed > 0) {
  console.log(`Dihemat: ${mb(r.bytesBefore - r.bytesAfter)} MB dari ${mb(r.bytesBefore)} MB (${(100 * (1 - r.bytesAfter / r.bytesBefore)).toFixed(0)}%)`);
}
process.exit(0);
