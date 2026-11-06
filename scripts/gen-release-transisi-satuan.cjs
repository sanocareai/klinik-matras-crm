// Generator skrip rilis bergerbang "Transisi satuan bahan" (BACKEND-SAJA + 1 migrasi ADITIF: 2 kolom nullable di stock_movements, 1 tabel dokumen KOSONG, 3 fungsi + 3 trigger).
// Hasil: scripts/release-transisi-satuan.sh — diturunkan dari scripts/release-master-bertautan.sh (kerangka rilis backend-saja yang sudah live: gerbang identitas kode live, penguncian bersama berbasis kepemilikan proses,
// backup + rehearsal restore, switch satu kali, smoke, tanpa pembersihan, gerbang disk) + templat scripts/templates/release-transisi-satuan/* + pustaka scripts/lib/{rehearsal,smoke}-transisi-satuan.mjs.
// Semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend, pin sha256 migrasi, pin diff schema.prisma, hasil pemindai DDL) dihitung dari git/berkas terhadap --base.
//
//   node scripts/gen-release-transisi-satuan.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-transisi-satuan.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const MIG_SUFIKS = "_transisi_satuan_bahan";
const BASE_SCRIPT = "scripts/release-master-bertautan.sh";
const OUT = "scripts/release-transisi-satuan.sh";
const TPL_DIR = "scripts/templates/release-transisi-satuan";
const LIB_REH = "scripts/lib/rehearsal-transisi-satuan.mjs", LIB_SMOKE = "scripts/lib/smoke-transisi-satuan.mjs";
const GENERATOR = "scripts/gen-release-transisi-satuan.cjs";
const TPL_FILES = ["header", "vars", "struktur", "gate-prisma", "keadaan", "rehearsal-migrasi", "step6", "rollback"].map((n) => `${TPL_DIR}/${n}.txt`);
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE, ...TPL_FILES];
const CAND_BRANCH = "feat/transisi-satuan-bahan-on-5acf24db";
const BE_WAJIB = ["backend/src/routes/inventory.js", "backend/src/services/inventoryLedger.js", "backend/src/services/nilaiPersediaan.js", "backend/src/services/transisiSatuanBahan.js"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
const baca = (rel) => lf(fs.readFileSync(path.join(REPO, rel), "utf8"));

const COUNT_EXTRA = " union all select 'transisi_satuan', count(*) from material_unit_transitions union all select 'gerak_bersatuan', count(*) from stock_movements where unit_at_entry is not null";

// Diff schema.prisma baseline→HEAD yang sama persis dengan yang dihitung skrip rilis (sg diff -U0 | buang 'index ' | normalkan hunk | { cat; echo; } | sha256sum).
function schemaDiffSha(ref) {
  const keluar = git(["diff", "-U0", "--no-color", ref, "HEAD", "--", "backend/prisma/schema.prisma"]);
  const d = keluar.split("\n").filter((l) => !l.startsWith("index ")).map((l) => l.replace(/^@@ [^@]*@@.*$/, "@@")).join("\n");
  return sha(d + "\n");
}
const namaObjek = (sql) => {
  const ambil = (re) => [...sql.matchAll(re)].map((m) => m[1]);
  return { fk: ambil(/CONSTRAINT "([a-z0-9_]+)" FOREIGN KEY/g), chk: ambil(/CONSTRAINT "([a-z0-9_]+)" CHECK/g), trg: ambil(/CREATE TRIGGER "?([a-z0-9_]+)"?/g), fn: ambil(/CREATE OR REPLACE FUNCTION "?([a-z0-9_]+)"?\(/g) };
};
// Hasil pemindai DDL: fungsi pindai_migrasi dari templat gate-prisma dijalankan dengan bash terhadap isi migrasi (sama persis dengan yang dijalankan skrip rilis).
function hasilPemindai(gatePrisma, sql) {
  const a = gatePrisma.indexOf("sql_bersih()"); const b = gatePrisma.indexOf("HASIL_SCAN=", a); must(a >= 0 && b > a, "fungsi pemindai di gate-prisma");
  const prog = gatePrisma.slice(a, b) + "ALL_SQL=\"$(tr -d '\\r')\"\nprintf '%s\\n' \"$ALL_SQL\" | pindai_migrasi\n";
  return execFileSync("bash", ["-c", prog], { cwd: REPO, encoding: "utf8", input: sql }).trim();
}

function bangkitkan({ baseScript, blok, berkasList, mig, schemaSha, scanExpect, rehNode, smokeNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const gantiBaris = (awalan, baru) => { const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith(awalan)); must(i >= 0, "baris berawalan: " + awalan.slice(0, 70)); L[i] = baru; s = L.join("\n"); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); must(i >= 0, "awal blok: " + awal.slice(0, 70)); const j = s.indexOf(akhir, i + awal.length); must(j > i, "akhir blok: " + akhir.slice(0, 70)); s = s.slice(0, i) + ganti + s.slice(j); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  const prismaOk = ["backend/prisma/schema.prisma", `backend/prisma/migrations/${mig.name}/migration.sql`];
  for (const p of prismaOk) must(berkas.includes(p), "berkas prisma tidak ada di diff: " + p);
  must(!berkas.some((f) => /^backend\/prisma\//.test(f) && !prismaOk.includes(f)), "perubahan prisma lain di luar schema + migrasi rilis");
  must(!berkas.some((f) => /^frontend\//.test(f)), "rilis ini BACKEND-SAJA: ada perubahan frontend");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.includes("backend/src/index.js"), "backend/src/index.js tidak boleh berubah");
  for (const wajib of BE_WAJIB) must(berkas.includes(wajib), "berkas wajib rilis tidak berbeda dari baseline: " + wajib);
  must(be === [...BE_WAJIB].sort().join(" "), "daftar backend/src harus tepat " + BE_WAJIB.join(", ") + " (ada: " + be + ")");
  const ob = namaObjek(mig.sql);
  must(ob.fk.length === 1 && ob.chk.length === 3 && ob.trg.length === 3 && ob.fn.length === 3, "objek rilis tidak seperti yang diaudit (1 FK, 3 CHECK, 3 trigger, 3 fungsi): " + JSON.stringify(ob));

  // 1. header
  { const i = s.indexOf('# RILIS "MASTER BARU'); const j = s.indexOf("set -Eeuo pipefail", i); must(i >= 0 && j > i, "header"); s = s.slice(0, i) + lf(blok.header) + s.slice(j); }
  r("feat/master-bertautan-atomik-on-e992be28", CAND_BRANCH);
  // 2. variabel + allowlist
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  const vars = lf(blok.vars).replace("@@MIG_NAME@@", () => mig.name).replace("@@MIG_PIN@@", () => sha(mig.sql)).replace("@@SCAN_EXPECT@@", () => scanExpect).replace("@@SCHEMA_DIFF_SHA@@", () => schemaSha).trimEnd();
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT=""`; L.splice(ia + 3, 0, vars);
  s = L.join("\n");
  gantiBaris("# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma;", "# Rilis backend + 1 migrasi aditif (diaudit, dipin sha256): apa pun di backend/prisma di luar migrasi rilis + schema.prisma = berhenti; OTA RN TIDAK diterbitkan.");
  gantiBaris("# Berkas yang BOLEH berbeda dari baseline:", "# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti (backend/prisma: hanya migrasi rilis + schema.prisma).");
  // 3. nama kunci/backup/tag/DB sementara khusus rilis ini
  r("release-master-bertautan.lock", "release-transisi-satuan.lock"); r("pre-master-bertautan-", "pre-transisi-satuan-"); r("master-bertautan-${DEPLOY_SHORT}", "transisi-satuan-${DEPLOY_SHORT}"); r("rollback-pre-mba-", "rollback-pre-tsb-"); r("rehearsal_mba_", "rehearsal_tsb_");
  // 4. instruksi rollback
  potong("Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya:", "─────────────────────────────────────────────────────────────────────────\nEOF", lf(blok.rollback).trimEnd() + "\n");
  r("Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.", "Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (bila sudah lewat tahap migrasi: struktur aditif terpasang, tabel dokumen KOSONG, tidak berbahaya bagi kode lama).");
  // 5. gerbang sumber: pin migrasi + diff schema + pemindai DDL (menggantikan 'tanpa migrasi')
  r('say "1. Sumber kode, ancestry, batas perubahan, tanpa migrasi/schema"', 'say "1. Sumber kode, ancestry, batas perubahan, pin migrasi + diff schema (murni tambahan), pemindai DDL (+ uji negatif pemindai)"');
  potong("[ -z \"$(printf '%s\\n' \"$CHANGED\" | grep -E '^backend/prisma/' || true)\" ]", "\n\n# ── GERBANG IDENTITAS KODE LIVE", lf(blok["gate-prisma"]).trimEnd() + "\nok \"kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\\n' \"$CHANGED\" | wc -l) berkas dalam allowlist eksplisit\"");
  // 6. struktur + keadaan production
  r('ok "prasyarat: rilis ini tidak bergantung pada migrasi baru dan tidak menulis data bisnis"', lf(blok.struktur).trimEnd() + "\n" + lf(blok.keadaan).trimEnd());
  // 7. rehearsal: migrate deploy pada salinan restore (menggantikan 'migrate status' tanpa migrasi)
  potong('dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status', 'RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt"', lf(blok["rehearsal-migrasi"]).trimEnd() + "\n");
  gantiBaris("# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): ", "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): rute transisi satuan (pratinjau, hash, atomik, riwayat per satuan, harga lama tidak dibawa, pengaman historis, izin, idempotensi) — hanya pada salinan restore, dibuang sesudahnya.");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).replace('"@@SMOKE_SRC@@"', () => JSON.stringify(lf(smokeNode))).trimEnd() + s.slice(j); }
  r("uji master-bertautan terhadap salinan restore GAGAL", "uji transisi satuan terhadap salinan restore GAGAL");
  r("isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; uji tulis rute master-bertautan dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca lalu DB sementara dihapus", "isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi; uji tulis transisi satuan dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca lalu DB sementara dihapus");
  // 8. migrasi production sebelum switch (menggantikan 'tanpa migrasi')
  potong('PHASE="6-tanpa-migrasi"', '\nCOUNT_SQL="', lf(blok.step6).trimEnd());
  r("migrate status produksi (image baru) TIDAK 'up to date' — rilis ini harus tanpa migrasi", "migrate status produksi (image baru) TIDAK 'up to date' setelah tahap migrasi");
  r('ok "tidak ada migrasi pending; skema produksi sudah sesuai image baru"', 'ok "tidak ada migrasi pending; skema produksi sudah sesuai image baru (struktur transisi satuan terpasang)"');
  { const l0 = s.split("\n").find((l) => l.startsWith('COUNT_SQL="')); must(!!l0, "COUNT_SQL"); gantiBaris('COUNT_SQL="', l0.replace(/"\s*$/, COUNT_EXTRA + '"')); }
  r("hitung baris stok/biaya beku/harga/penyesuaian/GR/persediaan awal/pengaturan Finance/hasil SO/jurnal/master/tautan SO", "hitung baris stok/biaya beku/harga/penyesuaian/GR/persediaan awal/pengaturan Finance/hasil SO/jurnal/master/tautan SO/transisi satuan/pergerakan bersatuan");
  // 9. verifikasi pasca-switch: struktur terpasang di production
  r('ok "${NBE} berkas backend di container = kandidat (byte-identik)"', 'ok "${NBE} berkas backend di container = kandidat (byte-identik)"\nPSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }\nstruktur_baru PSQLN die\nok "objek rilis terpasang di production: 2 kolom nullable, 1 tabel dokumen (KOSONG), 1 FK RESTRICT, 3 CHECK, 3 indeks, 3 fungsi + 3 trigger tervalidasi; tidak ada transisi dijalankan oleh rilis"');
  // 10. smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke: rute transisi satuan ada dan dijaga (401/403/400/428 sebelum menulis), riwayat satuan terbaca, TANPA menjalankan transisi dan TANPA perubahan jumlah baris"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (transisi satuan: rute dijaga, tanpa jejak tulis)"');
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa rute transisi satuan bahan (pratinjau + terapkan, penyetuju) dan riwayat satuan, serta 1 migrasi aditif (tabel dokumen KOSONG; pergerakan lama tidak diisi ulang). Skrip rilis TIDAK menjalankan transisi apa pun: satuan bahan, saldo, harga, PO/GR, jurnal, dan tautan SO tidak berubah. Transisi dijalankan sesudah rilis oleh Owner lewat rute itu dengan pratinjau baru dan persetujuan hash terpisah."');
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  const sisa = s.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !l.startsWith("#") && /master-bertautan|\bmba\b|KAYU RACUK|master baru|nilai-pisah/i.test(l)).map(([i, l]) => `${i}:${l.slice(0, 70)}`);
  must(sisa.length === 0, "nama/isi rilis lama tersisa pada baris: " + sisa.join(" | "));
  return { script: lf(s), ringkasan: { berkas: berkas.length, backendSrc: berkas.filter((f) => f.startsWith("backend/src/")).length, mig: mig.name, migSha: sha(mig.sql).slice(0, 12), scanExpect, schemaSha: schemaSha.slice(0, 12), objek: { fk: ob.fk.length, chk: ob.chk.length, trg: ob.trg.length, fn: ob.fn.length } } };
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
  const sqlMentah = fs.readFileSync(path.join(REPO, "backend/prisma/migrations", d[0], "migration.sql"), "utf8");
  const mig = { name: d[0], sql: lf(sqlMentah).replace(/\n+$/, "") + "\n" };
  must(lf(sqlMentah) === mig.sql, "migrasi harus diakhiri TEPAT satu baris baru (pin sha256 dihitung skrip rilis dari $(...) + newline)");
  const { list, ref, belumGabung } = berkasBerbeda(base);
  must(!belumGabung, `HEAD belum memuat ${base}: gabungkan baseline live terlebih dulu`);
  const blok = Object.fromEntries(TPL_FILES.map((f) => [path.basename(f, ".txt"), fs.readFileSync(path.join(REPO, f), "utf8")]));
  const scanExpect = hasilPemindai(lf(blok["gate-prisma"]), mig.sql);
  must(!/^TERLARANG/.test(scanExpect) && /^add_col=2\|/.test(scanExpect), "pemindai DDL menolak migrasi rilis / hitungan tak terduga: " + scanExpect);
  const hasil = bangkitkan({
    baseScript: git(["show", `HEAD:${BASE_SCRIPT}`]), blok, berkasList: list, mig, schemaSha: schemaDiffSha(ref), scanExpect,
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
module.exports = { bangkitkan, schemaDiffSha, namaObjek, hasilPemindai };
if (require.main === module) main();
