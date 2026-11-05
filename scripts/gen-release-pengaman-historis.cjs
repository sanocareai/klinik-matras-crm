// Generator skrip rilis bergerbang "Pengaman posting historis pasca-SO + label nol Nilai Persediaan" (WEB + BACKEND ADITIF, TANPA migrasi dan TANPA perubahan schema.prisma).
// Diturunkan dari scripts/release-nilai-persediaan.sh pada BASE (= release aktif; kerangka SUDAH LIVE: gerbang identitas kode live, penguncian bersama berbasis kepemilikan proses, rehearsal restore, switch satu kali, smoke, tanpa pembersihan).
//
//   node scripts/gen-release-pengaman-historis.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-pengaman-historis.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// Allowlist = berkas yang berbeda dari base (git diff) + berkas tetap rilis ini. Skrip rilis menolak berkas di luar allowlist. WAJIB dibangkitkan ulang dari commit FINAL.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-nilai-persediaan.sh";
const OUT = "scripts/release-pengaman-historis.sh";
const GENERATOR = "scripts/gen-release-pengaman-historis.cjs";
const LIB_REH = "scripts/lib/rehearsal-pengaman-historis.mjs", LIB_SMOKE = "scripts/lib/smoke-pengaman-historis.mjs";
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE];
const CAND_BRANCH = "feat/pengaman-historis-pasca-so";
// Teks ASCII baru di bundel web (esbuild menulis non-ASCII sebagai \uXXXX): hanya teks yang TIDAK ada di bundel release aktif.
const DIST_BARU = ["Rincian verifikasi nol"];
// Teks fitur Nilai Persediaan yang SUDAH live (rilis ae2765cc): tidak boleh hilang dari bundel baru.
const DIST_LIVE_NILAI = ["Rincian bukti Finance", "Tanpa hasil SO bermasalah", "Catat hasil SO", "Siapa melihat nominal"];
const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

const HEADER = `# RILIS "PENGAMAN POSTING HISTORIS PASCA-SO + LABEL NOL" (Gudang/Produksi): WEB + BACKEND ADITIF, TANPA migrasi dan TANPA perubahan schema.prisma — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • PENGAMAN: tautan SO EKSPLISIT per bahan (penyetuju; tanggal SO = batas, akhir hari WIB) menahan catatan pemakaian historis bahan itu (TERTAHAN_PASCA_SO): keluar dari rencana posting dan DITOLAK di dalam transaksi posting.
#     Penyelesaian per CATATAN oleh penyetuju: TERCERMIN (tanpa ISSUE) atau BELUM_TERCERMIN (dilepas ke posting biasa). Koreksi biasa (mis. koreksi data) TIDAK menahan apa pun; tanpa tautan, rencana dan hash IDENTIK dengan sebelumnya.
#     Jejak = activity_events (entity pernyataan_historis_so), append-only. TIDAK menulis stok, harga, valuasi, jurnal, PSA, GR. Rute baru: GET/POST /api/production/posting-historis/pengaman/*.
#   • LABEL NOL laporan Nilai Persediaan: 'Nol terverifikasi — Koreksi Saldo <dokumen> (diposting …; SO <tanggal> bila ditautkan)' dibedakan dari Stock Count; 178 pengamatan tetap 'Fisik nol dikonfirmasi Owner'. Aturan verifikasi resmi tidak berubah.
#   • Rilis ini TIDAK membuat tautan, pernyataan, hasil SO, maupun tulisan data bisnis apa pun; tidak membuka posting historis. Tautan SO untuk 48 bahan dibuat SESUDAH rilis oleh penyetuju, dengan keputusan terpisah.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore; uji tulis tautan/pernyataan/pembatalan HANYA pada salinan restore dengan bukti hash rencana kembali IDENTIK); build web di release dir; switch SATU kali; verifikasi; smoke pasca-switch (GET saja).
#   • PENGUNCIAN: kunci deploy BERSAMA + kunci sendiri diambil ATOMIK; kepemilikan ditentukan proses (perangkat:inode fd 7/9), BUKAN nama berkas. GERBANG IDENTITAS KODE LIVE (hash blob semua berkas terlacak baseline) di fase 2, 6, dan TEPAT sebelum switch. Pembersihan release lama DINONAKTIFKAN; gerbang disk minimal 5 GiB tidak diturunkan.
#
#   cat scripts/release-pengaman-historis.sh | tr -d '\\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/pph.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/pph.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pph.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/pphr.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pph.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/pph.out 2>&1 < /dev/null &'   # rilis penuh
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru). Rollback mengembalikan kode lama: pengaman hilang (posting historis kembali seperti sebelum rilis) dan label nol lama kembali. Peristiwa tautan/pernyataan yang SUDAH dibuat tetap ada (append-only).
# (dibangkitkan oleh scripts/gen-release-pengaman-historis.cjs dari scripts/release-nilai-persediaan.sh + pustaka scripts/lib/{rehearsal,smoke}-pengaman-historis.mjs; JANGAN edit tangan — ubah generator lalu bangkitkan ulang)
`;

function bangkitkan({ baseScript, berkasList, rehNode, smokeNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); const j = s.indexOf(akhir, i + awal.length); must(i >= 0 && j >= 0, `penanda: ${awal.slice(0, 60)} .. ${akhir.slice(0, 60)}`); s = s.slice(0, i) + ganti + s.slice(j); };
  const gantiBaris = (awalan, baru) => { const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith(awalan)); must(i >= 0, "baris berawalan: " + awalan.slice(0, 70)); L[i] = baru; s = L.join("\n"); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  const fe = berkas.filter((f) => f.startsWith("frontend/src/")).join(" ");
  must(!berkas.some((f) => /^backend\/prisma\//.test(f)), "rilis ini TANPA migrasi/schema: ada perubahan backend/prisma");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  for (const wajib of ["backend/src/services/pengamanHistorisPascaSO.js", "backend/src/services/postingPemakaianHistoris.js", "backend/src/services/nilaiPersediaan.js", "backend/src/routes/pemakaianKoreksi.js", "backend/src/lib/activityLog.js", "frontend/src/pages/warehouse/WarehouseNilaiPersediaan.jsx"]) must(berkas.includes(wajib), "berkas inti harus ada di diff: " + wajib);
  must(!berkas.some((f) => /^backend\/src\/(routes\/(analytics|conversations)|middleware\/cacheSingkat)\.js$|^frontend\/src\/pages\/Laporan\.jsx$/.test(f)), "rilis ini tidak boleh menyentuh berkas hotfix performa");
  must(!berkas.some((f) => /^backend\/src\/(index\.js|services\/(inventoryLedger|postingStock|finance\/posting\/inventory)\.js)$/.test(f)), "rilis ini tidak boleh menyentuh index.js maupun jalur tulis ledger/valuasi");

  potong('# RILIS "NILAI PERSEDIAAN"', "set -Eeuo pipefail", lf(HEADER));
  r("feat/laporan-nilai-persediaan-on-5fd99882", CAND_BRANCH);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`; s = L.join("\n");
  // nama kunci/backup/tag/DB sementara khusus rilis ini
  r("release-nilai-persediaan.lock", "release-pengaman-historis.lock"); r("nilai-persediaan-${DEPLOY_SHORT}", "pengaman-historis-${DEPLOY_SHORT}"); r("rollback-pre-npr-", "rollback-pre-pph-"); r("rehearsal_npr_", "rehearsal_pph_");
  // blok rollback
  r("Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama tidak punya halaman Nilai Persediaan maupun rute pencatatan hasil SO; kartu KPI lama kembali di Laporan Gudang.", "Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama tidak punya pengaman posting historis (rute /api/production/posting-historis/pengaman) dan label nol lama kembali.");
  r("Catatan hasil SO yang dibuat SELAMA rilis ini aktif tetap ada sebagai peristiwa aktivitas (append-only): rollback tidak menghapus atau membalik apa pun, dan tidak ada ledger/harga/jurnal yang berubah karenanya.", "Tautan dan pernyataan yang dibuat SELAMA rilis ini aktif tetap ada sebagai peristiwa aktivitas (append-only): rollback tidak menghapus atau membalik apa pun, tetapi pengaman TIDAK berlaku lagi — jangan memposting pemakaian historis sebelum kode ini dipulihkan. Tidak ada ledger/harga/jurnal yang berubah karenanya.");
  // teks fitur di bundel web: fitur rilis ini BARU; fitur Nilai Persediaan yang sudah live harus tetap ada
  { const L2 = s.split("\n"); const i = L2.findIndex((l) => l.startsWith('for s1 in "Rincian bukti Finance"')); must(i >= 0, "baris s1");
    L2[i] = `for s1 in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: \${s1}"; [ -z "$(grep -lF -- "$s1" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks fitur baru '\${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done`; s = L2.join("\n"); }
  r('for s2 in "prod-app-logo"', `for s2 in ${DIST_LIVE_NILAI.map((x) => `"${x}"`).join(" ")} "prod-app-logo"`);
  // CSS: rilis ini TIDAK menambah aturan CSS; aturan Nilai Persediaan yang sudah live (.nip-*) harus ada di KEDUANYA
  { const i = s.indexOf('for c1 in ".nip-kartu" ".nip-tabel" ".nipf-info"; do'); const j = s.indexOf("\ndone\n", i); must(i >= 0 && j > i, "blok CSS c1");
    s = s.slice(0, i) + 'for c1 in ".nip-kartu" ".nip-tabel" ".nipf-info" ".nip-so"; do\n  [ -n "$(grep -lF -- "$c1" "$PREV_DIR"/frontend/dist/assets/*.css 2>/dev/null | sed -n 1p)" ] || die "[skrip] \'${c1}\' tidak ada di CSS release aktif — perbaiki daftar pembanding"\n  [ -n "$(grep -lF -- "$c1" "$NEW_DIR"/frontend/dist/assets/*.css 2>/dev/null | sed -n 1p)" ] || die "CSS baru KEHILANGAN ${c1}"' + s.slice(j); }
  r("# CSS: rilis ini MENAMBAH kelas .nip-* (Nilai Persediaan; dipastikan belum ada di dist aktif).", "# CSS: rilis ini TIDAK menambah aturan CSS (kelas .nip-* sudah live).");
  // rehearsal: kode baru sebagai server terhadap salinan restore
  gantiBaris("# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): ", "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): pengaman posting historis (rencana, daftar, izin, label nol); UJI TULIS tautan SO → tertahan → pernyataan per catatan → pembatalan HANYA pada salinan restore, dengan bukti hash rencana kembali IDENTIK dan tanpa tulisan ledger/harga/jurnal/PSA/GR/catatan pemakaian");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).replace('"@@SMOKE_SRC@@"', () => JSON.stringify(lf(smokeNode))).trimEnd() + s.slice(j); }
  r("uji Nilai Persediaan terhadap salinan restore GAGAL", "uji pengaman posting historis terhadap salinan restore GAGAL");
  r("uji tulis pencatatan hasil SO dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca dan dihitung", "uji tulis tautan/pernyataan dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca dan dihitung");
  // smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke baca-saja: laporan Nilai Persediaan (invarian + label nol menurut sumber) dan pengaman posting historis (rute, izin, rencana tanpa tautan = hash lama), TANPA tautan/pernyataan dan TANPA perubahan data"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (laporan Nilai Persediaan, label nol, pengaman posting historis; tanpa jejak tulis)"');
  // hitung baris pra/pasca switch: tambah tabel pengaman dan catatan pemakaian (harus identik sebelum vs sesudah switch)
  r("select 'hasil_so', count(*) from activity_events where entity_type = 'hasil_so_bahan'", "select 'hasil_so', count(*) from activity_events where entity_type = 'hasil_so_bahan' union all select 'pernyataan_historis_so', count(*) from activity_events where entity_type = 'pernyataan_historis_so' union all select 'catatan_pemakaian', count(*) from unit_usage_notes union all select 'catatan_pending', count(*) from unit_usage_notes where state in ('SIAP_POSTING','PERLU_DICEK')");
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa pengaman posting historis pasca-SO (tautan SO eksplisit; belum ada tautan; posting historis TIDAK dibuka) dan label nol menurut sumber bukti. TIDAK ada tautan, pernyataan, hasil SO, atau tulisan data bisnis dari rilis; stok, harga, jurnal, PSA, GR, catatan pemakaian, dan pengaturan Finance tidak berubah. Tautan SO untuk 48 bahan dan pencatatan 178 nol dikerjakan SESUDAH rilis, dengan keputusan terpisah."');
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  must(!/release-nilai-persediaan\.lock|rollback-pre-npr|rehearsal_npr_|reh-npr/.test(s), "nama rilis lama tersisa");
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
module.exports = { bangkitkan };
if (require.main === module) main();
