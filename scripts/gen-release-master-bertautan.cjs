// Generator skrip rilis bergerbang "Master baru + tautan SO atomik" (BACKEND-SAJA, TANPA migrasi, TANPA perubahan schema.prisma/frontend/env).
// Diturunkan dari scripts/release-nilai-pisah.sh pada BASE (= release aktif; kerangka SUDAH LIVE: gerbang identitas kode live, penguncian bersama berbasis kepemilikan proses, backup + rehearsal restore, switch satu kali, smoke,
// tanpa pembersihan, gerbang disk). Bagian WEB dibuang (frontend/dist release aktif DIBAWA APA ADANYA dari disk, BUKAN dari git: lihat jebakan dist-only) dan diganti pustaka scripts/lib/{rehearsal,smoke}-master-bertautan.mjs.
//
//   node scripts/gen-release-master-bertautan.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-master-bertautan.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// Allowlist = berkas yang berbeda dari base (git diff) + berkas tetap rilis ini. Skrip rilis menolak berkas di luar allowlist. WAJIB dibangkitkan ulang dari commit FINAL.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-nilai-pisah.sh";
const OUT = "scripts/release-master-bertautan.sh";
const GENERATOR = "scripts/gen-release-master-bertautan.cjs";
const LIB_REH = "scripts/lib/rehearsal-master-bertautan.mjs", LIB_SMOKE = "scripts/lib/smoke-master-bertautan.mjs";
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE];
const CAND_BRANCH = "feat/master-bertautan-atomik-on-e992be28";
const BE_WAJIB = ["backend/src/routes/pemakaianKoreksi.js", "backend/src/services/pengamanHistorisPascaSO.js"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

const COUNT_EXTRA = " union all select 'materials', count(*) from materials union all select 'tautan_so', count(*) from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN'";

const HEADER = `# RILIS "MASTER BARU + TAUTAN SO ATOMIK" (pengaman posting historis): BACKEND-SAJA, TANPA migrasi dan TANPA perubahan schema.prisma/frontend/env — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • ISI: rute POST /api/production/posting-historis/pengaman/master-bertautan membuat master baru DAN tautan SO-nya dalam SATU transaksi (semua berhasil bersama atau gagal tanpa sisa). Alasan: sistem memetakan catatan
#     historis ke master baru bila nama/kode persis sama (evaluasi ulang, juga dipicu pembacaan daftar); jeda antara "master dibuat" dan "tautan dipasang" tidak boleh ada. Master dan tautan terlihat oleh transaksi lain pada COMMIT yang sama.
#   • TIDAK ada migrasi, TIDAK membuat master/tautan/pemetaan apa pun oleh skrip rilis, TIDAK mengubah stok/harga/valuasi/jurnal/PSA/GR, TIDAK membuat deklarasi. Smoke pasca-switch = GET + POST yang DITOLAK sebelum menulis.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore; uji tulis rute atomik, rollback, idempotensi, dan uji NYATA 18 catatan historis KAYU RACUK 2X5X200/2X6X200 HANYA pada
#     salinan restore); TANPA build web (frontend/dist release aktif DIBAWA APA ADANYA dari disk, bukan dari git); switch SATU kali; verifikasi; smoke pasca-switch (kode smoke yang sama dengan rehearsal).
#   • PENGUNCIAN: kunci deploy BERSAMA + kunci sendiri diambil ATOMIK; kepemilikan ditentukan proses (perangkat:inode fd 7/9), BUKAN nama berkas. GERBANG IDENTITAS KODE LIVE (hash blob semua berkas terlacak baseline) di fase 2, 6, dan TEPAT sebelum switch.
#     Pembersihan release lama DINONAKTIFKAN; gerbang disk minimal 5 GiB tidak diturunkan.
#
#   cat scripts/release-master-bertautan.sh | tr -d '\\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/mba.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/mba.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/mba.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/mbar.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/mba.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/mba.out 2>&1 < /dev/null &'   # rilis penuh
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru, tanpa tulisan data bisnis oleh skripnya). Rollback mengembalikan kode lama: rute master-bertautan hilang; master dan tautan yang sudah dibuat lewat rute itu TETAP
# (data, bukan kode) dan tidak dihapus oleh rollback. Tidak ada data yang berubah oleh rollback.
# (dibangkitkan oleh scripts/gen-release-master-bertautan.cjs dari scripts/release-nilai-pisah.sh + pustaka scripts/lib/{rehearsal,smoke}-master-bertautan.mjs; JANGAN edit tangan — ubah generator lalu bangkitkan ulang)
`;

function bangkitkan({ baseScript, berkasList, rehNode, smokeNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const gantiBaris = (awalan, baru) => { const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith(awalan)); must(i >= 0, "baris berawalan: " + awalan.slice(0, 70)); L[i] = baru; s = L.join("\n"); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); must(i >= 0, "awal blok: " + awal.slice(0, 70)); const j = s.indexOf(akhir, i); must(j > i, "akhir blok: " + akhir.slice(0, 70)); s = s.slice(0, i) + ganti + s.slice(j); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  must(!berkas.some((f) => /^frontend\//.test(f)), "rilis ini BACKEND-SAJA: ada perubahan frontend");
  must(!berkas.some((f) => /^backend\/prisma\//.test(f)), "rilis ini TANPA migrasi/schema: ada perubahan backend/prisma");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  for (const wajib of BE_WAJIB) must(berkas.includes(wajib), "berkas wajib rilis tidak berbeda dari baseline: " + wajib);
  must(be === [...BE_WAJIB].sort().join(" "), "daftar backend/src harus tepat " + BE_WAJIB.join(", ") + " (ada: " + be + ")");

  { const i = s.indexOf('# RILIS "NILAI PERSEDIAAN'); const j = s.indexOf("set -Eeuo pipefail", i); must(i >= 0 && j > i, "header"); s = s.slice(0, i) + lf(HEADER) + s.slice(j); }
  r("feat/laporan-nilai-pisah-nol-owner-on-9460dc9f", CAND_BRANCH);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT=""`; s = L.join("\n");
  // nama kunci/backup/tag/DB sementara khusus rilis ini
  r("release-nilai-pisah.lock", "release-master-bertautan.lock"); r("nilai-pisah-${DEPLOY_SHORT}", "master-bertautan-${DEPLOY_SHORT}"); r("rollback-pre-npd-", "rollback-pre-mba-"); r("rehearsal_npd_", "rehearsal_mba_");
  // blok rollback
  gantiBaris("Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama:", "Web (frontend/dist) tidak diubah oleh rilis ini (dibawa apa adanya) dan dikembalikan bersama folder release sebelumnya. Kode lama: rute master-bertautan hilang; master dan tautan yang telah dibuat lewat rute itu TETAP ada (data).");
  gantiBaris("Stok, harga, biaya beku, jurnal, PSA, GR, penyesuaian, hasil SO, dan pengaturan Finance tidak disentuh", "Stok, harga, biaya beku, jurnal, PSA, GR, penyesuaian, hasil SO, dan pengaturan Finance tidak disentuh oleh skrip rilis maupun oleh kode ini: tidak ada yang perlu dibalik oleh rollback.");
  // TANPA node_modules frontend dan TANPA build web
  potong('say "2b. Sumber node_modules frontend', 'DB_BYTES="$(psql_live', 'say "2b. Rilis backend-saja: tidak ada build web dan tidak ada node_modules frontend yang disalin; gerbang disk memperhitungkan salinan frontend/dist"\nNM_KB="$(du -sk "$PREV_DIR/frontend/dist" | cut -f1)"\n');
  r(`NM_KB="$(du -sk "$NM_SRC" | cut -f1)"; `, "");
  r('cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"', 'cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal membawa frontend/dist dari release aktif (dist on-disk, BUKAN dari git)"');
  potong('say "4b. Build frontend di release dir', 'PHASE="5-build-image"', `say "4b. Web TIDAK dibangun ulang: frontend/dist DIBAWA APA ADANYA dari release aktif (dist on-disk, bukan dari git)"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ "$NEW_INDEX" = "$PREV_INDEX" ] || die "bundel di release dir (\${NEW_INDEX}) != bundel release aktif (\${PREV_INDEX})"
cmp -s "$PREV_DIR/frontend/dist/index.html" "$NEW_DIR/frontend/dist/index.html" || die "index.html dist berbeda dari release aktif"
[ "$(find "$PREV_DIR/frontend/dist" -type f | wc -l)" = "$(find "$NEW_DIR/frontend/dist" -type f | wc -l)" ] || die "jumlah berkas dist berbeda dari release aktif"
OLD_ASSETS="$BK_DIR/aset-lama.txt"; : > "$OLD_ASSETS"
ok "dist dibawa apa adanya (\${NEW_INDEX}); tidak ada aset lama yang perlu dibawa terpisah"

`);
  // rehearsal: kode baru sebagai server terhadap salinan restore (bagian B menulis HANYA pada salinan restore, dijaga nama DB rehearsal_*)
  gantiBaris("# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): ", "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): rute master-bertautan (atomik, rollback, idempotensi, izin) dan uji NYATA 18 catatan historis KAYU RACUK 2X5X200/2X6X200 — hanya pada salinan restore, dibuang sesudahnya.");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).replace('"@@SMOKE_SRC@@"', () => JSON.stringify(lf(smokeNode))).trimEnd() + s.slice(j); }
  r("uji Nilai Persediaan terhadap salinan restore GAGAL", "uji master-bertautan terhadap salinan restore GAGAL");
  r("uji tulis pencatatan hasil SO dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca dan dihitung", "uji tulis rute master-bertautan dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca");
  // smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke: rute master-bertautan ada dan dijaga (401/403/400/428 sebelum menulis), daftar pengaman terbaca, TANPA membuat master atau tautan dan TANPA perubahan jumlah baris"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (master-bertautan: rute dijaga, tanpa jejak tulis)"');
  { const l0 = s.split("\n").find((l) => l.startsWith('COUNT_SQL="')); must(!!l0, "COUNT_SQL"); gantiBaris('COUNT_SQL="', l0.replace(/"\s*$/, COUNT_EXTRA + '"')); }
  r("hitung baris stok/biaya beku/harga/penyesuaian/GR/persediaan awal/pengaturan Finance/hasil SO/jurnal", "hitung baris stok/biaya beku/harga/penyesuaian/GR/persediaan awal/pengaturan Finance/hasil SO/jurnal/master/tautan SO");
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa rute POST /api/production/posting-historis/pengaman/master-bertautan (penyetuju + inventory:write): master baru dan tautan SO dibuat dalam satu transaksi. Skrip rilis TIDAK membuat master atau tautan; pembuatan master KAYU RACUK 2X5X200/2X6X200 dilakukan sesudah rilis oleh Owner lewat rute itu dengan persetujuan terpisah."');
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  const sisa = s.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !l.startsWith("#") && !l.includes("dibangkitkan oleh scripts/gen-release-master-bertautan") && /Nilai Persediaan|nilai-pisah|\bnpd\b|nilaiPersediaan|Kuantitas menurut ledger|cari_dist "\$NEW_DIR"|MAPS_KEY|NM_SRC/i.test(l)).map(([i, l]) => `${i}:${l.slice(0, 60)}`);
  const sisaPenting = sisa.filter((x) => !/^\d+:cari_dist\(\)/.test(x)); must(sisaPenting.length === 0, "nama/isi rilis lama tersisa pada baris: " + sisaPenting.join(" | "));
  return { script: lf(s), ringkasan: { berkas: berkas.length, backendSrc: berkas.filter((f) => f.startsWith("backend/src/")).length } };
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
module.exports = { bangkitkan, COUNT_EXTRA };
if (require.main === module) main();
