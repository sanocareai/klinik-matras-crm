// Generator skrip rilis "New Leads Dashboard termasuk spam" (nls1) — backend (image dibangun ulang) + web, TANPA migrasi.
// Allowlist eksplisit + sidik jari isi diff backend+frontend dihitung dari git terhadap --base. Kerangka: scripts/templates/release-new-leads-spam/rilis.txt.
//   node scripts/gen-release-new-leads-spam.cjs --base <SHA_LIVE_40> [--check]
"use strict";
const fs = require("fs"); const path = require("path"); const crypto = require("crypto"); const { execFileSync } = require("child_process");
const REPO = path.resolve(__dirname, ".."); const OUT = "scripts/release-new-leads-spam.sh"; const TPL = "scripts/templates/release-new-leads-spam";
const CAND_BRANCH = "feat/lead-tanpa-spam-on-f57a5679";
const git = (...a) => execFileSync("git", a, { cwd: REPO, maxBuffer: 1 << 29 });
const lf = (s) => s.replace(/\r\n/g, "\n"); const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
const arg = process.argv.slice(2); const base = arg[arg.indexOf("--base") + 1]; if (!arg.includes("--base") || !/^[0-9a-f]{40}$/.test(base || "")) throw new Error("wajib --base <SHA 40>");
const tetap = [OUT, "scripts/gen-release-new-leads-spam.cjs", `${TPL}/rilis.txt`, `${TPL}/gerbang-data.txt`];
// Berkas aplikasi yang DISETUJUI (tidak lebih, tidak kurang): backend analytics + web Dashboard/Marketing + tes.
const DISETUJUI = [
  "backend/src/routes/analytics.js",
  "backend/tests/integration/newLeadsTermasukSpam.integration.test.js",
  "frontend/src/features/laporan/components/marketing/RingkasanMarketing.jsx",
  "frontend/src/features/laporan/components/marketing/TabelSumber.jsx",
  "frontend/src/features/laporan/marketingLogic.js",
  "frontend/src/pages/Dashboard.jsx",
  "frontend/tests/laporanRedesignMarketing.test.js",
  "frontend/tests/leadTanpaSpam.test.js",
  // perbaikan 15 tes lama (tes saja)
  "frontend/tests/biayaAdminNominal.test.js", "frontend/tests/diagnosisWizard.test.js", "frontend/tests/financeTableBreakpoints.test.js",
  "frontend/tests/formulirResetPembelianPihak.test.js", "frontend/tests/gudangUxTahap3.test.js", "frontend/tests/penjualanKaryawanManualUi.test.js",
  "frontend/tests/pipelineFase.test.js", "frontend/tests/planDnd.test.js", "frontend/tests/rencanaOrderNyata.test.js", "frontend/tests/routeTimelineUI.test.js",
  "frontend/tests/workerAppExit.test.js",
].sort();
const berubah = git("diff", "--name-only", base, "HEAD").toString().split("\n").filter(Boolean);
const aplikasi = berubah.filter((f) => !tetap.includes(f)).sort();
if (JSON.stringify(aplikasi) !== JSON.stringify(DISETUJUI)) throw new Error("berkas aplikasi berbeda dari allowlist. Lebih: [" + aplikasi.filter((f) => !DISETUJUI.includes(f)).join(", ") + "] Kurang: [" + DISETUJUI.filter((f) => !aplikasi.includes(f)).join(", ") + "]");
for (const f of berubah) if (/package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env|^frontend\/dist|^backend\/prisma\//.test(f)) throw new Error("berkas terlarang: " + f);
const berkas = [...new Set([...DISETUJUI, ...tetap])].sort();
const diff = git("-c", "core.quotepath=false", "diff", "--no-renames", "--no-color", "--no-ext-diff", "--binary", "--full-index", base, "HEAD", "--", "backend", "frontend");
const baca = (f) => lf(fs.readFileSync(path.join(REPO, f), "utf8"));
const skrip = baca(`${TPL}/rilis.txt`).replace("@@ALLOWED_RE@@", () => `^(${berkas.map(esc).join("|")})$`).replace("@@DIFF_SHA@@", sha(diff))
  .replace("@@CAND_BRANCH@@", CAND_BRANCH).replace("@@GERBANG_DATA@@", () => baca(`${TPL}/gerbang-data.txt`).trimEnd());
if (/@@[A-Z_]+@@/.test(skrip)) throw new Error("placeholder tersisa");
const keluar = path.join(REPO, OUT);
if (arg.includes("--check")) { if (!fs.existsSync(keluar) || lf(fs.readFileSync(keluar, "utf8")) !== skrip) { console.error("TIDAK SAMA"); process.exit(1); } console.log("SAMA"); }
else { fs.writeFileSync(keluar, skrip); console.log("ditulis", OUT, berkas.length, "berkas dalam allowlist; diff sha", sha(diff).slice(0, 12)); }
