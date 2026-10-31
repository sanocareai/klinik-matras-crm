// Generator skrip rilis bergerbang "Foto Bahan" (WEB + BACKEND + 1 migrasi ADITIF: dua kolom NULL pada materials, tanpa backfill; index.js TIDAK berubah).
// Hasil: scripts/release-foto-bahan.sh — diturunkan dari scripts/release-harga-dari-po.sh (kerangka rilis bergerbang TERBARU yang sudah live: kunci deploy bersama, gerbang identitas kode live, rehearsal restore nyata, uji pra-switch, tanpa pembersihan)
// + blok di scripts/templates/release-foto-bahan/* + pustaka scripts/lib/{scan-migrasi,rehearsal,smoke,kompat-lama}-foto-bahan.mjs. Semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend/frontend, pin sha256 migrasi,
// pin diff schema.prisma, hasil pemindai DDL) dihitung dari git terhadap --base. Tidak ada nilai manual selain konstanta di bawah.
//
//   node scripts/gen-release-foto-bahan.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-foto-bahan.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const MIG_SUFIKS = "_foto_bahan";
const BASE_SCRIPT = "scripts/release-harga-dari-po.sh";
const OUT = "scripts/release-foto-bahan.sh";
const TPL_DIR = "scripts/templates/release-foto-bahan";
const LIB_SCAN = "scripts/lib/scan-migrasi-foto-bahan.mjs", LIB_REH = "scripts/lib/rehearsal-foto-bahan.mjs", LIB_SMOKE = "scripts/lib/smoke-foto-bahan.mjs", LIB_KOMPAT = "scripts/lib/kompat-lama-foto-bahan.mjs";
const GENERATOR = "scripts/gen-release-foto-bahan.cjs";
const TPL_FILES = ["header", "rollback", "vars", "gate-prisma", "struktur", "keadaan", "disk", "rehearsal-migrasi", "rehearsal-pasca", "step6"].map((n) => `${TPL_DIR}/${n}.txt`);
const FILE_TETAP = [OUT, GENERATOR, LIB_SCAN, LIB_REH, LIB_SMOKE, LIB_KOMPAT, ...TPL_FILES];
const CAND_BRANCH = "feat/foto-bahan-on-60b5df10";
// Teks ASCII di bundel web (esbuild menulis karakter non-ASCII sebagai \uXXXX, jadi hanya awalan ASCII yang dicari). Hanya teks yang TIDAK ada di bundel release aktif (diperiksa skrip: teks baru tidak boleh sudah ada di dist live).
const DIST_BARU = ["Foto bahan", "Foto belum bisa dimuat", "Konfirmasi hapus foto", "Tidak mengubah stok, harga, atau nilai persediaan"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

function schemaDiffSha(ref) {
  const keluar = git(["diff", "-U0", "--no-color", ref, "HEAD", "--", "backend/prisma/schema.prisma"]);
  const d = keluar.split("\n").filter((l) => !l.startsWith("index ")).map((l) => l.replace(/^@@ [^@]*@@.*$/, "@@")).join("\n");
  return sha(d + "\n"); // skrip rilis: { cat; echo; } menambah SATU baris kosong setelah keluaran
}

function bangkitkan({ baseScript, blok, berkasList, mig, schemaSha, scanJs, scanExpect, rehNode, smokeNode, kompatNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); const j = s.indexOf(akhir, i + awal.length); must(i >= 0 && j >= 0, `penanda: ${awal.slice(0, 60)} .. ${akhir.slice(0, 60)}`); s = s.slice(0, i) + ganti + s.slice(j); };
  const gantiBaris = (awalan, baru) => { const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith(awalan)); must(i >= 0, "baris berawalan: " + awalan.slice(0, 70)); L[i] = baru; s = L.join("\n"); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  const fe = berkas.filter((f) => f.startsWith("frontend/src/")).join(" ");
  const prismaOk = ["backend/prisma/schema.prisma", `backend/prisma/migrations/${mig.name}/migration.sql`];
  for (const p of prismaOk) must(berkas.includes(p), "berkas prisma tidak ada di diff: " + p);
  must(!berkas.some((f) => /^backend\/prisma\//.test(f) && !prismaOk.includes(f)), "perubahan prisma lain di luar schema + migrasi rilis");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.includes("backend/src/index.js"), "index.js berubah (dipatok tes kontrak; rilis ini memasang router media lewat inventoryRouter)");
  for (const wajib of ["backend/src/services/fotoBahan.js", "backend/src/routes/materialPhotoMedia.js", "backend/src/routes/inventory.js", "backend/src/services/stokLokasi.js", "frontend/src/features/warehouse/stok/FotoBahan.jsx", "frontend/src/features/warehouse/stok/fotoBahanLogic.js", "frontend/src/features/warehouse/components/ItemDetailDrawer.jsx", "frontend/src/api.js", "backend/scripts/uji-foto-bahan-persisten.mjs", "backend/scripts/rekonsiliasi-foto-bahan.mjs"]) must(berkas.includes(wajib), "berkas inti rilis tidak ada di diff: " + wajib);
  must(!berkas.some((f) => /^backend\/src\/(routes\/(analytics|conversations)|middleware\/cacheSingkat)\.js$|^frontend\/src\/pages\/Laporan\.jsx$/.test(f)), "rilis ini tidak boleh menyentuh berkas hotfix performa");
  must(!berkas.some((f) => /^backend\/data\//.test(f)), "berkas di backend/data ikut kandidat (foto/artefak uji)");
  must(!/ALTER TABLE "materials" ADD COLUMN "photo_file" VARCHAR\(80\) /.test(lf(mig.sql)) && /SET LOCAL lock_timeout = '5s'/.test(mig.sql), "migrasi harus memuat lock_timeout 5s dan kolom tanpa default");

  // 1. header
  potong('# RILIS "HARGA BERLAKU OTOMATIS DARI PO"', "set -Eeuo pipefail", lf(blok.header));
  // 2. variabel
  r('CAND_BRANCH="${CAND_BRANCH:-feat/harga-berlaku-dari-po-on-c063779c}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  r("# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.", "# Rilis web + backend dengan SATU migrasi aditif (dua kolom NULL pada materials); backend/src/index.js dan dependensi TIDAK berubah; OTA RN TIDAK diterbitkan.");
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  const vars = lf(blok.vars).replace("@@MIG_NAME@@", () => mig.name).replace("@@MIG_PIN@@", () => sha(lf(mig.sql))).replace("@@SCAN_EXPECT@@", () => scanExpect).replace("@@SCHEMA_DIFF_SHA@@", () => schemaSha).trimEnd();
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`; L.splice(ia + 3, 0, vars);
  s = L.join("\n");
  // 3. nama kunci/backup/tag/DB sementara khusus rilis ini
  r("harga-dari-po-${DEPLOY_SHORT}-${TS}", "foto-bahan-${DEPLOY_SHORT}-${TS}"); r("rollback-pre-hpo-", "rollback-pre-fb-"); r("rehearsal_hpo_", "rehearsal_fb_"); r("release-harga-dari-po.lock", "release-foto-bahan.lock");
  // 4. instruksi rollback
  { const i = s.indexOf("Berhenti SEBELUM 'Switch backend'"); const j = s.indexOf("\nEOF\n", i); must(i >= 0 && j > i, "blok rollback"); const k = s.lastIndexOf("\n", j - 1) + 1; s = s.slice(0, i) + lf(blok.rollback).trimEnd() + "\n" + s.slice(k); }
  // 5. gerbang migrasi/schema (menggantikan 'tanpa migrasi')
  r('say "1. Sumber kode, ancestry, batas perubahan, tanpa migrasi/schema"', 'say "1. Sumber kode, ancestry, batas perubahan, pin migrasi + diff schema, pemindai DDL (+ uji negatif pemindai)"');
  potong("[ -z \"$(printf '%s\\n' \"$CHANGED\" | grep -E '^backend/prisma/' || true)\" ]", "\n\n# ── GERBANG IDENTITAS KODE LIVE", lf(blok["gate-prisma"]).replace("@@SCAN_JS@@", () => lf(scanJs).trimEnd()).trimEnd() + "\nok \"kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\\n' \"$CHANGED\" | wc -l) berkas dalam allowlist eksplisit; migrasi + schema.prisma sesuai audit\"");
  // 6. struktur + keadaan production + bukti persistensi di production (baca-saja)
  r('ok "prasyarat: rilis ini tidak bergantung pada migrasi baru dan tidak menulis data bisnis"', lf(blok.struktur).trimEnd() + "\n" + lf(blok.keadaan).trimEnd());
  r('die "ada migration menggantung"', 'die "ada migration menggantung (gagal/terhenti, mis. batas tunggu kunci): selesaikan lebih dulu dengan prisma migrate resolve (lihat instruksi rollback) — berhenti"');
  // 7. disk: gerbang 5 GiB + kebutuhan menetap/puncak dari ukuran nyata
  r('[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"\nok "ruang disk cukup"\n', lf(blok.disk).trimEnd() + "\n");
  r('ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"', 'ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"\ncek_disk "setelah build image"');
  // 8. teks fitur di bundel web: fitur rilis ini + SEMUA fitur live sebelumnya (jangan sampai hilang)
  { const L2 = s.split("\n"); const i1 = L2.findIndex((l) => l.startsWith("for s1 in ")); const i2 = L2.findIndex((l) => l.startsWith("for s2 in ")); must(i1 >= 0 && i2 >= 0, "baris s1/s2");
    const rx = /^for (s[12]) in ((?:"[^"]*"\s?)+);\s*do/; const m1 = L2[i1].match(rx), m2 = L2[i2].match(rx); must(m1 && m2, "daftar s1/s2");
    const item = (t) => [...t.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    const live = [...new Set([...item(m2[2]), ...item(m1[2])])];
    L2[i1] = L2[i1].replace(rx, () => `for s1 in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do`);
    L2[i2] = L2[i2].replace(rx, () => `for s2 in ${live.map((x) => `"${x}"`).join(" ")}; do`);
    s = L2.join("\n"); }
  // 9. rehearsal: migrasi pada salinan restore (+ uji batas tunggu kunci + pemulihan resmi) SEBELUM uji aplikasi
  potong('dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status', 'RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt"', lf(blok["rehearsal-migrasi"]).trimEnd() + "\n");
  r("5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)", "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi pada salinan (uji batas tunggu kunci + pemulihan resmi), jalankan kode BARU sebagai server (foto), bukti persistensi file lintas recreate container, kompatibilitas kode lama, bandingkan sidik jari, hapus (DB dan data production tidak disentuh)");
  gantiBaris("# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): ", "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata yang SUDAH bermigrasi, DB sementara, folder data SEMENTARA): Foto Bahan — unggah/putar/ganti/hapus, akses 401/403/404 dan URL bertanda-tangan, validasi isi/dimensi/format, serentak, kegagalan aman, hapus hanya berkas milik bahan, tanpa efek ke stok/harga/jurnal. Bahan uji hanya di salinan; DB dihapus di akhir.");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).trimEnd() + s.slice(j); }
  r("uji Harga Berlaku dari PO terhadap salinan restore GAGAL", "uji Foto Bahan terhadap salinan restore GAGAL");
  r("\nreh_drop\n# direktori sementara dibuat root oleh kontainer", "\n" + lf(blok["rehearsal-pasca"]).replace("@@KOMPAT_JS@@", () => lf(kompatNode).trimEnd()).trimEnd() + "\nreh_drop\n# direktori sementara dibuat root oleh kontainer");
  r('ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; uji tulis PO uji dan harga manual/terjadwal uji dilakukan HANYA pada salinan restore lalu DB sementara dihapus"', 'ok "rehearsal lulus: migrasi diterapkan pada salinan restore (kolom NULL, skema lama identik, batas tunggu kunci + pemulihan resmi teruji); isi ${FP_N} tabel lama IDENTIK; uji tulis foto dilakukan HANYA pada salinan restore + folder data sementara lalu DB sementara dihapus; production tidak disentuh"\ncek_disk "setelah rehearsal"');
  // 10. migrasi production (sebelum switch; backend lama tetap melayani)
  potong('PHASE="6-tanpa-migrasi"', '\nPHASE="7-switch"', lf(blok.step6).trimEnd() + "\n");
  r('PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"', 'PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"\ncek_disk "sebelum switch"');
  // 11. verifikasi pasca-switch
  r('ok "${NBE} berkas backend di container = kandidat (byte-identik)"', 'ok "${NBE} berkas backend di container = kandidat (byte-identik)"\nPSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }\nstruktur_baru PSQLN die 0\n[ "$(mount_data "$CID_NEW")" = "$MOUNT_DATA_LAMA" ] || die "mount /app/data container BARU ($(mount_data "$CID_NEW")) berbeda dari container lama (${MOUNT_DATA_LAMA}) — foto bisa tidak terbaca"\ndocker exec "$CID_NEW" sh -c \'test -w /app/data\' </dev/null || die "folder /app/data tidak dapat ditulis container baru"\nok "kolom foto terpasang tepat sesuai audit; /app/data container baru = bind-mount persisten yang sama dengan container lama (${MOUNT_DATA_LAMA#bind:})"');
  r("hitung baris stok/biaya beku/harga/Material Issue/jurnal/unit/order/job/pernyataan/run/jadwal/custody/status kerja", "hitung baris bahan/foto/stok/harga/valuasi/jurnal/biaya beku/penyesuaian/catatan pemakaian/aktivitas bahan");
  // 12. smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke test baca-saja: kolom foto, Stok & Lokasi (baris = bahan; URL foto null atau bertanda-tangan), akses media 401/403/404, unggah/hapus/putar tanpa token = 401 dan tanpa izin = 403; TANPA unggahan dan TANPA foto/bahan percobaan; bahan, foto, stok, harga, valuasi, jurnal identik"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (kolom foto, Stok & Lokasi, akses media, penolakan sebelum menulis, tanpa jejak tulis)"');
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa Foto Bahan (Gudang → Stok & Lokasi): unggah/ganti/putar/hapus satu foto per bahan oleh pemegang izin ubah bahan; foto disajikan lewat URL bertanda-tangan (tanpa penyajian statis); file di ${PERSIST}/backend/data/material-photos. Migrasi aditif: dua kolom NULL pada materials, tanpa backfill. Rilis TIDAK mengunggah foto atau mengubah bahan, stok, harga, valuasi, jurnal, atau izin. Backup database TIDAK memuat berkas foto: salin folder foto secara berkala. Rollback KODE: image ${ROLLBACK_TAG} + folder ${PREV_DIR} (kolom foto tetap, tidak dibaca kode lama; file foto tetap di folder persisten)."');
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  const sisa = s.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !l.startsWith("#") && /harga-dari-po|\bhpo\b|HARGA_DARI_PO|purchase-orders|pratinjau-harga/i.test(l)).map(([i, l]) => `${i}: ${l.slice(0, 100)}`);
  s = lf(s); // checkout Windows (autocrlf) dapat membuat templat CRLF; keluaran SELALU LF (yang dikirim ke VPS dan di-commit)
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: berkas.filter((f) => f.startsWith("backend/src/")).length, frontendSrc: berkas.filter((f) => f.startsWith("frontend/src/")).length, mig: mig.name, migSha: sha(lf(mig.sql)).slice(0, 12), scanExpect, schemaSha: schemaSha.slice(0, 12), sisaHpo: sisa.length }, sisa };
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
    baseScript: git(["show", `${base}:${BASE_SCRIPT}`]), blok, berkasList: list, mig, schemaSha: schemaDiffSha(ref), scanJs, scanExpect,
    rehNode: fs.readFileSync(path.join(REPO, LIB_REH), "utf8"), smokeNode: fs.readFileSync(path.join(REPO, LIB_SMOKE), "utf8"), kompatNode: fs.readFileSync(path.join(REPO, LIB_KOMPAT), "utf8"),
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
  if (hasil.sisa.length) console.log("SISA nama rilis lama (non-komentar):\n  " + hasil.sisa.join("\n  "));
}
module.exports = { bangkitkan };
if (require.main === module) main();
