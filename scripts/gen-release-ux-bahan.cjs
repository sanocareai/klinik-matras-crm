// Generator skrip rilis bergerbang "UX Bahan" (usulan bahan + pemakaian sementara; backend + web + 1 migrasi ADITIF: 2 tabel baru kosong).
// Hasil: scripts/release-ux-bahan.sh — diturunkan dari scripts/release-status-kerja-buka-pekerjaan.sh (kerangka rilis bergerbang yang sudah live) + blok-blok di scripts/templates/release-ux-bahan/*
// + pustaka scripts/lib/{scan,rehearsal,smoke}-ux-bahan.mjs. Semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend/frontend, pin sha256 migrasi, pin diff schema.prisma, hasil pemindai DDL,
// nama objek rilis) dihitung dari git terhadap --base. Tidak ada nilai manual selain konstanta di bawah.
//
//   node scripts/gen-release-ux-bahan.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-ux-bahan.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const MIG_SUFIKS = "_bahan_usulan_pemakaian_sementara";
const BASE_SCRIPT = "scripts/release-status-kerja-buka-pekerjaan.sh";
const OUT = "scripts/release-ux-bahan.sh";
const TPL_DIR = "scripts/templates/release-ux-bahan";
const LIB_SCAN = "scripts/lib/scan-migrasi-ux-bahan.mjs", LIB_REH = "scripts/lib/rehearsal-ux-bahan.mjs", LIB_SMOKE = "scripts/lib/smoke-ux-bahan.mjs";
const GUARD = "scripts/rollback-guard-ux-bahan.sh", GENERATOR = "scripts/gen-release-ux-bahan.cjs";
const TPL_FILES = ["header", "vars", "struktur", "gate-prisma", "keadaan", "rehearsal-migrasi", "step6", "rollback"].map((n) => `${TPL_DIR}/${n}.txt`);
const FILE_TETAP = [OUT, GUARD, GENERATOR, LIB_SCAN, LIB_REH, LIB_SMOKE, ...TPL_FILES];
const CAND_BRANCH = "feat/ux-bahan-usulan-pemakaian-sementara";
const DIST_BARU = ["Bahan belum ada?", "Pemakaian sementara", "Usulan Bahan", "Catat bahan baru dari Gudang", "Perlu rekonsiliasi Gudang", "Simpan koreksi"];
const DIST_LAMA_TAMBAHAN = ["Buka pekerjaan", "Catat pekerjaan selesai", "Tandai sudah dikerjakan"];

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
  must(!berkas.includes("backend/src/index.js"), "backend/src/index.js tidak boleh berubah");
  const ob = namaObjek(mig.sql);
  must(ob.idx.length > 0 && ob.fk.length === 7 && ob.chk.length > 0 && ob.trg.length === 2 && ob.parsial.length === 2, "objek rilis tidak seperti yang diaudit (7 FK, 2 trigger, 2 indeks parsial)");

  // 1. header
  potong("# RILIS \"STATUS KERJA JUJUR", "set -Eeuo pipefail", blok.header);
  // 2. variabel
  r('CAND_BRANCH="${CAND_BRANCH:-fix/status-kerja-buka-pekerjaan}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0, "ALLOWED_RE");
  const vars = lf(blok.vars).replace("@@MIG_NAME@@", () => mig.name).replace("@@MIG_PIN@@", () => sha(lf(mig.sql))).replace("@@SCAN_EXPECT@@", () => scanExpect).replace("@@SCHEMA_DIFF_SHA@@", () => schemaSha)
    .replace("@@IDX_BARU@@", ob.idx.join(" ")).replace("@@IDX_PARSIAL@@", ob.parsial.join(" ")).replace("@@CHK_BARU@@", ob.chk.join(" ")).replace("@@FK_BARU@@", ob.fk.join(" ")).replace("@@TRG_BARU@@", ob.trg.join(" ")).trimEnd();
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`; L.splice(ia + 3, 0, vars);
  s = L.join("\n");
  // 3. nama
  r("status-kerja-${DEPLOY_SHORT}-${TS}", "ux-bahan-${DEPLOY_SHORT}-${TS}"); r("pre-status-kerja-", "pre-ux-bahan-"); r("rehearsal_status_kerja_", "rehearsal_ux_bahan_");
  r("/tmp/release-status-kerja-buka-pekerjaan.lock", "/tmp/release-ux-bahan.lock"); r("sk1\\|release-status-kerja-buka-pekerjaan\\|pgrep", "ub1\\|release-ux-bahan\\|pgrep");
  // 4. instruksi rollback
  potong("Rilis ini TANPA migrasi dan TANPA tulisan data bisnis:", "─────────────────────────────────────────────────────────────────────────\nEOF", lf(blok.rollback).trimEnd() + "\n");
  r("Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.", "Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (bila sudah lewat tahap migrasi: 2 tabel baru KOSONG terpasang, tidak berbahaya).");
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
  potong("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\"", "\nREHNODE\n", "<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\" 2>&1 || { cat \"$BK_DIR/rehearsal-koreksi.log\"; reh_drop; die \"uji UX Bahan terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)\"; }\n" + lf(rehNode).trimEnd());
  r("# UJI APLIKASI pada SALINAN RESTORE (kode BARU, data produksi nyata, DB sementara): membuka pekerjaan baca-saja; klik ganda manual = satu catatan; stok/Run/QC/jurnal/jadwal/target (termasuk unit Bendrya) tidak berubah. DB dihapus di akhir.", "# UJI APLIKASI pada SALINAN RESTORE (kode BARU, data produksi nyata, DB sementara): usulan, keputusan, pemakaian sementara, koreksi, pembatalan, rekonsiliasi; stok/Material Issue/penerimaan/jurnal/Run/QC/jadwal tidak berubah. DB dihapus di akhir.");
  r('ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah uji baca-saja; uji tulis manual dilakukan pada salinan lalu DB sementara dihapus"', 'ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi; uji tulis (usulan/sementara/koreksi/batal/rekonsiliasi) dilakukan pada salinan lalu DB sementara dihapus"');
  // 9. migrasi produksi
  potong('PHASE="6-tanpa-migrasi"', '\nPHASE="7-switch"', lf(blok.step6).trimEnd() + "\n");
  // 10. verifikasi pasca-switch
  r('ok "${NBE} berkas backend di container = kandidat (byte-identik)"', 'ok "${NBE} berkas backend di container = kandidat (byte-identik)"\nPSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }\nstruktur_baru PSQLN die\nok "objek rilis terpasang di produksi: 2 tabel (usulan bahan, pemakaian sementara) — kosong; 7 FK RESTRICT, CHECK, indeks, 2 trigger penjaga tervalidasi"');
  // 11. smoke
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  const m = s.match(/PHASE="8b-smoke"; say "[^\n]*\n/); must(m, "PHASE 8b");
  s = s.replace(m[0], () => 'PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin (401/403), antrean usulan/pemakaian sementara, cek duplikasi, katalog, panel unit, ekspor Excel; tabel rilis tetap kosong; tidak ada jejak tulis"\n');
  const ms = s.match(/ok "smoke test lulus \([^\n]*\n/); must(ms, "ok smoke");
  s = s.replace(ms[0], () => 'ok "smoke test lulus (izin, antrean kosong, panel unit, ekspor Excel, tabel rilis kosong, tanpa jejak tulis, invarian)"\n');
  const iCat = s.lastIndexOf('say "CATATAN:'); must(iCat > 0, "CATATAN");
  s = s.slice(0, iCat) + 'say "CATATAN: Rilis ini membawa fitur UX Bahan (usulan bahan katalog, pemakaian sementara + rekonsiliasi Gudang). Migrasi aditif: 2 tabel baru KOSONG. Tidak ada usulan, pemakaian sementara, bahan, pergerakan stok, jurnal, penerimaan, atau pesan pelanggan yang dibuat/diubah oleh rilis. Rollback kode: jalankan scripts/rollback-guard-ux-bahan.sh dulu."\n';
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
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
  const blok = Object.fromEntries(TPL_FILES.map((f) => [path.basename(f, ".txt"), fs.readFileSync(path.join(REPO, f), "utf8")]));
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
