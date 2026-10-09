// Hapus data capture atribusi CTWA Fase 0.
//
//   node scripts/ctwa-capture-purge.js --dry-run     # tampilkan yang akan dihapus
//   node scripts/ctwa-capture-purge.js               # hapus yang melewati retensi (maks 7 hari)
//   node scripts/ctwa-capture-purge.js --all         # hapus SEMUA berkas capture (wajib saat fase selesai)
//
// Di container produksi:
//   docker compose exec backend node scripts/ctwa-capture-purge.js --all
//
// Hanya menyentuh berkas ber-pola ctwa-capture-YYYY-MM-DD.jsonl di direktori capture.
import { purgeCaptures, captureDir, effectiveRetentionDays } from "../src/services/ctwaCapture.js";

const args = process.argv.slice(2);
const all = args.includes("--all");
const dryRun = args.includes("--dry-run");

const res = await purgeCaptures({ all, dryRun });
console.log(`${dryRun ? "[dry-run] " : ""}Direktori: ${captureDir()}  Retensi: ${effectiveRetentionDays()} hari${all ? "  (--all)" : ""}`);
console.log(`Dihapus: ${res.removed.length}  Dipertahankan: ${res.kept}  Gagal: ${res.errors}`);
for (const n of res.removed) console.log(`  - ${n}`);
process.exit(res.errors ? 1 : 0);
