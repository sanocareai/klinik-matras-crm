// Generator skrip rilis FRONTEND-SAJA "tab Marketing" (Laporan: Traffic + Akuisisi + Iklan → Marketing) — dari SUMBER GIT (git archive), TANPA overlay, TANPA backend/migrasi/image.
// Hasil: scripts/release-marketing-tab.sh — diturunkan dari scripts/release-gudang-pintu-masuk.sh (kerangka rilis frontend-saja release-directory yang sudah live) + blok di
// scripts/templates/release-marketing-tab/* + blok GERBANG KODE LIVE / verifikasi hotfix / hitung baris di scripts/templates/release-penjadwalan-langsung/*.
// Semua nilai yang bergantung pada commit (allowlist, daftar frontend/src) dihitung dari git terhadap --base.
//
//   node scripts/gen-release-marketing-tab.cjs --base <SHA_BASELINE_LIVE>          # bangkitkan ulang
//   node scripts/gen-release-marketing-tab.cjs --base <SHA_BASELINE_LIVE> --check  # exit 1 bila skrip tersimpan berbeda dari hasil bangkitan ulang
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-gudang-pintu-masuk.sh";
const OUT = "scripts/release-marketing-tab.sh";
const GENERATOR = "scripts/gen-release-marketing-tab.cjs";
const TPL = "scripts/templates/release-marketing-tab";
const TPL_P = "scripts/templates/release-penjadwalan-langsung";
const TPL_FILES = [`${TPL}/header.txt`, `${TPL}/fitur-dist.txt`, `${TPL}/container-baru.txt`, `${TPL}/build-only.txt`, `${TPL}/verifikasi-hotfix.txt`, `${TPL}/audit-frontend.txt`, `${TPL}/uji-logika.txt`, `${TPL}/smoke-marketing.txt`,
  `${TPL_P}/gerbang-kode-live.txt`, `${TPL_P}/hitung-pra.txt`, `${TPL_P}/hitung-pasca.txt`];
const FILE_TETAP = [OUT, GENERATOR, ...TPL_FILES];
const CAND_BRANCH = "feat/marketing-tab-terpadu";

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
const blokTeks = (b, n) => lf(b[n]).trimEnd();

function bangkitkan({ baseScript, blok, berkasList, audit }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); const j = s.indexOf(akhir, i + awal.length); must(i >= 0 && j >= 0, `penanda: ${awal.slice(0, 60)} .. ${akhir.slice(0, 60)}`); s = s.slice(0, i) + ganti + s.slice(j); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const fe = berkas.filter((f) => f.startsWith("frontend/src/")).join(" ");
  must(!berkas.some((f) => /^backend\//.test(f)), "rilis ini FRONTEND-SAJA: ada perubahan di backend/");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(["frontend/src/features/laporan/components/MarketingTab.jsx", "frontend/src/features/laporan/marketingLogic.js", "frontend/src/pages/Laporan.jsx", "frontend/tests/marketingLogic.test.js", "frontend/tests/marketingEkspor.test.js", "frontend/tests/marketingData.test.js"].every((f) => berkas.includes(f)), "berkas inti Marketing harus ada di diff");
  must(audit && /^[0-9a-f]{64}$/.test(audit.sidikJari) && audit.dihapus.length === 3, "audit diff frontend tidak lengkap (sidik jari / tepat tiga tab lama dihapus)");

  potong('# RILIS FRONTEND-SAJA "satu pintu masuk Gudang"', "set -Eeuo pipefail", blokTeks(blok, "header") + "\n");
  r('CAND_BRANCH="${CAND_BRANCH:-fix/gudang-pintu-masuk}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  r('CAND_REF="refs/remotes/origin/cand-gpm"', 'CAND_REF="refs/remotes/origin/cand-mkt"');
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `FRONTEND_SRC_EXPECT="${fe}"\nFRONTEND_DELETED_EXPECT="${audit.dihapus.join(" ")}"\nFRONTEND_DIFF_SHA="${audit.sidikJari}"`; s = L.join("\n");
  r('--preflight-only) MODE=preflight;; --rollback) MODE=rollback;;', '--preflight-only) MODE=preflight;; --build-only) MODE=buildonly;; --rollback) MODE=rollback;;');
  r('BK_DIR="$HOME/release-backups/gpm-${DEPLOY_SHORT}-${TS}"', 'BK_DIR="$HOME/release-backups/marketing-tab-${DEPLOY_SHORT}-${TS}"');
  r("/tmp/release-gudang-pintu-masuk.lock", "/tmp/release-marketing-tab.lock");
  r('grep -v "gpm\\|release-gudang-pintu-masuk\\|pgrep\\|node src/index.js"', 'grep -v "mkt\\|release-marketing-tab\\|pgrep\\|node src/index.js"');
  r("/tmp/gpm.sh", "/tmp/mkt.sh");

  // blok gerbang (dari templat rilis penjadwalan; nama kunci/skrip disesuaikan)
  const adapt = (t) => t.split("pjl\\|release-penjadwalan-langsung").join("mkt\\|release-marketing-tab").split("/tmp/release-penjadwalan-langsung.lock").join("/tmp/release-marketing-tab.lock");
  const gerbang = adapt(blokTeks(blok, "gerbang-kode-live"));
  const PH0 = 'PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"';
  r(PH0, gerbang + "\n\n" + PH0);
  const OK1 = 'ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT}); image ${IMG_NAME} (${PREV_IMG_ID:7:12}); .env sha ${ENV_SHA}"';
  r(OK1, OK1 + "\nPREV_STARTED=\"$(docker inspect -f '{{.State.StartedAt}}' \"$CID_OLD\")\"");
  r('[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHA:0:8}; produksi bergeser — berhenti"', "# marker TIDAK dipakai sebagai bukti identitas: gerbang_kode_live membandingkan ISI kode live dengan snapshot baseline");
  const OK2 = s.split("\n").find((l) => l.startsWith('ok "kandidat ${DEPLOY_SHORT} turunan baseline')); must(OK2, "penanda akhir fase 2");
  r(OK2, OK2 + "\n" + blokTeks(blok, "audit-frontend"));
  r('cek_disk "awal"', 'if [ "$MODE" = "preflight" ]; then if [ "$(bebas_kb)" -ge "$MIN_FREE_KB" ]; then ok "disk bebas $(( $(bebas_kb) / 1024 )) MiB >= 5 GiB (awal)"; else warn "disk bebas $(( $(bebas_kb) / 1024 )) MiB < 5 GiB — preflight (baca-saja) tetap berjalan; --build-only dan rilis penuh akan BERHENTI di gerbang ini sampai disk dibebaskan pemilik"; fi; else cek_disk "awal"; fi');
  r('[ "$(bebas_kb)" -ge $(( NM_KB * 2 + 2 * 1024 * 1024 )) ] || die "ruang disk kurang untuk salinan node_modules + build"', 'if [ "$(bebas_kb)" -ge $(( NM_KB * 2 + 2 * 1024 * 1024 )) ]; then :; elif [ "$MODE" = "preflight" ]; then warn "ruang disk belum cukup untuk salinan node_modules + build (butuh $(( (NM_KB * 2 + 2 * 1024 * 1024) / 1024 )) MiB, bebas $(( $(bebas_kb) / 1024 )) MiB) — build-only/rilis penuh akan berhenti"; else die "ruang disk kurang untuk salinan node_modules + build"; fi');
  r('ok "node_modules build dari ${NM_SRC}; ruang cukup"', 'ok "node_modules build dari ${NM_SRC}"');
  const OKD = 'ok "release dir dibuat; compose + seluruh backend/ identik dengan release aktif"';
  r(OKD, OKD + "\n" + blokTeks(blok, "uji-logika"));
  const OK3 = 'ok "health sehat; bundel publik = dist aktif (${PREV_INDEX}); tidak ada migrasi menggantung; hitungan data (migrasi|stok|MI|ST|koreksi|pesan) = ${FP_0}"';
  r(OK3, OK3 + '\ngerbang_kode_live "fase-3-audit"');
  potong("# Halaman lama HARUS ada di dist aktif", '\nPHASE="4c-aset-lama"', blokTeks(blok, "fitur-dist") + "\n");
  const ENVCHK = '[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah sebelum switch"';
  r(ENVCHK, ENVCHK + '\ngerbang_kode_live "fase-4c-pra-switch"\n' + blokTeks(blok, "hitung-pra") + "\n" + blokTeks(blok, "build-only"));
  const PH5 = 'PHASE="5-switch"; say "5. Switch (recreate backend dari release baru, image SAMA; SATU kali)"';
  r(PH5, PH5 + '\ntidak_ada_deploy_lain_lagi\ngerbang_kode_live "fase-5-tepat-sebelum-switch"');
  const OK6 = 'ok "publik 200; bundel web publik = dist baru ${NEW_INDEX}"';
  r(OK6, OK6 + "\n" + blokTeks(blok, "verifikasi-hotfix") + "\n" + blokTeks(blok, "container-baru") + "\n" + blokTeks(blok, "hitung-pasca"));
  const OKS = 'ok "smoke lulus: API Gudang tanpa token = 401 (backend hidup)"';
  r(OKS, 'for ep in /api/production/rencana/jadwal-batch /api/analytics/sales-report /api/inventory/adjustments/koreksi-saldo/bahan/x; do [ "$(curl -s -o /dev/null -w \'%{http_code}\' --max-time 15 "${PUBLIC_URL}${ep}")" = "401" ] || die "API ${ep} tanpa token harus 401"; done\n' + OKS.replace("API Gudang tanpa token = 401", "API Gudang, jadwal-batch, sales-report, koreksi saldo tanpa token = 401") + "\n" + blokTeks(blok, "smoke-marketing"));
  const iSel = s.indexOf('say "SELESAI — frontend'); must(iSel > 0, "SELESAI"); const jSel = s.indexOf("\n", iSel);
  s = s.slice(0, jSel + 1) + 'say "CATATAN: rilis FRONTEND-SAJA. Backend, image, migrasi, data, .env, campaign/budget/Meta TIDAK berubah; hotfix performa tetap ada. Rollback = baseline ${BASE_SHA:0:8} (image sama): bash /tmp/mkt.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback. Tidak ada folder release/image/backup/volume yang dihapus."\n' + s.slice(jSel + 1);
  { const sisa = s.split("\n").filter((l) => !l.startsWith("# (dibangkitkan") && !l.startsWith("ALLOWED_RE=")).filter((l) => /gpm|gudang-pintu-masuk|release-penjadwalan/.test(l) || l.includes("pjl\\|")); must(sisa.length === 0, "sisa nama rilis lain: " + sisa.map((l) => l.slice(0, 140)).join(" || ")); }
  must(!/rm -rf[^\n]*(RELEASES\b|PREV_DIR|backups|volume)/.test(s.replace('rm -rf -- "$NEW_DIR"', "")), "penghapusan di luar release dir sementara");
  s = lf(s);
  return { script: s, ringkasan: { berkas: berkas.length, frontendSrc: berkas.filter((f) => f.startsWith("frontend/src/")).length } };
}

function auditFrontend(base) {
  const diff = execFileSync("git", ["-c", "core.quotepath=false", "diff", "--no-renames", "--no-color", "--no-ext-diff", "--binary", "--full-index", base, "HEAD", "--", "frontend"], { cwd: REPO, maxBuffer: 512 * 1024 * 1024 });
  const status = gitLines(["-c", "core.quotepath=false", "diff", "--no-renames", "--name-status", base, "HEAD", "--", "frontend"]);
  const dihapus = status.filter((l) => l.startsWith("D\t")).map((l) => l.split("\t")[1]).sort();
  return { sidikJari: require("crypto").createHash("sha256").update(diff).digest("hex"), dihapus, berkas: status.length };
}

function berkasBerbeda(base) {
  let ref = base, belumGabung = false;
  try { execFileSync("git", ["merge-base", "--is-ancestor", base, "HEAD"], { cwd: REPO, stdio: "ignore" }); } catch { ref = gitLines(["merge-base", "HEAD", base])[0]; belumGabung = true; }
  const list = new Set([...gitLines(["diff", "--name-only", ref]), ...gitLines(["ls-files", "-o", "--exclude-standard"]).filter((f) => !/^backend\/(data|uploads)\//.test(f) && !/^frontend\/dist\//.test(f))]);
  return { list: [...list], ref, belumGabung };
}

function main() {
  const arg = process.argv.slice(2); const iBase = arg.indexOf("--base"); const base = iBase >= 0 ? arg[iBase + 1] : null; const cek = arg.includes("--check");
  must(base, "wajib --base <SHA_BASELINE_LIVE>");
  const { list, belumGabung } = berkasBerbeda(base);
  must(!belumGabung, `HEAD belum memuat ${base}: gabungkan baseline live terlebih dulu`);
  const blok = Object.fromEntries(TPL_FILES.map((f) => [path.basename(f, ".txt"), fs.readFileSync(path.join(REPO, f), "utf8")]));
  const hasil = bangkitkan({ baseScript: git(["show", `HEAD:${BASE_SCRIPT}`]), blok, berkasList: list, audit: auditFrontend(base) });
  const keluar = path.join(REPO, OUT);
  if (cek) {
    const ada = fs.existsSync(keluar) ? lf(fs.readFileSync(keluar, "utf8")) : "";
    if (ada !== hasil.script) { console.error("TIDAK SAMA: " + OUT + " berbeda dari hasil bangkitan ulang. Jalankan tanpa --check lalu commit."); process.exit(1); }
    console.log("SAMA: " + OUT + " identik dengan hasil bangkitan ulang (" + JSON.stringify(hasil.ringkasan) + ")");
    return;
  }
  fs.writeFileSync(keluar, hasil.script);
  console.log("ditulis", OUT, hasil.script.split("\n").length, "baris;", JSON.stringify(hasil.ringkasan));
}
module.exports = { bangkitkan };
if (require.main === module) main();
