// Generator skrip rilis bergerbang "Akuisisi — biaya iklan tingkat sumber" (backend + web + 1 migrasi ADITIF: 2 tabel baru kosong).
// Hasil: scripts/release-akuisisi-biaya.sh — diturunkan dari scripts/release-status-kerja-buka-pekerjaan.sh (kerangka rilis bergerbang yang sudah live) + blok-blok di scripts/templates/release-akuisisi-biaya/*
// + pustaka scripts/lib/{scan-migrasi,rehearsal,rehearsal-kompat-lama,smoke}-akuisisi-biaya.mjs + constraint-akuisisi-biaya.sql. Semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend/frontend, pin sha256 migrasi, pin diff schema.prisma, hasil pemindai DDL,
// nama objek rilis) dihitung dari git terhadap --base. Tidak ada nilai manual selain konstanta di bawah.
//
//   node scripts/gen-release-akuisisi-biaya.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-akuisisi-biaya.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const MIG_SUFIKS = "_biaya_iklan_sumber_manual";
const BASE_SCRIPT = "scripts/release-status-kerja-buka-pekerjaan.sh";
const OUT = "scripts/release-akuisisi-biaya.sh";
const TPL_DIR = "scripts/templates/release-akuisisi-biaya";
const LIB_SCAN = "scripts/lib/scan-migrasi-akuisisi-biaya.mjs", LIB_REH = "scripts/lib/rehearsal-akuisisi-biaya.mjs", LIB_SMOKE = "scripts/lib/smoke-akuisisi-biaya.mjs";
const LIB_LAMA = "scripts/lib/rehearsal-kompat-lama-akuisisi-biaya.mjs", LIB_CONS = "scripts/lib/constraint-akuisisi-biaya.sql", LIB_HASH = "scripts/lib/hash-live-akuisisi-biaya.mjs";
const GUARD = "scripts/rollback-guard-akuisisi-biaya.sh", GENERATOR = "scripts/gen-release-akuisisi-biaya.cjs";
const TPL_FILES = ["header", "vars", "struktur", "gate-prisma", "keadaan", "rehearsal-migrasi", "rehearsal-lama", "step6", "live-konsisten", "spa", "rollback"].map((n) => `${TPL_DIR}/${n}.txt`);
const FILE_TETAP = [OUT, GUARD, GENERATOR, LIB_SCAN, LIB_REH, LIB_SMOKE, LIB_LAMA, LIB_CONS, LIB_HASH, ...TPL_FILES];
const CAND_BRANCH = "feat/akuisisi-biaya-navigasi";
const DIST_BARU = ["Kelola biaya iklan", "Atribusi label CRM", "Impor detail Ad", "Total rentang", "Sumber biaya yang dipakai", "Detail Ad mungkin parsial", "Biaya terisi setiap hari", "Verifikasi kelengkapan"];
const DIST_LAMA_TAMBAHAN = ["Performa Akuisisi", "Customer ber-order", "Perbandingan sumber"];

const PER_LINES = 'PER_SAMPAI="$(date -u -d "@$(( $(date +%s) + 25200 - 86400 ))" +%F)"; PER_DARI="$(date -u -d "@$(( $(date +%s) + 25200 - 86400 * 30 ))" +%F)"   # 30 hari PENUH berakhir kemarin (WIB)';
const lf = (t) => t.replace(/\r\n/g, "\n");
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
  const unik = ambil(/CREATE UNIQUE INDEX "([a-z0-9_]+)"/g);
  return { idx: [...pkeys, ...idx], unik, chk: ambil(/CONSTRAINT "([a-z0-9_]+)" CHECK/g), fk: ambil(/CONSTRAINT "([a-z0-9_]+)" FOREIGN KEY/g), trg: ambil(/CREATE TRIGGER "([a-z0-9_]+)"/g) };
};

function bangkitkan({ baseScript, blok, berkasList, mig, schemaSha, scanJs, scanExpect, rehNode, smokeNode, lamaJs, constraintSql, hashJs }) {
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
  must(!berkas.includes("backend/src/index.js"), "backend/src/index.js tidak boleh berubah");
  const ob = namaObjek(mig.sql);
  must(ob.idx.length === 5 && ob.fk.length === 1 && ob.chk.length === 8 && ob.trg.length === 1 && ob.unik.length === 2, "objek rilis tidak seperti yang diaudit (5 indeks incl. 2 PK, 1 FK, 8 CHECK, 1 trigger, 2 indeks unik)");

  // 1. header
  potong("# RILIS \"STATUS KERJA JUJUR", "set -Eeuo pipefail", blok.header);
  // 2. variabel
  r('CAND_BRANCH="${CAND_BRANCH:-fix/status-kerja-buka-pekerjaan}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0, "ALLOWED_RE");
  const vars = lf(blok.vars).replace("@@MIG_NAME@@", () => mig.name).replace("@@MIG_PIN@@", () => sha(lf(mig.sql))).replace("@@SCAN_EXPECT@@", () => scanExpect).replace("@@SCHEMA_DIFF_SHA@@", () => schemaSha)
    .replace("@@IDX_BARU@@", ob.idx.join(" ")).replace("@@IDX_UNIK@@", ob.unik.join(" ")).replace("@@CHK_BARU@@", ob.chk.join(" ")).replace("@@FK_BARU@@", ob.fk.join(" ")).replace("@@TRG_BARU@@", ob.trg.join(" ")).trimEnd();
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`; L.splice(ia + 3, 0, vars);
  s = L.join("\n");
  // 3. nama
  r("status-kerja-${DEPLOY_SHORT}-${TS}", "akuisisi-biaya-${DEPLOY_SHORT}-${TS}"); r("pre-status-kerja-", "pre-akuisisi-biaya-"); r("rehearsal_status_kerja_", "rehearsal_akuisisi_biaya_");
  r("/tmp/release-status-kerja-buka-pekerjaan.lock", "/tmp/release-akuisisi-biaya.lock"); r("sk1\\|release-status-kerja-buka-pekerjaan\\|pgrep", "ab1\\|release-akuisisi-biaya\\|pgrep");
  // 4. instruksi rollback
  potong("Rilis ini TANPA migrasi dan TANPA tulisan data bisnis:", "─────────────────────────────────────────────────────────────────────────\nEOF", lf(blok.rollback).trimEnd() + "\n");
  r("Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.", "Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (bila sudah lewat tahap migrasi: 2 tabel baru KOSONG terpasang, tidak berbahaya).");
  // 5. gerbang prisma (menggantikan 'tanpa migrasi')
  r('say "1. Sumber kode, ancestry, batas perubahan, tanpa migrasi/schema"', 'say "1. Sumber kode, ancestry, batas perubahan, pin migrasi + diff schema (murni tambahan), pemindai DDL (+ uji negatif pemindai)"');
  potong("[ -z \"$(printf '%s\\n' \"$CHANGED\" | grep -E '^backend/prisma/' || true)\" ]", '\nPHASE="2-audit-produksi"', lf(blok["gate-prisma"]).replace("@@SCAN_JS@@", () => lf(scanJs).trimEnd()).trimEnd() + "\n");
  // 6. struktur + keadaan production
  r('ok "prasyarat: rilis ini tidak bergantung pada migrasi baru dan tidak menulis data bisnis"', lf(blok.struktur).trimEnd() + "\n" + lf(blok.keadaan).trimEnd());
  // 7. teks fitur di bundel web
  potong('for s1 in "Buka pekerjaan"', "\nfor s2 in", `for s1 in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: \${s1}"; done`);
  r('for s2 in "Koreksi Dokumen"', `for s2 in ${DIST_LAMA_TAMBAHAN.map((x) => `"${x}"`).join(" ")} "Koreksi Dokumen"`);
  // 8. rehearsal: migrasi + struktur sebelum uji aplikasi
  potong('dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status', "RPSQL \"$FP_SQL\" | LC_ALL=C sort > \"$BK_DIR/fp-reh-sesudah.txt\"", 'gagal_reh() { reh_drop; die "$@"; }\n' + lf(blok["rehearsal-migrasi"]).replace("@@CONSTRAINT_SQL@@", () => lf(constraintSql).trimEnd()));
  s = s.replace(/-e DATABASE_URL="postgresql:\/\/\$\{DB_USER\}:\$\{REH_PW\}@postgres:5432\/\$\{REH_DB\}" backend node --input-type=module -/, (m) => m.replace(" backend node", ' -e PER_DARI="$PER_DARI" -e PER_SAMPAI="$PER_SAMPAI" backend node'));
  potong("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\"", "\nREHNODE\n", "<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\" 2>&1 || { cat \"$BK_DIR/rehearsal-koreksi.log\"; reh_drop; die \"uji Akuisisi biaya terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)\"; }\n" + lf(rehNode).trimEnd());
  r("# UJI APLIKASI pada SALINAN RESTORE (kode BARU, data produksi nyata, DB sementara): membuka pekerjaan baca-saja; klik ganda manual = satu catatan; stok/Run/QC/jurnal/jadwal/target (termasuk unit Bendrya) tidak berubah. DB dihapus di akhir.", "# UJI APLIKASI pada SALINAN RESTORE (kode BARU, data produksi nyata, DB sementara): izin, validasi, periode, rekonsiliasi SQL independen, input biaya (idempoten/ubah/batal/konflik), detail Ad parsial/override/pencabutan; tabel lama tidak berubah. DB dihapus di akhir.\n" + PER_LINES);
  r('ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah uji baca-saja; uji tulis manual dilakukan pada salinan lalu DB sementara dihapus"', 'ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi; uji tulis biaya manual (idempoten/ubah/batal/konflik/override) + uji KODE LAMA dilakukan pada salinan lalu DB sementara dihapus"');
  r("reh_drop\nok \"rehearsal lulus:", lf(blok["rehearsal-lama"]).replace("@@LAMA_JS@@", () => lf(lamaJs).trimEnd()).trimEnd() + "\nreh_drop\nok \"rehearsal lulus:");
  // 9. migrasi produksi
  potong('PHASE="6-tanpa-migrasi"', '\nPHASE="7-switch"', lf(blok.step6).trimEnd() + "\n");
  // 10. verifikasi pasca-switch
  r('ok "${NBE} berkas backend di container = kandidat (byte-identik)"', 'ok "${NBE} berkas backend di container = kandidat (byte-identik)"\nPSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }\nstruktur_baru PSQLN die\nok "objek rilis terpasang di produksi: 2 tabel (biaya sumber + revisi) — kosong; 1 FK RESTRICT, 8 CHECK, indeks (2 unik), trigger append-only tervalidasi"');
  // 11. smoke
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  const m = s.match(/PHASE="8b-smoke"; say "[^\n]*\n/); must(m, "PHASE 8b");
  s = s.replace(m[0], () => 'PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin (401/403), validasi + dryRun tanpa menulis, periode/parameter, kontrak /sumber, rekonsiliasi SQL independen, deep-link URL laporan; tabel biaya tetap kosong; tidak ada jejak tulis"\n');
  const ms = s.match(/ok "smoke test lulus \([^\n]*\n/); must(ms, "ok smoke");
  s = s.replace(ms[0], () => 'ok "smoke test lulus (izin 401/403, validasi + dryRun tanpa menulis, periode/parameter, kontrak, rekonsiliasi SQL independen, tabel biaya kosong, tanpa jejak tulis, invarian)"\n');
  const iCat = s.lastIndexOf('say "CATATAN:'); must(iCat > 0, "CATATAN");
  s = s.slice(0, iCat) + 'say "CATATAN: Rilis ini membawa Akuisisi: periode tunggal, biaya iklan tingkat sumber (input manual), navigasi sumber, logo. Migrasi aditif: 2 tabel baru KOSONG. TIDAK ada biaya iklan yang diimpor/ditulis oleh rilis; tidak ada perubahan campaign/budget Meta, pembayaran, jurnal, stok, atau label customer. Rollback kode: jalankan scripts/rollback-guard-akuisisi-biaya.sh dulu (informasi), lalu langkah rollback di atas."\n';
  r('OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"', lf(blok["live-konsisten"]).replace("@@HASH_JS@@", () => lf(hashJs).trimEnd()).trimEnd() + "\n" + lf(blok.spa).trimEnd() + '\nOLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"');
  // env: sidik jari sebelum rilis (dibandingkan sesudah switch di blok live-konsisten)
  r(`grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"`, `grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"\nENV_SHA_SEBELUM="$(sha256sum "$PERSIST/backend/.env" "$PERSIST/frontend/.env" | awk '{print $1}' | tr '\\n' ' ')"`);
  // waktu switch (untuk smoke: inbound baru sesudah switch) + diteruskan ke smoke
  r('PHASE="7-switch";', 'SWITCH_AT_ISO="$(date -u +%FT%TZ)"\nPHASE="7-switch";');
  r('exec -T -e BASE_TIDAK_SEIMBANG=', 'exec -T -e SWITCH_AT_ISO="$SWITCH_AT_ISO" -e BASE_TIDAK_SEIMBANG=');
  // CLEANUP RILIS LAMA DINONAKTIFKAN (permintaan Owner 26 Okt): tidak ada direktori/image/backup yang dihapus oleh langkah ini
  potong("# Pembersihan release lama (setelah rilis TERBUKTI sehat).", '\ntrap - EXIT\nsay "SELESAI', '# Pembersihan release lama DINONAKTIFKAN untuk rilis ini: tidak ada direktori release, image, atau backup (milik sesi mana pun) yang dihapus oleh skrip ini.\nPHASE="9-tanpa-pembersihan"; say "9. Pembersihan release lama DINONAKTIFKAN (tidak ada release/image/backup yang dihapus)"');
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: berkas.filter((f) => f.startsWith("backend/src/")).length, frontendSrc: berkas.filter((f) => f.startsWith("frontend/src/")).length, mig: mig.name, migSha: sha(lf(mig.sql)).slice(0, 12), scanExpect, schemaSha: schemaSha.slice(0, 12), objek: { idx: ob.idx.length, unik: ob.unik.length, chk: ob.chk.length, fk: ob.fk.length, trg: ob.trg.length } } };
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
  const blok = Object.fromEntries(TPL_FILES.map((f) => [path.basename(f, ".txt"), fs.readFileSync(path.join(REPO, f), "utf8")]));
  const hasil = bangkitkan({
    baseScript: git(["show", `HEAD:${BASE_SCRIPT}`]), blok, berkasList: list, mig, schemaSha: schemaDiffSha(ref), scanJs, scanExpect,
    rehNode: fs.readFileSync(path.join(REPO, LIB_REH), "utf8"), smokeNode: fs.readFileSync(path.join(REPO, LIB_SMOKE), "utf8"), lamaJs: fs.readFileSync(path.join(REPO, LIB_LAMA), "utf8"), hashJs: fs.readFileSync(path.join(REPO, LIB_HASH), "utf8"), constraintSql: fs.readFileSync(path.join(REPO, LIB_CONS), "utf8"),
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
