// Generator skrip rilis bergerbang "Filter Order Produksi lengkap + Ringkasan" (WEB + BACKEND BACA-SAJA, TANPA migrasi dan TANPA perubahan schema.prisma). Diturunkan dari gen-release-laporan-produksi.cjs (kerangka rilis kode-saja bergerbang + penguncian bersama).
// Hasil: scripts/release-produksi-hpp.sh — diturunkan dari scripts/release-penjadwalan-langsung.sh (kerangka rilis kode-saja bergerbang yang SUDAH LIVE: gerbang identitas kode live, hotfix dipertahankan, tanpa pembersihan)
// + blok di scripts/templates/release-produksi-hpp/* + pustaka scripts/lib/{rehearsal,smoke}-produksi-filter.mjs. Semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend/frontend) dihitung dari git diff terhadap --base.
//
//   node scripts/gen-release-produksi-hpp.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-produksi-hpp.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-penjadwalan-langsung.sh";
const OUT = "scripts/release-produksi-hpp.sh";
const TPL_DIR = "scripts/templates/release-produksi-hpp";
const LIB_REH = "scripts/lib/rehearsal-produksi-hpp.mjs", LIB_SMOKE = "scripts/lib/smoke-produksi-hpp.mjs";
const GENERATOR = "scripts/gen-release-produksi-hpp.cjs";
const { terapkanKunci } = require("./lib/gen-kunci-produksi-hpp.cjs");
const LIB_KUNCI = "scripts/lib/gen-kunci-produksi-hpp.cjs";
const TPL_FILES = ["header", "rollback", "kunci", "uji-pra-switch", "fase0-kunci", "cek-ulang-kunci", "rehearsal-pra-switch", "fitur-css", "bandingkan-kode"].map((n) => `${TPL_DIR}/${n}.txt`);
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE, LIB_KUNCI, ...TPL_FILES];
const CAND_BRANCH = "feat/produksi-hpp-bahan-on-f13ce3b5";
// Teks ASCII di bundel web (esbuild menulis karakter non-ASCII sebagai \uXXXX, jadi hanya teks ASCII yang dicari).
// (hanya teks yang TIDAK ada di bundel release aktif: teks UI baru HPP pada pencatatan bahan)
const DIST_BARU = ["Total HPP operasional", "Harga Berlaku belum ada", "HPP operasional tercatat", "HPP muncul setelah jumlah diisi"];
// Fitur live sebelumnya yang tidak boleh hilang dari bundel: dibaca dari scripts/templates/release-produksi-ui/fitur-dist.txt (daftar s2) + 'Tambah pemakaian'.
const DIST_LIVE_TAMBAHAN = (() => { const t = fs.readFileSync(path.join(REPO, "scripts/templates/release-produksi-ui/fitur-dist.txt"), "utf8"); const m = t.match(/for s2 in ((?:"[^"]*"\s*)+); do/); if (!m) throw new Error("daftar s2 tidak ditemukan"); return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).concat(["Reset semua filter", "Tutup filter tanpa menerapkan", "Filter order produksi", "Semua status kerja", "Belum ada filter tambahan", "bukan bukti tahap kerja atau QC", "Cara filter digabung"]); })();

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

const COUNT_SQL = "select 'stock_movements', count(*) from stock_movements union all select 'biaya_beku', count(*) from stock_movement_biaya_operasional union all select 'harga_berlaku', count(*) from material_harga_berlaku union all select 'material_issues', count(*) from material_issues union all select 'jurnal', count(*) from fin_journal_entries union all select 'baris_jurnal', count(*) from fin_journal_lines union all select 'units', count(*) from units union all select 'order', count(*) from \\\"Order\\\" union all select 'jobs', count(*) from jobs union all select 'pernyataan', count(*) from unit_material_declarations union all select 'runs_v2', count(*) from production_runs_v2 union all select 'jadwal', count(*) from production_unit_schedules union all select 'custody', count(*) from unit_custody_handoffs_v2 union all select 'status_kerja', count(*) from production_unit_work_progress";

const UJI_PENANDA = "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): ";

function bangkitkan({ baseScript, blok, berkasList, rehNode, smokeNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); const j = s.indexOf(akhir, i + awal.length); must(i >= 0 && j >= 0, `penanda: ${awal.slice(0, 60)} .. ${akhir.slice(0, 60)}`); s = s.slice(0, i) + ganti + s.slice(j); };
  const gantiBaris = (awalan, baru) => { const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith(awalan)); must(i >= 0, "baris berawalan: " + awalan.slice(0, 70)); L[i] = baru; s = L.join("\n"); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  const fe = berkas.filter((f) => f.startsWith("frontend/src/")).join(" ");
  must(!berkas.some((f) => /^backend\/prisma\//.test(f)), "rilis ini TANPA migrasi/schema: ada perubahan backend/prisma");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.includes("backend/src/index.js"), "index.js berubah (dipatok tes atribusi)");
  for (const wajib of ["backend/src/services/productionAdoptionService.js", "backend/src/routes/productionAdopsi.js", "backend/src/services/finance/hargaBerlaku.js", "frontend/src/features/production/bahan/CatatBahanBaru.jsx", "frontend/src/features/production/bahan/PemilihBahanKatalog.jsx", "frontend/src/features/production/bahan/bahanModel.js", "frontend/src/features/production/bahan/bahan.css"]) must(berkas.includes(wajib), "berkas inti harus ada di diff: " + wajib);
  must(!berkas.some((f) => /^backend\/src\/(routes\/(analytics|conversations)|middleware\/cacheSingkat)\.js$|^frontend\/src\/pages\/Laporan\.jsx$/.test(f)), "rilis ini tidak boleh menyentuh berkas hotfix performa");

  potong("# RILIS \"PENJADWALAN LANGSUNG", "set -Eeuo pipefail", lf(blok.header));
  r('CAND_BRANCH="${CAND_BRANCH:-feat/rencana-penjadwalan-langsung-on-hotfix}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`;
  s = L.join("\n");
  // nama kunci/backup/tag/DB sementara khusus rilis ini
  r("penjadwalan-langsung-${DEPLOY_SHORT}-${TS}", "produksi-hpp-${DEPLOY_SHORT}-${TS}"); /* termasuk nama backup: pre-komplain-redesign-... */ r("rollback-pre-pjl-", "rollback-pre-hpb-"); r("rehearsal_pjl_", "rehearsal_hpb_");
  r("/tmp/release-penjadwalan-langsung.lock", "/tmp/release-produksi-hpp.lock"); r("pjl\\|release-penjadwalan-langsung\\|pgrep", "hpb\\|release-produksi-hpp\\|pgrep");
  // blok rollback
  { const i = s.indexOf("Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya"); const j = s.indexOf("\nEOF\n", i); must(i >= 0 && j > i, "blok rollback"); const k = s.lastIndexOf("\n", j - 1) + 1; s = s.slice(0, i) + lf(blok.rollback).trimEnd() + "\n" + s.slice(k); }
  // teks fitur di bundel web: fitur rilis ini + fitur live sebelumnya (jangan sampai hilang)
  { const L2 = s.split("\n"); const i = L2.findIndex((l) => l.startsWith('for s1 in "Pilih meja"')); must(i >= 0, "baris s1");
    L2[i] = `for s1 in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: \${s1}"; [ -z "$(grep -lF -- "$s1" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks fitur baru '\${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done`;
    s = L2.join("\n"); }
  r('for s2 in "Tambah pemakaian"', `for s2 in ${DIST_LIVE_TAMBAHAN.map((x) => `"${x}"`).join(" ")} "Tambah pemakaian"`);
  // CSS: aturan baru ADA di dist baru dan BELUM di dist aktif; aturan live (Finance/Produksi/CRM) harus ada di KEDUANYA
  { const css = lf(blok["fitur-css"]).trimEnd(); const k = s.indexOf('for s2 in '); const e = s.indexOf("\n", s.indexOf("done", k) > 0 ? s.indexOf("done", k) : k) + 1; must(k > 0 && e > k, "sisip CSS"); s = s.slice(0, e) + css + "\n" + s.slice(e); }
  // rehearsal: kode baru sebagai server terhadap salinan restore; direktori data/uploads production TIDAK dipasang (sudah ada di kerangka)
  gantiBaris(UJI_PENANDA, UJI_PENANDA + "HPP pencatatan bahan: katalog membawa Harga Berlaku = tabel hanya untuk peran berizin, bahan tanpa harga = null, baris pemakaian membawa HPP beku = tabel biaya operasional, waktu respons, tanpa jejak tulis (tanpa data uji).");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).replace('"@@SMOKE_SRC@@"', () => JSON.stringify(lf(smokeNode))).trimEnd() + s.slice(j); }
  r("uji penjadwalan langsung terhadap salinan restore GAGAL", "uji HPP pencatatan bahan terhadap salinan restore GAGAL");
  r("uji tulis Edit pemakaian dilakukan HANYA pada salinan restore", "smoke dan ukur waktu HPP pencatatan bahan (hanya GET) dijalankan pada salinan restore");
  // smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke test baca-saja: HPP pencatatan bahan (harga katalog = tabel Harga Berlaku, bahan tanpa harga = null, HPP beku = tabel biaya operasional, peran tanpa izin tanpa nominal, izin 401); stok, biaya beku, harga, jurnal, unit, pernyataan, run identik"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (HPP pencatatan bahan: invarian atas data nyata, izin, tanpa jejak tulis)"');
  // hitung baris pra/pasca switch
  gantiBaris('COUNT_SQL="', `COUNT_SQL="${COUNT_SQL}"`);
  r("hitung baris jadwal/Run/stok/pemakaian/harga/jurnal", "hitung baris stok/biaya beku/harga/Material Issue/jurnal/unit/order/job/pernyataan/run/jadwal/custody/status kerja");
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa HPP pada pencatatan bahan Produksi (Harga Berlaku per bahan + total HPP; peran berizin saja) + penguncian deploy bersama. Backend BACA-SAJA, TANPA migrasi, TANPA data baru. Tidak ada transaksi uji di produksi."');
  // Perbandingan kode container vs folder: image live dibangun SEBELUM dua berkas tes pemeriksa kontrak metrik ada; hanya dua jalur persis itu yang boleh berbeda (lihat templat bandingkan-kode)
  { const CMP = 'cmp -s "$BK_DIR/container-sha.txt" "$BK_DIR/dir-sha.txt"'; must(s.split(CMP).length === 2, "perbandingan container-vs-folder pada gerbang kode live"); s = s.replace(CMP, () => 'bandingkan_kode "$BK_DIR/container-sha.txt" "$BK_DIR/dir-sha.txt"');
    const FN = "gerbang_kode_live() {"; must(s.split(FN).length === 2, "definisi gerbang_kode_live"); s = s.replace(FN, () => lf(blok["bandingkan-kode"]).trimEnd() + "\n" + FN); }
  s = terapkanKunci(s, blok);
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  const sisa = s.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !l.startsWith("#") && /penjadwalan|jadwal-batch|\bpjl\b|reh-pjl/i.test(l) && !/jadwal\/Run|production_unit_schedule/.test(l)).map(([i]) => i);
  s = lf(s);
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: berkas.filter((f) => f.startsWith("backend/src/")).length, frontendSrc: berkas.filter((f) => f.startsWith("frontend/src/")).length, barisSisaPenjadwalan: sisa.length } };
}

function berkasBerbeda(base) {
  let ref = base, belumGabung = false;
  try { execFileSync("git", ["merge-base", "--is-ancestor", base, "HEAD"], { cwd: REPO, stdio: "ignore" }); } catch { ref = gitLines(["merge-base", "HEAD", base])[0]; belumGabung = true; }
  const list = new Set([...gitLines(["diff", "--name-only", ref]), ...gitLines(["ls-files", "-o", "--exclude-standard"]).filter((f) => !/^backend\/(data|uploads)\//.test(f))]);
  return { list: [...list], ref, belumGabung };
}

function main() {
  const arg = process.argv.slice(2); const iBase = arg.indexOf("--base"); const base = iBase >= 0 ? arg[iBase + 1] : "origin/main"; const cek = arg.includes("--check");
  const { list, belumGabung } = berkasBerbeda(base);
  must(!belumGabung, `HEAD belum memuat ${base}: gabungkan baseline live terlebih dulu`);
  const blok = Object.fromEntries(TPL_FILES.map((f) => [path.basename(f, ".txt"), fs.readFileSync(path.join(REPO, f), "utf8")]));
  const hasil = bangkitkan({ baseScript: git(["show", `${base}:${BASE_SCRIPT}`]), blok, berkasList: list, rehNode: fs.readFileSync(path.join(REPO, LIB_REH), "utf8"), smokeNode: fs.readFileSync(path.join(REPO, LIB_SMOKE), "utf8") });
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
