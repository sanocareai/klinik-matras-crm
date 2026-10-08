// Ringkasan capture atribusi CTWA Fase 0 — BACA SAJA, tanpa DB, tanpa jaringan.
//
//   node scripts/ctwa-capture-report.js              # teks ringkas
//   node scripts/ctwa-capture-report.js --json       # JSON
//   node scripts/ctwa-capture-report.js --dir=/path  # lokasi lain
//
// Di container produksi:
//   docker compose exec backend node scripts/ctwa-capture-report.js
//
// Hanya membaca berkas ctwa-capture-YYYY-MM-DD.jsonl (isinya sudah ter-sanitasi).
import fs from "fs";
import path from "path";
import { captureDir } from "../src/services/ctwaCapture.js";
import { summarize } from "../src/services/ctwaCaptureAnalysis.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const dirArg = args.find((a) => a.startsWith("--dir="));
const dir = dirArg ? dirArg.slice(6) : captureDir();

let files = [];
try {
  files = fs.readdirSync(dir).filter((f) => /^ctwa-capture-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
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

const result = { files: files.length, badLines, ...summarize(rows) };
if (asJson) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Berkas: ${result.files}  Observasi unik: ${result.totalObserved}  Duplikat diabaikan: ${result.duplicatesIgnored}  Baris rusak: ${badLines}`);
  console.log("Verdict:", result.verdicts);
  console.log("Customer baru vs lama:", result.byCustomer);
  console.log("Event:", result.events);
  console.log("CTWA_AD:", JSON.stringify(result.ctwaAd, null, 2));
  console.log("sourceURL:", JSON.stringify(result.sourceUrl, null, 2));
  console.log("Kesimpulan:", JSON.stringify(result.conclusions, null, 2));
}
