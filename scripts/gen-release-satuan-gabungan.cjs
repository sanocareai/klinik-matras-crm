// Generator skrip rilis bergerbang KANDIDAT GABUNGAN "Satuan bahan: pembaca + biaya + koreksi + drawer" (WEB + BACKEND ADITIF, TANPA migrasi dan TANPA perubahan schema.prisma).
// Diturunkan dari scripts/release-produksi-stok-minus.sh pada BASE (= release aktif ATAU ancestor-nya yang memuat skrip itu; kerangka rilis web+backend bergerbang yang SUDAH LIVE: gerbang identitas kode live,
// penguncian bersama berbasis kepemilikan proses, backup + rehearsal restore, build web, switch satu kali, smoke, tanpa pembersihan). Daftar dist dan rehearsal/smoke DIGANTI dengan yang khusus rilis ini.
//
//   node scripts/gen-release-satuan-gabungan.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-satuan-gabungan.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// Allowlist = berkas yang berbeda dari base (git diff) + berkas tetap rilis ini. Skrip rilis menolak berkas di luar allowlist. WAJIB dibangkitkan ulang dari commit FINAL.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-produksi-stok-minus.sh";
const OUT = "scripts/release-satuan-gabungan.sh";
const TPL_DIR = "scripts/templates/release-satuan-gabungan";
const LIB_REH = "scripts/lib/rehearsal-satuan-gabungan.mjs", LIB_SMOKE = "scripts/lib/smoke-satuan-gabungan.mjs";
const GENERATOR = "scripts/gen-release-satuan-gabungan.cjs";
const TPL_FILES = ["header", "rollback", "fitur-dist"].map((n) => `${TPL_DIR}/${n}.txt`);
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE, ...TPL_FILES];
const CAND_BRANCH = "feat/satuan-pembaca-drawer-gabungan-on-e45e35f4";

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
const UJI_PENANDA = "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): ";

function bangkitkan({ baseScript, blok, berkasList, rehNode, smokeNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const gantiBaris = (awalan, baru) => { const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith(awalan)); must(i >= 0, "baris berawalan: " + awalan.slice(0, 70)); L[i] = baru; s = L.join("\n"); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  const fe = berkas.filter((f) => f.startsWith("frontend/src/")).join(" ");
  must(!berkas.some((f) => /^backend\/prisma\//.test(f)), "rilis ini TANPA migrasi/schema: ada perubahan backend/prisma");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.includes("backend/src/index.js"), "index.js berubah (dipatok tes atribusi)");
  for (const wajib of ["backend/src/services/referensiHargaSatuan.js", "backend/src/services/catatanPemakaianHistoris.js", "backend/src/services/koreksiPemakaian.js", "backend/src/services/finance/posting/inventory.js", "backend/src/services/inventoryLedger.js", "backend/src/services/transisiSatuanBahan.js", "backend/src/services/selisihTransfer.js", "frontend/src/features/warehouse/components/ItemDetailDrawer.jsx"]) must(berkas.includes(wajib), "berkas wajib rilis tidak berbeda dari baseline: " + wajib);
  must(!berkas.some((f) => /^backend\/src\/(routes\/(analytics|conversations)|middleware\/cacheSingkat)\.js$|^frontend\/src\/pages\/Laporan\.jsx$/.test(f)), "rilis ini tidak boleh menyentuh berkas hotfix performa");

  { const i = s.indexOf('# RILIS "PENGECUALIAN STOK TIDAK CUKUP'); const j = s.indexOf("set -Eeuo pipefail", i); must(i >= 0 && j > i, "header"); s = s.slice(0, i) + lf(blok.header) + s.slice(j); }
  r('CAND_BRANCH="${CAND_BRANCH:-feat/produksi-historis-stok-minus-on-04c620e1}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`;
  s = L.join("\n");
  // nama kunci/backup/tag/DB sementara khusus rilis ini (urutan penting: pola grep proses dulu)
  r("release-produksi-stok-minus", "release-satuan-gabungan"); r("produksi-stok-minus-${DEPLOY_SHORT}", "satuan-gabungan-${DEPLOY_SHORT}"); r("rollback-pre-psm-", "rollback-pre-sgb-"); r("rehearsal_psm_", "rehearsal_sgb_");
  // blok rollback
  { const i = s.indexOf("Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya"); const j = s.indexOf("\nEOF\n", i); must(i >= 0 && j > i, "blok rollback"); const k = s.lastIndexOf("\n", j - 1) + 1; s = s.slice(0, i) + lf(blok.rollback).trimEnd() + "\n" + s.slice(k); }
  // dist: ganti SELURUH blok pemeriksaan fitur (psm memakai glob yang gagal pada dist aktif >21.000 chunk) dengan cari_dist
  { const a = s.indexOf("# Fitur rilis ini + fitur rilis sebelumnya (jangan sampai hilang dari bundel)."); const b0 = s.indexOf("# (pemeriksaan negatif 'Hitung Kas' dari rilis lama tidak relevan untuk rilis ini)"); must(a > 0 && b0 > a, "blok fitur dist");
    const b = s.indexOf("\n", b0) + 1; s = s.slice(0, a) + lf(blok["fitur-dist"]).trimEnd() + "\n" + s.slice(b); }
  must(!/grep -lF[^\n]*"\$(PREV_DIR|NEW_DIR)"\/frontend\/dist\/assets\/\*\.(js|css)/.test(s.replace(/\[ -n "\$\(grep -lF "\$MAPS_KEY" "\$NEW_DIR"\/frontend\/dist\/assets\/\*\.js[^\n]*\n/, "")), "masih ada glob dist yang rawan ARG_MAX");
  // rehearsal: kode baru sebagai server terhadap salinan restore
  gantiBaris(UJI_PENANDA, UJI_PENANDA + "kandidat gabungan: transisi satuan pada DATA NYATA salinan restore lalu uji pembaca (satuan asal), referensi Agustus, harga rata-rata (null/gap), koreksi penambahan tanpa tanggal, transfer, catatan historis; UJI TULIS HANYA pada salinan restore (DB rehearsal_*, dibuang); production tidak disentuh.");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).replace('"@@SMOKE_SRC@@"', () => JSON.stringify(lf(smokeNode))).trimEnd() + s.slice(j); }
  r("uji pengecualian stok tidak cukup terhadap salinan restore GAGAL", "uji kandidat gabungan terhadap salinan restore GAGAL");
  r("uji tulis pengecualian stok dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca dan dihitung (pratinjau)", "uji tulis (transisi + uji pembaca/biaya/koreksi) dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca dan dihitung (pratinjau)");
  // smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke baca-saja: referensi Agustus per satuan (null + penanda hanya untuk bahan bertransisi), satuan saat dicatat pada pergerakan, pengaman pra-SO pada pratinjau (tanggal SO ditahan, sesudah SO dan pengurangan tidak), laporan Nilai Persediaan, detail transfer — TANPA perubahan data"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (kandidat gabungan: referensi per satuan, satuan saat dicatat, pra-SO pratinjau, tanpa jejak tulis)"');
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa perbaikan pembaca/biaya/koreksi satuan bahan (backend) dan drawer Stok (web). TIDAK ada migrasi, TIDAK ada tulisan data bisnis, TIDAK ada transisi satuan. Transisi production tetap menunggu keputusan Owner dengan pratinjau dan hash baru. Rollback = baseline ${BASE_SHA:0:8} (image rollback ${ROLLBACK_TAG:-<tag>}); bila sudah ada transisi tersimpan, pakai scripts/rollback-guard-transisi-satuan.sh."');
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  const sisa = s.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !l.startsWith("#") && /stok-minus|\bpsm\b|reh-psm|penjadwalan|jadwal-batch|\bpjl\b|pengecualian stok tidak cukup/i.test(l) && !/jadwal\/Run|production_unit_schedule|hitung baris stok/.test(l)).map(([i]) => i);
  must(sisa.length === 0, "nama/isi rilis lain tersisa pada baris: " + sisa.join(","));
  s = lf(s);
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: berkas.filter((f) => f.startsWith("backend/src/")).length, frontendSrc: berkas.filter((f) => f.startsWith("frontend/src/")).length } };
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
