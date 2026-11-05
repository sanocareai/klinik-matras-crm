// Generator skrip rilis bergerbang "Laporan Marketing lengkap" (WEB + BACKEND ADITIF, TANPA migrasi dan TANPA perubahan schema.prisma).
// Diturunkan dari scripts/release-pengaman-historis.sh pada BASE (= release aktif; kerangka SUDAH LIVE: gerbang identitas kode live, penguncian bersama berbasis kepemilikan proses, backup + rehearsal restore, switch satu kali, smoke, tanpa pembersihan).
//
//   node scripts/gen-release-marketing-lengkap.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-marketing-lengkap.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// Allowlist = berkas yang berbeda dari base (git diff) + berkas tetap rilis ini. Skrip rilis menolak berkas di luar allowlist. WAJIB dibangkitkan ulang dari commit FINAL.
// Perbedaan penting terhadap kerangka dasar (diperiksa oleh tes releaseMarketingLengkap.test.js):
//   • pencarian teks di dist release AKTIF memakai find|xargs (cari_dist), BUKAN glob `assets/*.js`: dist aktif sudah memuat >21.000 chunk akumulasi (≈1,94 MB nama berkas) sehingga glob melampaui ARG_MAX (2.097.152) dan gagal diam-diam;
//   • bukti build ditulis ke $BK_DIR/bukti-build.txt (hash index.html, entry, jumlah chunk, teks fitur baru dan lokasinya);
//   • smoke/rehearsal = invarian laporan (scripts/lib/invarian-marketing-lengkap.mjs) + SQL independen; hanya GET.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-pengaman-historis.sh";
const OUT = "scripts/release-marketing-lengkap.sh";
const GENERATOR = "scripts/gen-release-marketing-lengkap.cjs";
const LIB_REH = "scripts/lib/rehearsal-marketing-lengkap.mjs", LIB_SMOKE = "scripts/lib/smoke-marketing-lengkap.mjs", LIB_INV = "scripts/lib/invarian-marketing-lengkap.mjs";
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE, LIB_INV];
const CAND_BRANCH = "feat/laporan-marketing-lengkap-on-5cd1a5fa";
// Teks ASCII baru di bundel web (esbuild menulis non-ASCII sebagai \uXXXX): HANYA teks yang TIDAK ada di bundel release aktif.
const DIST_BARU = ["Prospek eksplisit", "Prospek atau lanjut", "Biaya / prospek eksplisit"];
// Teks fitur yang SUDAH live pada baseline (rilis pengaman-historis): tidak boleh hilang dari bundel baru.
const DIST_LIVE_TAMBAHAN = ["Rincian verifikasi nol"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

const COUNT_SQL = "select 'customer', count(*) from \\\"Customer\\\" union all select 'order', count(*) from \\\"Order\\\" union all select 'payments', count(*) from payments union all select 'kredit_order', count(*) from fin_order_credits union all select 'refund', count(*) from fin_refunds union all select 'transisi', count(*) from pipeline_transitions union all select 'touch', count(*) from attribution_touches union all select 'spend_ad', count(*) from meta_ad_daily_spend union all select 'impor_spend', count(*) from meta_spend_imports union all select 'biaya_sumber', count(*) from ad_source_spend_entries union all select 'biaya_sumber_revisi', count(*) from ad_source_spend_revisions union all select 'jurnal', count(*) from fin_journal_entries union all select 'stock_movements', count(*) from stock_movements";

const HEADER = `# RILIS "LAPORAN MARKETING LENGKAP" (Laporan › Marketing): WEB + BACKEND ADITIF, TANPA migrasi dan TANPA perubahan schema.prisma — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • ISI: Google Ads menjadi sumber SENDIRI (sebelumnya dilebur ke "Lainnya"); PROSPEK EKSPLISIT (keputusan manual sales: pernah dipindah ke PROSPECT) = metrik utama dan penyebut "Biaya / prospek eksplisit";
#     "Prospek atau lanjut" (definisi lama) tetap sebagai rincian berlabel sendiri; 7 kolom ekspor baru DI AKHIR (CSV 22 / XLSX 19 kolom lama utuh); kunci respons /api/atribusi/iklan/sumber hanya BERTAMBAH (+prospek, +costPerProspekEksplisit).
#   • TIDAK mengubah: Finance/ledger, atribusi, importer spend, klasifikasi prospek manual, histori/stage, skema, rute lain; pengaman data parsial (biaya/CPA/ROAS kosong bila biaya belum lengkap atau hari berjalan parsial) dipertahankan.
#   • TIDAK ada jalur tulis baru: rilis ini TIDAK memasukkan biaya, TIDAK mengaktifkan job/scheduler, TIDAK backfill spend. Uji rehearsal dan smoke hanya GET.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore; invarian laporan + SQL independen pada 4 rentang; hitungan tabel inti identik); build web di release dir (bukti build dicatat);
#     switch SATU kali; verifikasi; smoke pasca-switch (kode smoke yang sama dengan rehearsal; GET saja).
#   • PENGUNCIAN: kunci deploy BERSAMA + kunci sendiri diambil ATOMIK; kepemilikan ditentukan proses (perangkat:inode fd 7/9), BUKAN nama berkas. GERBANG IDENTITAS KODE LIVE (hash blob semua berkas terlacak baseline) di fase 2, 6, dan TEPAT sebelum switch.
#     Pembersihan release lama DINONAKTIFKAN; gerbang disk minimal 5 GiB tidak diturunkan.
#   • PENCARIAN TEKS DI DIST AKTIF memakai find|xargs (cari_dist), bukan glob: dist aktif memuat >21.000 chunk sehingga glob melampaui ARG_MAX.
#
#   cat scripts/release-marketing-lengkap.sh | tr -d '\\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/mkl.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/mkl.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/mkl.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/mklr.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/mkl.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/mkl.out 2>&1 < /dev/null &'   # rilis penuh
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru, tanpa tulisan data bisnis). Rollback mengembalikan kode lama: Google Ads kembali dilebur ke "Lainnya", metrik prospek hilang dari laporan sumber, kolom ekspor baru hilang. Tidak ada data yang berubah.
# (dibangkitkan oleh scripts/gen-release-marketing-lengkap.cjs dari scripts/release-pengaman-historis.sh + pustaka scripts/lib/{rehearsal,smoke,invarian}-marketing-lengkap.mjs; JANGAN edit tangan — ubah generator lalu bangkitkan ulang)
`;

const CARI_DIST = `# Cari teks (tetap, bukan regex) di dist: cetak nama berkas PERTAMA yang memuat teks, kosong bila tidak ada. Memakai find|xargs (bukan glob): dist release aktif memuat >21.000 chunk (≈1,94 MB nama berkas) sehingga
# glob "assets/*.js" melampaui ARG_MAX dan grep GAGAL diam-diam (dianggap "tidak ada"). $1 = folder release, $2 = js|css, $3 = teks.
cari_dist() { find "$1/frontend/dist/assets" -maxdepth 1 -type f -name "*.$2" -print0 2>/dev/null | xargs -0 grep -lF -- "$3" 2>/dev/null | sed -n 1p; }
`;

function bangkitkan({ baseScript, berkasList, rehNode, smokeNode, invNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const gantiBaris = (awalan, baru) => { const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith(awalan)); must(i >= 0, "baris berawalan: " + awalan.slice(0, 70)); L[i] = baru; s = L.join("\n"); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  const fe = berkas.filter((f) => f.startsWith("frontend/src/")).join(" ");
  must(!berkas.some((f) => /^backend\/prisma\//.test(f)), "rilis ini TANPA migrasi/schema: ada perubahan backend/prisma");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  for (const wajib of ["backend/src/services/attribution/sumber.js", "backend/src/services/attribution/biayaSumber.js", "frontend/src/features/laporan/marketingLogic.js", "frontend/src/features/laporan/akuisisiLogic.js", "frontend/src/utils/marketingXlsx.js", "frontend/src/features/laporan/components/marketing/TabelSumber.jsx"]) must(berkas.includes(wajib), "berkas inti harus ada di diff: " + wajib);
  must(!berkas.some((f) => /^backend\/src\/(routes\/(analytics|conversations|attributionAds|attributionSpend|attributionBiayaSumber)|middleware\/cacheSingkat|index)\.js$|^frontend\/src\/pages\/Laporan\.jsx$/.test(f)), "rilis ini tidak boleh menyentuh rute, index.js, maupun berkas hotfix performa");
  must(!berkas.some((f) => /^backend\/src\/services\/(attribution\/(cohort|cohortLoader|cohortDefinitions|biayaKpi|spend|iklanReport|d7)|finance\/|inventoryLedger|postingStock)/.test(f)), "rilis ini tidak boleh menyentuh kohort, KPI biaya, importer spend, Finance, atau jalur ledger");

  { const i = s.indexOf('# RILIS "PENGAMAN POSTING HISTORIS PASCA-SO + LABEL NOL"'); const j = s.indexOf("set -Eeuo pipefail", i); must(i >= 0 && j > i, "header"); s = s.slice(0, i) + lf(HEADER) + s.slice(j); }
  r("feat/pengaman-historis-pasca-so", CAND_BRANCH);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`; s = L.join("\n");
  // nama kunci/backup/tag/DB sementara khusus rilis ini
  r("release-pengaman-historis.lock", "release-marketing-lengkap.lock"); r("pengaman-historis-${DEPLOY_SHORT}", "marketing-lengkap-${DEPLOY_SHORT}"); r("rollback-pre-pph-", "rollback-pre-mkl-"); r("rehearsal_pph_", "rehearsal_mkl_");
  // blok rollback
  r("Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama tidak punya pengaman posting historis (rute /api/production/posting-historis/pengaman) dan label nol lama kembali.", "Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama: Google Ads kembali dilebur ke \"Lainnya\", metrik prospek tidak ada di laporan sumber, kolom ekspor baru hilang.");
  r("Tautan dan pernyataan yang dibuat SELAMA rilis ini aktif tetap ada sebagai peristiwa aktivitas (append-only): rollback tidak menghapus atau membalik apa pun, tetapi pengaman TIDAK berlaku lagi — jangan memposting pemakaian historis sebelum kode ini dipulihkan. Tidak ada ledger/harga/jurnal yang berubah karenanya.", "Rilis ini tidak menulis data bisnis apa pun: tidak ada yang perlu dibalik selain kode. Rollback tidak menghapus atau mengubah data.");
  r("Stok, harga, biaya beku, jurnal, PSA, GR, unit, dan pengaturan Finance tidak disentuh oleh skrip rilis maupun oleh fitur ini: tidak ada yang perlu dibalik oleh rollback.", "Customer, order, pembayaran, refund, transisi, touch, spend, biaya sumber, jurnal, dan stok tidak disentuh oleh skrip rilis maupun oleh fitur ini: tidak ada yang perlu dibalik oleh rollback.");
  // helper cari_dist (find|xargs) — disisipkan sebelum say()
  r("say()  { printf", lf(CARI_DIST) + "say()  { printf");
  // semua pencarian teks di dist (js/css; dist aktif DAN dist baru) -> cari_dist
  { const re = /\$\(grep -lF(?: --)? ("[^"]*") "(\$(?:PREV_DIR|NEW_DIR))"\/frontend\/dist\/assets\/\*\.(js|css) 2>\/dev\/null \| sed -n 1p\)/g; let n = 0; s = s.replace(re, (_m, v, d, e) => { n++; return `$(cari_dist "${d}" ${e} ${v})`; }); must(n >= 8, "pola grep dist tidak ditemukan cukup (" + n + ")"); }
  must(!/\/frontend\/dist\/assets\/\*\.(js|css)/.test(s), "masih ada glob assets/*.js|css yang dieksekusi lewat grep");
  // teks fitur di bundel web: fitur rilis ini BARU; fitur yang sudah live harus tetap ada
  { const L2 = s.split("\n"); const i = L2.findIndex((l) => l.startsWith('for s1 in "Rincian verifikasi nol"')); must(i >= 0, "baris s1");
    L2[i] = `for s1 in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do [ -n "$(cari_dist "$NEW_DIR" js "$s1")" ] || die "dist baru tidak memuat teks fitur: \${s1}"; [ -z "$(cari_dist "$PREV_DIR" js "$s1")" ] || die "[skrip] teks fitur baru '\${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done`; s = L2.join("\n"); }
  r('for s2 in "Rincian bukti Finance"', `for s2 in ${DIST_LIVE_TAMBAHAN.map((x) => `"${x}"`).join(" ")} "Rincian bukti Finance"`);
  // fitur-fitur live harus ada juga di dist AKTIF (bila tidak, daftar pembanding usang) — dibuktikan pada rehearsal; bukti build:
  r('ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + teks fitur lama ada"',
    'ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + teks fitur lama ada"\n' +
    '{ echo "BUKTI BUILD ${DEPLOY_SHORT} (baseline ${BASE_SHA:0:8}) $(date -u +%FT%TZ)"; echo "index.html sha256=$(sha256sum "$NEW_DIR/frontend/dist/index.html" | cut -d\' \' -f1)"; echo "entry ${NEW_INDEX} sha256=$(sha256sum "$NEW_DIR/frontend/dist/assets/${NEW_INDEX}" | cut -d\' \' -f1) (dist lama: ${PREV_INDEX})";\n' +
    '  echo "chunk js baru=$(find "$NEW_DIR/frontend/dist/assets" -maxdepth 1 -type f -name \'*.js\' | wc -l) css=$(find "$NEW_DIR/frontend/dist/assets" -maxdepth 1 -type f -name \'*.css\' | wc -l); chunk js dist aktif=$(find "$PREV_DIR/frontend/dist/assets" -maxdepth 1 -type f -name \'*.js\' | wc -l)";\n' +
    `  for t in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do echo "teks baru '$t' ada di: $(cari_dist "$NEW_DIR" js "$t") | di dist aktif: $(cari_dist "$PREV_DIR" js "$t" | sed 's/^$/(tidak ada)/')"; done;\n` +
    '  echo "lokasi diff terhadap baseline: $(sg diff --stat "$BASE_SHA" "$DEPLOY_SHA" | tail -n 1)"; } > "$BK_DIR/bukti-build.txt"; cat "$BK_DIR/bukti-build.txt"');
  // CSS: rilis ini TIDAK menambah aturan CSS (kelas .nip-* sudah live) — blok dasar dipertahankan apa adanya
  // rehearsal: kode baru sebagai server terhadap salinan restore
  const smokeGabung = lf(invNode).replace(/^export /gm, "") + "\n" + lf(smokeNode);
  gantiBaris("# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): ", "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): laporan Marketing (/api/atribusi/iklan/sumber): invarian antar-angka + SQL independen pada 4 rentang; TIDAK ada uji tulis (rilis tanpa jalur tulis); hitungan tabel inti identik");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).replace('"@@SMOKE_SRC@@"', () => JSON.stringify(smokeGabung)).replace('"@@INVARIAN_SRC@@"', () => JSON.stringify(lf(invNode))).trimEnd() + s.slice(j); }
  r("uji pengaman posting historis terhadap salinan restore GAGAL", "uji laporan Marketing terhadap salinan restore GAGAL");
  r("uji tulis tautan/pernyataan dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca dan dihitung", "TIDAK ada uji tulis (rilis tanpa jalur tulis); seluruh uji = GET pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca");
  // smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + smokeGabung.trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke baca-saja: laporan Marketing (GET /api/atribusi/iklan/sumber): invarian antar-angka, SQL independen, pengaman biaya, TANPA perubahan data"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (laporan Marketing: invarian + SQL independen; tanpa jejak tulis)"');
  gantiBaris('COUNT_SQL="', `COUNT_SQL="${COUNT_SQL}"`);
  r("hitung baris stok/biaya beku/harga/Material Issue/jurnal/unit/order/job/pernyataan/run/jadwal/custody/status kerja", "hitung baris customer/order/payments/kredit/refund/transisi/touch/spend/biaya sumber/jurnal/stok");
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa laporan Marketing lengkap (Google Ads sumber sendiri, prospek eksplisit sebagai metrik utama, biaya per prospek eksplisit, 7 kolom ekspor baru di akhir). TIDAK ada tulisan data bisnis, TIDAK ada biaya yang dimasukkan, TIDAK ada job/scheduler yang diaktifkan, TIDAK ada backfill spend. Biaya/CPA/ROAS tetap kosong bila biaya belum lengkap (spend Meta berhenti 16 Okt sampai dipulihkan lewat keputusan terpisah)."');
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  const sisa = s.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !l.includes("dibangkitkan oleh scripts/gen-release-marketing-lengkap") && /pengaman-historis|\bpph\b|reh-pph|posting-historis|pernyataan_historis|unit_usage_notes|Nilai Persediaan|hasil_so/i.test(l)).map(([i]) => i);
  must(sisa.length === 0, "nama/isi rilis lama tersisa pada baris: " + sisa.join(","));
  return { script: lf(s), ringkasan: { berkas: berkas.length, backendSrc: berkas.filter((f) => f.startsWith("backend/src/")).length, frontendSrc: berkas.filter((f) => f.startsWith("frontend/src/")).length } };
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
  const hasil = bangkitkan({ baseScript: git(["show", `${base}:${BASE_SCRIPT}`]), berkasList: list, rehNode: fs.readFileSync(path.join(REPO, LIB_REH), "utf8"), smokeNode: fs.readFileSync(path.join(REPO, LIB_SMOKE), "utf8"), invNode: fs.readFileSync(path.join(REPO, LIB_INV), "utf8") });
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
module.exports = { bangkitkan, DIST_BARU, DIST_LIVE_TAMBAHAN, COUNT_SQL };
if (require.main === module) main();
