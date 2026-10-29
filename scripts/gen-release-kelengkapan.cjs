// Generator skrip rilis bergerbang "Kelengkapan Order Produksi" (backend + web + 1 migrasi ADITIF: 1 tabel pernyataan "tanpa bahan baru", kosong). Model migrasi dari rilis Koreksi Saldo + GERBANG IDENTITAS KODE LIVE (isi, bukan marker).
// Hasil: scripts/release-kelengkapan.sh — diturunkan dari scripts/release-status-kerja-buka-pekerjaan.sh + scripts/templates/release-kelengkapan/* + blok gerbang di scripts/templates/release-penjadwalan-langsung/*
// + pustaka scripts/lib/{scan-migrasi,rehearsal,smoke}-kelengkapan.mjs. Semua nilai yang bergantung pada commit (allowlist, daftar berkas, pin sha256 migrasi, pin diff schema, hasil pemindai DDL) dihitung dari git terhadap --base.
//
//   node scripts/gen-release-kelengkapan.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-kelengkapan.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const MIG_SUFIKS = "_pernyataan_tanpa_bahan";
const BASE_SCRIPT = "scripts/release-status-kerja-buka-pekerjaan.sh";
const OUT = "scripts/release-kelengkapan.sh";
const TPL_DIR = "scripts/templates/release-kelengkapan"; const TPL_P = "scripts/templates/release-penjadwalan-langsung";
const LIB_SCAN = "scripts/lib/scan-migrasi-kelengkapan.mjs", LIB_REH = "scripts/lib/rehearsal-kelengkapan.mjs", LIB_SMOKE = "scripts/lib/smoke-kelengkapan.mjs";
const GUARD = "scripts/rollback-guard-kelengkapan.sh", GENERATOR = "scripts/gen-release-kelengkapan.cjs";
const TPL_FILES = ["header", "vars", "kunci", "uji-pra-switch", "fase0-kunci", "cek-ulang-kunci", "isi-pra-switch", "rehearsal-pra-switch", "isi-pasca-switch", "guard-pasca", "struktur", "gate-prisma", "keadaan", "rehearsal-migrasi", "rehearsal-guard", "step6", "rollback"].map((n) => `${TPL_DIR}/${n}.txt`);
const TPL_GERBANG = ["gerbang-kode-live", "verifikasi-hotfix", "hitung-pra", "hitung-pasca"].map((n) => `${TPL_P}/${n}.txt`);
const LIB_KUNCI = "scripts/lib/gen-kunci-kelengkapan.cjs";
const { terapkanKunci } = require("./lib/gen-kunci-kelengkapan.cjs");
const FILE_TETAP = [OUT, GUARD, GENERATOR, LIB_SCAN, LIB_REH, LIB_SMOKE, LIB_KUNCI, ...TPL_FILES];
const CAND_BRANCH = "feat/order-produksi-kelengkapan";
const DIST_BARU = ["Bahan belum dicatat", "Bahan perlu dicek", "HPP belum lengkap", "Data order kurang", "Kelengkapan data", "Unit ini memang tanpa bahan baru", "Paling lama belum ditangani", "Tanggal order masuk (unit dibuat)"];
const DIST_LAMA_TAMBAHAN = ["Buka pekerjaan", "Catat pekerjaan selesai", "Tandai sudah dikerjakan", "Harga Berlaku (HPP operasional)", "Koreksi salah input historis", "Ada stok", "Pilih meja", "Belum dijadwalkan", "Tambah pemakaian", "Koreksi saldo", "Konfirmasi Barang Jadi", "Pengeluaran Material"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const UJI_TERISOLASI = [
  'mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"',
  'REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")',
  '[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c \'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l\' </dev/null | tr -d \'[:space:]\')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }',
  'ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"',
].join("\n");
// Guard rollback pada production SESUDAH switch (baca-saja): belum ada pernyataan aktif → LULUS; sesudah ada pernyataan → LULUS DENGAN PERINGATAN + snapshot (rollback rutin tetap diperbolehkan).
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
const baca = (rel) => lf(fs.readFileSync(path.join(REPO, rel), "utf8"));

function schemaDiffSha(ref) {
  const keluar = git(["diff", "-U0", "--no-color", ref, "HEAD", "--", "backend/prisma/schema.prisma"]);
  const d = keluar.split("\n").filter((l) => !l.startsWith("index ")).map((l) => l.replace(/^@@ [^@]*@@.*$/, "@@")).join("\n");
  return sha(d + "\n"); // skrip rilis: { cat; echo; } menambah SATU baris kosong setelah keluaran
}
const namaObjek = (sql) => {
  const ambil = (re) => [...sql.matchAll(re)].map((m) => m[1]);
  const pkeys = ambil(/CONSTRAINT "([a-z0-9_]+_pkey)" PRIMARY KEY/g);
  const idx = ambil(/CREATE (?:UNIQUE )?INDEX "([a-z0-9_]+)"/g);
  const parsial = [...sql.matchAll(/CREATE UNIQUE INDEX "([a-z0-9_]+)" ON [^\n]* WHERE /g)].map((m) => m[1]);
  return { idx: [...pkeys, ...idx], parsial, chk: ambil(/CONSTRAINT "([a-z0-9_]+)" CHECK/g), fk: ambil(/ADD CONSTRAINT "([a-z0-9_]+)" FOREIGN KEY/g), trg: ambil(/CREATE TRIGGER "([a-z0-9_]+)"/g) };
};

function bangkitkan({ baseScript, blok, berkasList, mig, schemaSha, scanJs, scanExpect, rehNode, smokeNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); const j = s.indexOf(akhir, i + awal.length); must(i >= 0 && j >= 0, `penanda: ${awal.slice(0, 60)} .. ${akhir.slice(0, 60)}`); s = s.slice(0, i) + ganti + s.slice(j); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  const fe = berkas.filter((f) => f.startsWith("frontend/src/")).join(" ");
  const prismaOk = ["backend/prisma/schema.prisma", `backend/prisma/migrations/${mig.name}/migration.sql`];
  for (const p of prismaOk) must(berkas.includes(p), "berkas prisma tidak ada di diff: " + p);
  must(!berkas.some((f) => /^backend\/prisma\//.test(f) && !prismaOk.includes(f)), "perubahan prisma lain di luar schema + migrasi rilis");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.includes("backend/src/index.js") && berkas.includes("backend/src/services/unitMaterialDeclarationService.js") && berkas.includes("backend/src/services/productionKelengkapan.js") && berkas.includes("backend/src/lib/domain/kelengkapanOrderProduksi.js") && berkas.includes("frontend/src/features/production/KelengkapanBagian.jsx"), "layanan pernyataan + klasifikasi kelengkapan + komponen drawer harus ada di diff (index.js TIDAK boleh berubah)");
  const ob = namaObjek(mig.sql); must([...mig.sql.matchAll(/CREATE TABLE "/g)].length === 1, "harus tepat 1 CREATE TABLE");
  must(ob.idx.length === 4 && ob.fk.length === 1 && ob.chk.length === 4 && ob.trg.length === 0 && ob.parsial.length === 1, "objek rilis tidak seperti yang diaudit (4 indeks termasuk pkey [1 parsial], 1 FK, 4 CHECK, 0 trigger)");

  // 1. header
  potong("# RILIS \"STATUS KERJA JUJUR", "set -Eeuo pipefail", lf(blok.header));
  // 2. variabel
  r('CAND_BRANCH="${CAND_BRANCH:-fix/status-kerja-buka-pekerjaan}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0, "ALLOWED_RE");
  const vars = lf(blok.vars).replace("@@MIG_NAME@@", () => mig.name).replace("@@MIG_PIN@@", () => sha(lf(mig.sql))).replace("@@SCAN_EXPECT@@", () => scanExpect).replace("@@SCHEMA_DIFF_SHA@@", () => schemaSha)
    .replace("@@IDX_BARU@@", ob.idx.join(" ")).replace("@@IDX_PARSIAL@@", ob.parsial.join(" ")).replace("@@CHK_BARU@@", ob.chk.join(" ")).replace("@@FK_BARU@@", ob.fk.join(" ")).replace("@@TRG_BARU@@", ob.trg.join(" ")).trimEnd();
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`; L.splice(ia + 3, 0, vars);
  s = L.join("\n");
  // 3. nama
  r("status-kerja-${DEPLOY_SHORT}-${TS}", "kelengkapan-${DEPLOY_SHORT}-${TS}"); r("pre-status-kerja-", "pre-kl-"); r("rehearsal_status_kerja_", "rehearsal_kelengkapan_");
  r("/tmp/release-status-kerja-buka-pekerjaan.lock", "/tmp/release-kelengkapan.lock"); r("sk1\\|release-status-kerja-buka-pekerjaan\\|pgrep", "kl1\\|release-kelengkapan\\|pgrep");
  // 4. instruksi rollback
  potong("Rilis ini TANPA migrasi dan TANPA tulisan data bisnis:", "─────────────────────────────────────────────────────────────────────────\nEOF", lf(blok.rollback).trimEnd() + "\n");
  r("Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.", "Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (bila sudah lewat tahap migrasi: tabel pernyataan baru KOSONG terpasang, tidak berbahaya).");
  // 5. gerbang prisma (menggantikan 'tanpa migrasi')
  r('say "1. Sumber kode, ancestry, batas perubahan, tanpa migrasi/schema"', 'say "1. Sumber kode, ancestry, batas perubahan, pin migrasi + diff schema, pemindai DDL (+ uji negatif pemindai)"');
  potong("[ -z \"$(printf '%s\\n' \"$CHANGED\" | grep -E '^backend/prisma/' || true)\" ]", '\nPHASE="2-audit-produksi"', lf(blok["gate-prisma"]).replace("@@SCAN_JS@@", () => lf(scanJs).trimEnd()).trimEnd() + "\n");
  // 6. struktur + keadaan production
  r('ok "prasyarat: rilis ini tidak bergantung pada migrasi baru dan tidak menulis data bisnis"', lf(blok.struktur).trimEnd() + "\n" + lf(blok.keadaan).trimEnd());
  // 7. teks fitur di bundel web
  potong('for s1 in "Buka pekerjaan"', "\nfor s2 in", `for s1 in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: \${s1}"; done`);
  r('for s2 in "Koreksi Dokumen"', `for s2 in ${DIST_LAMA_TAMBAHAN.map((x) => `"${x}"`).join(" ")} "Koreksi Dokumen"`);
  // 8. rehearsal: migrasi + struktur sebelum uji aplikasi
  potong('dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status', "RPSQL \"$FP_SQL\" | LC_ALL=C sort > \"$BK_DIR/fp-reh-sesudah.txt\"", 'gagal_reh() { reh_drop; die "$@"; }\n' + lf(blok["rehearsal-migrasi"]));
  potong("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\"", "\nREHNODE\n", "<<'REHNODE' > \"$BK_DIR/rehearsal-kelengkapan.log\" 2>&1 || { cat \"$BK_DIR/rehearsal-kelengkapan.log\"; reh_drop; die \"uji Kelengkapan Order Produksi terhadap salinan restore GAGAL (lihat rehearsal-kelengkapan.log)\"; }\n" + lf(rehNode).trimEnd());
  r("# UJI APLIKASI pada SALINAN RESTORE (kode BARU, data produksi nyata, DB sementara): membuka pekerjaan baca-saja; klik ganda manual = satu catatan; stok/Run/QC/jurnal/jadwal/target (termasuk unit Bendrya) tidak berubah. DB dihapus di akhir.", "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): jumlah per kategori, WAKTU RESPONS (daftar, hitungan, filter gabungan, pagination, ekspor, drawer) + deteksi permintaan per unit, skenario tulis (pernyataan, pertentangan, bersamaan, cabut); stok/Material Issue/jurnal/harga/jadwal/Run/status tidak berubah. DB dihapus di akhir.\n" + UJI_TERISOLASI);
  r('-T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<\'REHNODE\'', '-T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<\'REHNODE\'');
  r('ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah uji baca-saja; uji tulis manual dilakukan pada salinan lalu DB sementara dihapus"', 'ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi; uji tulis (pernyataan/pertentangan/bersamaan/cabut) dilakukan HANYA pada salinan lalu DB sementara dihapus"');
  // 8c. guard rollback sesudah skenario (harus menolak) — sebelum DB sementara dihapus
  { const tgt = "\nreh_drop\nok \"rehearsal lulus:"; must(s.split(tgt).length === 2, "penanda reh_drop akhir"); s = s.replace(tgt, () => "\n" + lf(blok["rehearsal-guard"]).trimEnd() + tgt); }
  // 9. migrasi produksi
  potong('PHASE="6-tanpa-migrasi"', '\nPHASE="7-switch"', lf(blok.step6).trimEnd() + "\n");
  // 10. verifikasi pasca-switch
  r('ok "${NBE} berkas backend di container = kandidat (byte-identik)"', 'ok "${NBE} berkas backend di container = kandidat (byte-identik)"\nPSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }\nstruktur_baru PSQLN die\nok "objek rilis terpasang di produksi: struktur persis (1 FK RESTRICT, 4 CHECK, 4 indeks [3 unik, 1 parsial]) tervalidasi; tanpa trigger"\n' + lf(blok["isi-pasca-switch"]).trimEnd() + '\n' + lf(blok["guard-pasca"]).trimEnd());
  // 11. smoke
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  const m = s.match(/PHASE="8b-smoke"; say "[^\n]*\n/); must(m, "PHASE 8b");
  s = s.replace(m[0], () => 'PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin (401/403), hitungan kelengkapan = total filter di daftar, filter gabungan + urut terlama, drawer = daftar, ekspor, periode terbalik 400, penulisan ditolak sebelum menyentuh data; tabel rilis tetap kosong; tidak ada jejak tulis"\n');
  const ms = s.match(/ok "smoke test lulus \([^\n]*\n/); must(ms, "ok smoke");
  s = s.replace(ms[0], () => 'ok "smoke test lulus (izin, hitungan = daftar, filter, drawer, ekspor, penulisan ditolak, isi tabel rilis dibaca aktual dan tidak berubah, tanpa jejak tulis, invarian)"\n');
  const iCat = s.lastIndexOf('say "CATATAN:'); must(iCat > 0, "CATATAN");
  s = s.slice(0, iCat) + 'say "CATATAN: Rilis ini membawa penyaring Kelengkapan Order Produksi (Bahan belum dicatat / perlu dicek / HPP belum lengkap / Data order kurang) + pernyataan tanpa bahan baru. Migrasi aditif: 1 tabel pernyataan (isi dibaca aktual, tidak diasumsikan kosong). Rilis TIDAK membuat pernyataan massal, stok, Material Issue, Run, jadwal, status, biaya, jurnal, atau harga. Rollback kode: jalankan scripts/rollback-guard-kelengkapan.sh dulu (peringatan + snapshot; rollback rutin diperbolehkan)."\n';
  // ── GERBANG IDENTITAS KODE LIVE + hotfix tetap ada + hitung baris + tanpa pembersihan (rilis di atas baseline e7883bc6) ──
  const PH2 = 'PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"';
  r(PH2, lf(blok["gerbang-kode-live"]).trimEnd() + '\n\n' + PH2);
  r('[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHA:0:8}; produksi bergeser — berhenti"', '# marker TIDAK dipakai sebagai bukti identitas: gerbang_kode_live (di atas) membandingkan ISI kode live dengan snapshot baseline');
  const OKREL = 'ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT}); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"';
  r(OKREL, 'ok "release aktif ${PREV_DIR} (marker ${PREV_COMMIT}); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"\nPREV_STARTED="$(docker inspect -f \'{{.State.StartedAt}}\' "$CID_OLD")"\ngerbang_kode_live "fase-2-audit"');
  const TAGLINE = 'docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"';
  r(TAGLINE, TAGLINE + '\n[ "$(docker image inspect -f \'{{.Id}}\' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ] || die "tag rollback tidak menunjuk image live"\nok "tujuan rollback = image live ${PREV_IMG_ID:7:12} + folder ${PREV_DIR} (memuat hotfix performa, penjadwalan, drawer, PO barang mirip; terbukti gerbang kode live)"');
  r('@@HITUNG_PRA@@', lf(blok["hitung-pra"]).trimEnd());
  const PH7 = 'PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"';
  r(PH7, PH7 + '\ntidak_ada_deploy_lain_lagi\ngerbang_kode_live "fase-7-tepat-sebelum-switch"');
  const PH8 = 'PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja)"';
  r(PH8, PH8 + '\n' + lf(blok["verifikasi-hotfix"]).trimEnd());
  const m8b = s.match(/PHASE="8b-smoke"; say "[^\n]*\n/); must(m8b, 'PHASE 8b (hitung pasca)');
  s = s.replace(m8b[0], () => lf(blok["hitung-pasca"]).trimEnd() + '\n' + m8b[0]);
  potong('PHASE="9-pembersihan"; say', 'trap - EXIT\nsay "SELESAI', 'PHASE="9-pembersihan"; say "9. Pembersihan release lama DINONAKTIFKAN (folder hotfix dan release lama TIDAK dihapus)"\nok "tidak ada folder release/image/backup/volume yang dihapus oleh skrip ini; disk: $(df -h "$HOME" | awk \'NR==2{print $4" bebas"}\')"\n');
  s = s.split("rehearsal-koreksi.log").join("rehearsal-kelengkapan.log"); // sisa nama berkas log dari kerangka dasar
  s = terapkanKunci(s, blok);
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  s = lf(s); // checkout Windows (autocrlf) dapat membuat templat CRLF; keluaran SELALU LF (yang dikirim ke VPS dan di-commit)
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: berkas.filter((f) => f.startsWith("backend/src/")).length, frontendSrc: berkas.filter((f) => f.startsWith("frontend/src/")).length, mig: mig.name, migSha: sha(lf(mig.sql)).slice(0, 12), scanExpect, schemaSha: schemaSha.slice(0, 12), objek: { idx: ob.idx.length, parsial: ob.parsial.length, chk: ob.chk.length, fk: ob.fk.length, trg: ob.trg.length } } };
}

function berkasBerbeda(base) {
  let ref = base, belumGabung = false;
  try { execFileSync("git", ["merge-base", "--is-ancestor", base, "HEAD"], { cwd: REPO, stdio: "ignore" }); } catch { ref = gitLines(["merge-base", "HEAD", base])[0]; belumGabung = true; }
  const list = new Set([...gitLines(["diff", "--name-only", ref]), ...gitLines(["ls-files", "-o", "--exclude-standard"]).filter((f) => !/^backend\/(data|uploads)\//.test(f))]);
  return { list: [...list], ref, belumGabung };
}

function main() {
  const arg = process.argv.slice(2); const iBase = arg.indexOf("--base"); const base = iBase >= 0 ? arg[iBase + 1] : "origin/main"; const cek = arg.includes("--check");
  const semuaMig = fs.readdirSync(path.join(REPO, "backend/prisma/migrations"));
  const d = semuaMig.filter((n) => n.endsWith(MIG_SUFIKS) && /^\d{14}_/.test(n)); must(d.length === 1, `harus tepat 1 migrasi *${MIG_SUFIKS}, ditemukan: ${d.join(",") || "tidak ada"}`);
  const mig = { name: d[0], sql: fs.readFileSync(path.join(REPO, "backend/prisma/migrations", d[0], "migration.sql"), "utf8") };
  const { list, ref, belumGabung } = berkasBerbeda(base);
  must(!belumGabung, `HEAD belum memuat ${base}: gabungkan baseline live terlebih dulu`);
  const scanJs = fs.readFileSync(path.join(REPO, LIB_SCAN), "utf8");
  const bersih = lf(mig.sql).split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n") + "\n";
  const scanExpect = execFileSync(process.execPath, [path.join(REPO, LIB_SCAN)], { cwd: REPO, encoding: "utf8", input: bersih }).trim();
  const blok = Object.fromEntries([...TPL_FILES, ...TPL_GERBANG].map((f) => [path.basename(f, ".txt"), fs.readFileSync(path.join(REPO, f), "utf8")]));
  const hasil = bangkitkan({
    baseScript: git(["show", `HEAD:${BASE_SCRIPT}`]), blok, berkasList: list, mig, schemaSha: schemaDiffSha(ref), scanJs, scanExpect,
    rehNode: fs.readFileSync(path.join(REPO, LIB_REH), "utf8"), smokeNode: fs.readFileSync(path.join(REPO, LIB_SMOKE), "utf8"),
  });
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
module.exports = { bangkitkan, schemaDiffSha, namaObjek };
if (require.main === module) main();
