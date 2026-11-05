// Generator skrip rilis bergerbang "Nilai Persediaan: pemisahan nol Owner / cakupan kuantitas vs harga / sumber dokumen harga" (WEB + BACKEND ADITIF, TANPA migrasi dan TANPA perubahan schema.prisma).
// Diturunkan dari scripts/release-marketing-lengkap.sh pada BASE (= release aktif; kerangka SUDAH LIVE: gerbang identitas kode live, penguncian bersama berbasis kepemilikan proses, backup + rehearsal restore, switch satu kali, smoke, tanpa pembersihan).
//
//   node scripts/gen-release-nilai-pisah.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-nilai-pisah.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// Allowlist = berkas yang berbeda dari base (git diff) + berkas tetap rilis ini. Skrip rilis menolak berkas di luar allowlist. WAJIB dibangkitkan ulang dari commit FINAL.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-marketing-lengkap.sh";
const OUT = "scripts/release-nilai-pisah.sh";
const GENERATOR = "scripts/gen-release-nilai-pisah.cjs";
const LIB_REH = "scripts/lib/rehearsal-nilai-persediaan.mjs", LIB_SMOKE = "scripts/lib/smoke-nilai-persediaan.mjs";
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE];
const CAND_BRANCH = "feat/laporan-nilai-pisah-nol-owner-on-9460dc9f";
// Teks ASCII baru di bundel web (esbuild menulis non-ASCII sebagai \uXXXX): HANYA teks yang TIDAK ada di bundel release aktif.
const DIST_BARU = ["Kuantitas menurut ledger", "Nol melalui koreksi resmi", "Informasi terpisah", "jejak penelusuran", "Tanpa catatan stok"];
// Teks fitur yang SUDAH live pada baseline (rilis marketing-lengkap): tidak boleh hilang dari bundel baru.
const DIST_LIVE_TAMBAHAN = ["Prospek eksplisit", "Prospek atau lanjut", "Biaya / prospek eksplisit"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

const COUNT_SQL = "select 'stock_movements', count(*) from stock_movements union all select 'biaya_beku', count(*) from stock_movement_biaya_operasional union all select 'harga_berlaku', count(*) from material_harga_berlaku union all select 'jurnal', count(*) from fin_journal_entries union all select 'penyesuaian', count(*) from stock_adjustment_requests union all select 'goods_receipts', count(*) from goods_receipts union all select 'persediaan_awal', count(*) from fin_inventory_openings union all select 'pengaturan_finance', count(*) from fin_settings union all select 'hasil_so', count(*) from activity_events where entity_type = 'hasil_so_bahan'";

const HEADER = `# RILIS "NILAI PERSEDIAAN: PEMISAHAN NOL OWNER, CAKUPAN KUANTITAS vs HARGA, SUMBER DOKUMEN HARGA": WEB + BACKEND ADITIF, TANPA migrasi dan TANPA perubahan schema.prisma — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • ISI: STOK_BELUM_DIKETAHUI dipecah menjadi sub-status (fisik nol dikonfirmasi Owner / tanpa catatan stok) dan SALDO_NOL (nol melalui koreksi resmi / nol menurut pergerakan) — status induk, nilai, dan persen dinilai TIDAK berubah;
#     saringan dan strip menampilkan pembeda; cakupan "kuantitas menurut ledger" dan cakupan harga dihitung TERPISAH; pengamatan nol Owner = informasi terpisah (tidak dijumlahkan, tidak dinilai, tidak dihitung berharga);
#     harga menampilkan sumber dokumen (PO nomor+baris / CSV baris / manual) dengan status "belum diverifikasi" — dokumen sumber BUKAN bukti biaya perolehan.
#   • TIDAK ada jalur tulis baru, TIDAK ada ADJUSTMENT, TIDAK ada badge verifikasi baru, TIDAK mengubah harga/stok/jurnal. Smoke pasca-switch = GET saja.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore; invarian laporan + uji pencatatan hasil SO HANYA pada salinan restore); build web di release dir (bukti build dicatat);
#     switch SATU kali; verifikasi; smoke pasca-switch (kode smoke yang sama dengan rehearsal; GET saja).
#   • PENGUNCIAN: kunci deploy BERSAMA + kunci sendiri diambil ATOMIK; kepemilikan ditentukan proses (perangkat:inode fd 7/9), BUKAN nama berkas. GERBANG IDENTITAS KODE LIVE (hash blob semua berkas terlacak baseline) di fase 2, 6, dan TEPAT sebelum switch.
#     Pembersihan release lama DINONAKTIFKAN; gerbang disk minimal 5 GiB tidak diturunkan.
#   • PENCARIAN TEKS DI DIST AKTIF memakai find|xargs (cari_dist), bukan glob: dist aktif memuat >21.000 chunk sehingga glob melampaui ARG_MAX.
#
#   cat scripts/release-nilai-pisah.sh | tr -d '\\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/npd.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/npd.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/npd.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/npdr.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/npd.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/npd.out 2>&1 < /dev/null &'   # rilis penuh
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru, tanpa tulisan data bisnis). Rollback mengembalikan kode lama: pembeda sub-status, cakupan kuantitas/harga terpisah, dan sumber dokumen harga hilang dari laporan Nilai Persediaan. Tidak ada data yang berubah.
# (dibangkitkan oleh scripts/gen-release-nilai-pisah.cjs dari scripts/release-marketing-lengkap.sh + pustaka scripts/lib/{rehearsal,smoke}-nilai-persediaan.mjs; JANGAN edit tangan — ubah generator lalu bangkitkan ulang)
`;

function bangkitkan({ baseScript, berkasList, rehNode, smokeNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const gantiBaris = (awalan, baru) => { const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith(awalan)); must(i >= 0, "baris berawalan: " + awalan.slice(0, 70)); L[i] = baru; s = L.join("\n"); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  const fe = berkas.filter((f) => f.startsWith("frontend/src/")).join(" ");
  must(!berkas.some((f) => /^backend\/prisma\//.test(f)), "rilis ini TANPA migrasi/schema: ada perubahan backend/prisma");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  for (const wajib of ["backend/src/services/nilaiPersediaan.js", "frontend/src/features/warehouse/nilaiPersediaan/nilaiPersediaanLogic.js", "frontend/src/pages/warehouse/WarehouseNilaiPersediaan.jsx"]) must(berkas.includes(wajib), "berkas wajib rilis tidak berbeda dari baseline: " + wajib);
  must(!berkas.some((f) => /^backend\/src\/(routes\/|middleware\/|index\.js|services\/(finance\/|inventoryLedger|postingStock|hasilSO|keadaanSaldo|pengamanHistorisPascaSO|attribution\/))/.test(f)), "rilis ini hanya boleh menyentuh services/nilaiPersediaan.js di backend/src (tidak ada rute, middleware, index.js, Finance, ledger, hasil SO)");
  must(be === "backend/src/services/nilaiPersediaan.js", "daftar backend/src harus tepat satu berkas: " + be);

  { const i = s.indexOf('# RILIS "LAPORAN MARKETING LENGKAP"'); const j = s.indexOf("set -Eeuo pipefail", i); must(i >= 0 && j > i, "header"); s = s.slice(0, i) + lf(HEADER) + s.slice(j); }
  r("feat/laporan-marketing-lengkap-on-5cd1a5fa", CAND_BRANCH);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`; s = L.join("\n");
  // nama kunci/backup/tag/DB sementara khusus rilis ini
  r("release-marketing-lengkap.lock", "release-nilai-pisah.lock"); r("marketing-lengkap-${DEPLOY_SHORT}", "nilai-pisah-${DEPLOY_SHORT}"); r("rollback-pre-mkl-", "rollback-pre-npd-"); r("rehearsal_mkl_", "rehearsal_npd_"); r("reh-mkl-", "reh-npd-");
  // blok rollback
  gantiBaris("Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama:", "Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama: laporan Nilai Persediaan kembali tanpa pembeda sub-status, tanpa cakupan kuantitas/harga terpisah, dan tanpa sumber dokumen harga.");
  gantiBaris("Customer, order, pembayaran, refund, transisi, touch, spend, biaya sumber, jurnal, dan stok tidak disentuh", "Stok, harga, biaya beku, jurnal, PSA, GR, penyesuaian, hasil SO, dan pengaturan Finance tidak disentuh oleh skrip rilis maupun oleh fitur ini: tidak ada yang perlu dibalik oleh rollback.");
  // teks fitur di bundel web: fitur rilis ini BARU; fitur marketing yang sudah live harus tetap ada
  gantiBaris('for s1 in "Prospek eksplisit"', `for s1 in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do [ -n "$(cari_dist "$NEW_DIR" js "$s1")" ] || die "dist baru tidak memuat teks fitur: \${s1}"; [ -z "$(cari_dist "$PREV_DIR" js "$s1")" ] || die "[skrip] teks fitur baru '\${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done`);
  r('for s2 in "Rincian verifikasi nol"', `for s2 in ${DIST_LIVE_TAMBAHAN.map((x) => `"${x}"`).join(" ")} "Rincian verifikasi nol"`);
  r('for t in "Prospek eksplisit" "Prospek atau lanjut" "Biaya / prospek eksplisit"; do', `for t in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do`);
  // rehearsal: kode baru sebagai server terhadap salinan restore (bagian B menulis HANYA pada salinan restore, dijaga nama DB rehearsal_*)
  gantiBaris("# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): ", "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): laporan Nilai Persediaan: invarian atas data nyata (cakupan kuantitas vs harga, sub-status, izin nominal, saldo akun Finance); UJI TULIS pencatatan hasil SO HANYA pada salinan restore (izin, validasi, idempotensi, koreksi append-only, tanpa tulisan ledger/harga/jurnal/PSA/GR/fin_settings)");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).replace('"@@SMOKE_SRC@@"', () => JSON.stringify(lf(smokeNode))).trimEnd() + s.slice(j); }
  r("uji laporan Marketing terhadap salinan restore GAGAL", "uji Nilai Persediaan terhadap salinan restore GAGAL");
  r("TIDAK ada uji tulis (rilis tanpa jalur tulis); seluruh uji = GET pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca", "uji tulis pencatatan hasil SO dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca dan dihitung");
  // smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke baca-saja: laporan Nilai Persediaan pada data nyata (cakupan = jumlah bahan, sub-status, cakupan kuantitas vs harga, pengecualian tidak pernah Rp0, saldo akun Finance = jumlah jurnal akun, nominal mengikuti izin), TANPA pencatatan hasil SO dan TANPA perubahan data"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (Nilai Persediaan: invarian atas data nyata, sub-status, izin nominal, tanpa jejak tulis)"');
  gantiBaris('COUNT_SQL="', `COUNT_SQL="${COUNT_SQL}"`);
  r("hitung baris customer/order/payments/kredit/refund/transisi/touch/spend/biaya sumber/jurnal/stok", "hitung baris stok/biaya beku/harga/penyesuaian/GR/persediaan awal/pengaturan Finance/hasil SO/jurnal");
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa pemisahan pada laporan Nilai Persediaan (baca-saja): fisik nol dikonfirmasi Owner dibedakan dari tanpa catatan stok dan dari nol koreksi resmi; cakupan kuantitas menurut ledger terpisah dari cakupan harga; harga menampilkan sumber dokumen berstatus belum diverifikasi. TIDAK ada tulisan data bisnis, TIDAK ada ADJUSTMENT, TIDAK ada perubahan harga. Pengesahan, harga yang perlu keputusan, dan pengecualian lain tetap keputusan Owner."');
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  const sisa = s.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !l.startsWith("#") && !l.includes("dibangkitkan oleh scripts/gen-release-nilai-pisah") && /laporan Marketing|marketing-lengkap|\bmkl\b|reh-mkl|prospek eksplisit atau|Google Ads/i.test(l)).map(([i]) => i);
  must(sisa.length === 0, "nama/isi rilis marketing tersisa pada baris: " + sisa.join(","));
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
  const hasil = bangkitkan({ baseScript: git(["show", `${base}:${BASE_SCRIPT}`]), berkasList: list, rehNode: fs.readFileSync(path.join(REPO, LIB_REH), "utf8"), smokeNode: fs.readFileSync(path.join(REPO, LIB_SMOKE), "utf8") });
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
