// Generator skrip rilis bergerbang "Pembetulan Bahan Unit Terkirim" (WEB + BACKEND, TANPA migrasi dan TANPA perubahan schema.prisma).
// Hasil: scripts/release-pembetulan-bahan.sh — diturunkan dari scripts/release-status-kerja-buka-pekerjaan.sh (kerangka rilis kode-saja bergerbang yang sudah live) + blok di scripts/templates/release-pembetulan-bahan/*
// + pustaka scripts/lib/{rehearsal,smoke}-pembetulan-bahan.mjs. Semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend/frontend) dihitung dari git terhadap --base.
//
//   node scripts/gen-release-pembetulan-bahan.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-pembetulan-bahan.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-status-kerja-buka-pekerjaan.sh";
const OUT = "scripts/release-pembetulan-bahan.sh";
const TPL_DIR = "scripts/templates/release-pembetulan-bahan";
const LIB_REH = "scripts/lib/rehearsal-pembetulan-bahan.mjs", LIB_SMOKE = "scripts/lib/smoke-pembetulan-bahan.mjs";
const GENERATOR = "scripts/gen-release-pembetulan-bahan.cjs";
const TPL_FILES = ["header", "rollback"].map((n) => `${TPL_DIR}/${n}.txt`);
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE, ...TPL_FILES];
const CAND_BRANCH = "fix/pemakaian-drawer-order";
// Teks ASCII di bundel web (esbuild menulis karakter non-ASCII sebagai \uXXXX, jadi hanya awalan ASCII yang dicari).
const DIST_BARU = ["Pembetulan bahan", "Tambah pengeluaran bahan", "Kembalikan sebagian (pengembalian baru)", "Catat komponen lama", "Catat pemakaian sementara", "Lihat dampak", "dilaporkan dipakai"];
const DIST_LAMA_TAMBAHAN = ["Buka pekerjaan", "Catat pekerjaan selesai", "Tandai sudah dikerjakan", "Harga Berlaku (HPP operasional)", "Koreksi salah input historis", "Beri harga ke pemakaian lama"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

const UJI_TERISOLASI = [
  'mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"',
  'REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")',
  '[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c \'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l\' </dev/null | tr -d \'[:space:]\')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }',
  'ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"',
].join("\n");

function bangkitkan({ baseScript, blok, berkasList, rehNode, smokeNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); const j = s.indexOf(akhir, i + awal.length); must(i >= 0 && j >= 0, `penanda: ${awal.slice(0, 60)} .. ${akhir.slice(0, 60)}`); s = s.slice(0, i) + ganti + s.slice(j); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  const fe = berkas.filter((f) => f.startsWith("frontend/src/")).join(" ");
  must(!berkas.some((f) => /^backend\/prisma\//.test(f)), "rilis ini TANPA migrasi/schema: ada perubahan backend/prisma");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.includes("backend/src/index.js"), "index.js berubah (dipatok tes atribusi)");
  must(berkas.includes("backend/src/services/pembetulanBahanUnit.js") && berkas.includes("frontend/src/features/production/bahan/PembetulanUnitSelesai.jsx"), "layanan + panel pembetulan harus ada di diff");

  potong("# RILIS \"STATUS KERJA JUJUR", "set -Eeuo pipefail", lf(blok.header));
  r('CAND_BRANCH="${CAND_BRANCH:-fix/status-kerja-buka-pekerjaan}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0, "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`;
  s = L.join("\n");
  r("status-kerja-${DEPLOY_SHORT}-${TS}", "pembetulan-bahan-${DEPLOY_SHORT}-${TS}"); r("pre-status-kerja-", "pre-pbu-"); r("rehearsal_status_kerja_", "rehearsal_pembetulan_");
  r("/tmp/release-status-kerja-buka-pekerjaan.lock", "/tmp/release-pembetulan-bahan.lock"); r("sk1\\|release-status-kerja-buka-pekerjaan\\|pgrep", "pb1\\|release-pembetulan-bahan\\|pgrep");
  potong("Rilis ini TANPA migrasi dan TANPA tulisan data bisnis:", "─────────────────────────────────────────────────────────────────────────\nEOF", lf(blok.rollback).trimEnd() + "\n");
  // teks fitur di bundel web
  potong('for s1 in "Buka pekerjaan"', "\nfor s2 in", `for s1 in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: \${s1}"; done`);
  r('for s2 in "Koreksi Dokumen"', `for s2 in ${DIST_LAMA_TAMBAHAN.map((x) => `"${x}"`).join(" ")} "Koreksi Dokumen"`);
  // rehearsal: kode baru sebagai server terhadap salinan restore; direktori data/uploads production TIDAK dipasang
  r("# UJI APLIKASI pada SALINAN RESTORE (kode BARU, data produksi nyata, DB sementara): membuka pekerjaan baca-saja; klik ganda manual = satu catatan; stok/Run/QC/jurnal/jadwal/target (termasuk unit Bendrya) tidak berubah. DB dihapus di akhir.",
    "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): pratinjau baca-saja; pembetulan unit terkirim (alasan, tanggal dilaporkan, saldo bergeser, kemungkinan ganda, pengembalian, koreksi berpersetujuan, catatan sementara, komponen lama); unit dibatalkan/aktif ditolak. DB dihapus di akhir.\n" + UJI_TERISOLASI);
  r('-T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<\'REHNODE\'', '-T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<\'REHNODE\'');
  potong("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\"", "\nREHNODE\n", "<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\" 2>&1 || { cat \"$BK_DIR/rehearsal-koreksi.log\"; reh_drop; die \"uji Pembetulan Bahan terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)\"; }\n" + lf(rehNode).trimEnd());
  r('ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah uji baca-saja; uji tulis manual dilakukan pada salinan lalu DB sementara dihapus"', 'rm -rf "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"\nok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; uji tulis pembetulan dilakukan HANYA pada salinan restore lalu DB sementara dihapus"');
  // smoke
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  const m = s.match(/PHASE="8b-smoke"; say "[^\n]*\n/); must(m, "PHASE 8b");
  s = s.replace(m[0], () => 'PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin (401/403), pratinjau pembetulan unit terkirim (baca-saja), unit dibatalkan/aktif ditolak, penolakan POST sebelum menulis (alasan/tanggal/saldo), tanpa jejak tulis"\n');
  const ms = s.match(/ok "smoke test lulus \([^\n]*\n/); must(ms, "ok smoke");
  s = s.replace(ms[0], () => 'ok "smoke test lulus (izin, pratinjau baca-saja, batas unit terkirim, penolakan sebelum menulis, tanpa jejak tulis, invarian)"\n');
  const iCat = s.lastIndexOf('say "CATATAN:'); must(iCat > 0, "CATATAN");
  s = s.slice(0, iCat) + 'say "CATATAN: Rilis ini membawa Pembetulan Bahan unit TERKIRIM (alasan + tanggal pemakaian dilaporkan wajib; pratinjau dampak; pemeriksaan kemungkinan pencatatan ganda). TANPA migrasi. Tidak ada pergerakan stok, catatan sementara, komponen lama, koreksi, jurnal, atau harga yang dibuat/diubah oleh rilis; pembetulan nyata baru terjadi saat pengguna berizin memakainya."\n';
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  s = lf(s);
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: berkas.filter((f) => f.startsWith("backend/src/")).length, frontendSrc: berkas.filter((f) => f.startsWith("frontend/src/")).length } };
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
  const blok = Object.fromEntries(TPL_FILES.map((f) => [path.basename(f, ".txt"), fs.readFileSync(path.join(REPO, f), "utf8")]));
  const hasil = bangkitkan({ baseScript: git(["show", `HEAD:${BASE_SCRIPT}`]), blok, berkasList: list, rehNode: fs.readFileSync(path.join(REPO, LIB_REH), "utf8"), smokeNode: fs.readFileSync(path.join(REPO, LIB_SMOKE), "utf8") });
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
