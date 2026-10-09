// Ringkasan capture atribusi CTWA Fase 0 — BACA SAJA, tanpa DB, tanpa jaringan.
//
//   node scripts/ctwa-capture-report.js              # teks ringkas
//   node scripts/ctwa-capture-report.js --json       # JSON
//   node scripts/ctwa-capture-report.js --dir=/path  # lokasi lain
//
// Di container produksi:
//   docker compose exec backend node scripts/ctwa-capture-report.js
//
// Hanya membaca ctwa-capture-YYYY-MM-DD.jsonl (observasi bersinyal) dan
// ctwa-capture-counts-YYYY-MM-DD.json (hitungan agregat); isinya sudah ter-sanitasi.
import fs from "fs";
import path from "path";
import { captureDir } from "../src/services/ctwaCapture.js";
import { summarize, summarizeCounts } from "../src/services/ctwaCaptureAnalysis.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const dirArg = args.find((a) => a.startsWith("--dir="));
const dir = dirArg ? dirArg.slice(6) : captureDir();

let files = [];
let countFiles = [];
try {
  const all = fs.readdirSync(dir);
  files = all.filter((f) => /^ctwa-capture-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  countFiles = all.filter((f) => /^ctwa-capture-counts-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
} catch (e) {
  console.error(`Tidak bisa membaca ${dir}: ${e.code || "ERR"}`);
  process.exit(1);
}

const rows = [];
let badLines = 0;
for (const f of files) {
  for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { badLines++; }
  }
}

const countRows = [];
for (const f of countFiles) {
  try { countRows.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))); } catch { badLines++; }
}

const result = { files: files.length, countFiles: countFiles.length, badLines, volume: summarizeCounts(countRows), ...summarize(rows) };
if (asJson) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Berkas: ${result.files}  Observasi unik: ${result.totalObserved}  Duplikat diabaikan: ${result.duplicatesIgnored}  Baris rusak: ${badLines}`);
  console.log("Volume inbound (agregat):", JSON.stringify(result.volume, null, 2));
  if (result.saltWarning) console.log("PERINGATAN:", result.saltWarning);
  console.log("Verdict (hanya pesan bersinyal yang ditulis ke JSONL):", result.verdicts);
  console.log("Customer baru vs lama:", result.byCustomer);
  console.log("Event:", result.events);
  console.log("CTWA_AD:", JSON.stringify(result.ctwaAd, null, 2));
  console.log("sourceURL:", JSON.stringify(result.sourceUrl, null, 2));
  console.log("Kesimpulan:", JSON.stringify(result.conclusions, null, 2));
}
