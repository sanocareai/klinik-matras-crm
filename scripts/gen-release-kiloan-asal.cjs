// Generator skrip rilis bergerbang "klasifikasi asal KILOAN + koreksi D1" (BACKEND-SAJA, TANPA frontend, TANPA migrasi dan TANPA perubahan schema.prisma).
// Hasil: scripts/release-kiloan-asal.sh — diturunkan dari scripts/release-penjadwalan-langsung.sh (kerangka rilis kode bergerbang yang SUDAH LIVE: gerbang identitas kode live, hotfix dipertahankan, tanpa pembersihan)
// + blok di scripts/templates/release-kiloan-asal/* + pustaka scripts/lib/{rehearsal,smoke}-kiloan-asal.mjs. Semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend) dihitung dari git terhadap --base.
//
//   node scripts/gen-release-kiloan-asal.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-kiloan-asal.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-penjadwalan-langsung.sh";
const OUT = "scripts/release-kiloan-asal.sh";
const TPL_DIR = "scripts/templates/release-kiloan-asal";
const LIB_REH = "scripts/lib/rehearsal-kiloan-asal.mjs", LIB_SMOKE = "scripts/lib/smoke-kiloan-asal.mjs";
const GENERATOR = "scripts/gen-release-kiloan-asal.cjs";
const TPL_FILES = ["header", "rollback"].map((n) => `${TPL_DIR}/${n}.txt`);
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE, ...TPL_FILES];
const CAND_BRANCH = "fix/klasifikasi-kiloan-on-f0f655d7";
// Rilis ini TANPA perubahan frontend/src: tidak ada teks fitur baru. Teks fitur live (saringan Stok 382027ef, tab Marketing f0f655d7, drawer, penjadwalan, pemakaian, Gudang) tidak boleh hilang dari bundel; dist dibangun ulang dari sumber yang memuat Marketing.
const DIST_LIVE_TAMBAHAN = ["Atur ulang saringan", "Saring harga berlaku", "Saring kelengkapan data bahan", "Saring satuan stok", "Ada stok tetapi belum ada harga", "Saldo nol atau minus", "Belum ada vendor", "Ada stok", "Stok belum diketahui", "Nol menurut pergerakan", "Saldo minus", "Koreksi saldo", "Ubah harga", "Pilih meja", "Pilih semua unit order ini", "Belum dijadwalkan", "Riwayat dan dokumen pemakaian", "Tanpa pengeluaran stok", "Mengurangi stok", "Beranda Gudang", "Pengeluaran Material", "Konfirmasi Barang Jadi", "Total lead (termasuk spam)", "Tren lead harian (tanpa spam)", "Pola lead & respons", "Kesehatan & referensi", "Kreatif & tautan", "Customer lunas (ledger)", "marketing-sumber-", "Lead CTWA terbukti", "Meta CTWA", "Kualitas data", "Kelola biaya iklan", "Rincian per Iklan", "Rencana Produksi", "Target KPI", "Impor spend"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

const COUNT_SQL = "select 'materials', count(*) from materials union all select 'stock_movements', count(*) from stock_movements union all select 'fin_journal_entries', count(*) from fin_journal_entries union all select 'material_harga_berlaku', count(*) from material_harga_berlaku union all select 'kiloan_bukan_stok', count(*) from unit_usage_notes where origin = 'EXCEL' and state = 'BUKAN_STOK' and raw_name ~* 'kiloan' union all select 'kiloan_peristiwa', count(*) from unit_usage_note_events e join unit_usage_notes n on n.id = e.note_id where n.raw_name ~* 'kiloan'";

const UJI_PENANDA = "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): ";

function bangkitkan({ baseScript, blok, berkasList, rehNode, smokeNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); const j = s.indexOf(akhir, i + awal.length); must(i >= 0 && j >= 0, `penanda: ${awal.slice(0, 60)} .. ${akhir.slice(0, 60)}`); s = s.slice(0, i) + ganti + s.slice(j); };
  const gantiBaris = (awalan, baru) => { const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith(awalan)); must(i >= 0, "baris berawalan: " + awalan.slice(0, 70)); L[i] = baru; s = L.join("\n"); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  const fe = ""; // rilis backend-saja: FRONTEND_SRC_EXPECT kosong
  must(!berkas.some((f) => /^backend\/prisma\//.test(f)), "rilis ini TANPA migrasi/schema: ada perubahan backend/prisma");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.includes("backend/src/index.js"), "index.js berubah (dipatok tes atribusi)");
  must(!berkas.some((f) => /^frontend\//.test(f)), "rilis ini BACKEND-SAJA: ada perubahan di frontend/");
  for (const wajib of ["backend/src/lib/domain/pemakaianHistoris.js", "backend/src/services/catatanPemakaianHistoris.js", "backend/src/routes/pemakaianKoreksi.js", "backend/tests/integration/koreksiKiloanD1.integration.test.js", "backend/tests/integration/kiloanAsalBahan.integration.test.js", "scripts/lib/sidik-data.sh"]) must(berkas.includes(wajib), "berkas inti harus ada di diff: " + wajib);
  must(!berkas.some((f) => /^backend\/src\/(routes\/(analytics|conversations)|middleware\/cacheSingkat)\.js$|^frontend\/src\/pages\/Laporan\.jsx$/.test(f)), "rilis ini tidak boleh menyentuh berkas hotfix performa");

  potong("# RILIS \"PENJADWALAN LANGSUNG", "set -Eeuo pipefail", lf(blok.header));
  r('CAND_BRANCH="${CAND_BRANCH:-feat/rencana-penjadwalan-langsung-on-hotfix}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`;
  s = L.join("\n");
  // nama kunci/backup/tag/DB sementara khusus rilis ini
  r("penjadwalan-langsung-${DEPLOY_SHORT}-${TS}", "kiloan-asal-${DEPLOY_SHORT}-${TS}"); /* termasuk nama backup: pre-po-barang-mirip-... */ r("rollback-pre-pjl-", "rollback-pre-kla-"); r("rehearsal_pjl_", "rehearsal_kla_");
  r("/tmp/release-penjadwalan-langsung.lock", "/tmp/release-kiloan-asal.lock"); r("pjl\\|release-penjadwalan-langsung\\|pgrep", "kla\\|release-kiloan-asal\\|pgrep");
  // blok rollback
  { const i = s.indexOf("Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya"); const j = s.indexOf("\nEOF\n", i); must(i >= 0 && j > i, "blok rollback"); const k = s.lastIndexOf("\n", j - 1) + 1; s = s.slice(0, i) + lf(blok.rollback).trimEnd() + "\n" + s.slice(k); }
  // teks fitur di bundel web: fitur rilis ini + fitur live sebelumnya (jangan sampai hilang)
  { const L2 = s.split("\n"); const i = L2.findIndex((l) => l.startsWith('for s1 in "Pilih meja"')); must(i >= 0, "baris s1");
    L2[i] = '# rilis BACKEND-SAJA: tidak ada teks fitur baru yang diperiksa; dist tidak boleh kehilangan teks fitur live (daftar s2 di bawah)';
    s = L2.join("\n"); }
  r('for s2 in "Tambah pemakaian"', `for s2 in ${DIST_LIVE_TAMBAHAN.map((x) => `"${x}"`).join(" ")} "Tambah pemakaian"`);
  // rehearsal: kode baru sebagai server terhadap salinan restore; direktori data/uploads production TIDAK dipasang (sudah ada di kerangka)
  gantiBaris(UJI_PENANDA, UJI_PENANDA + "klasifikasi KILOAN + D1 (izin, pratinjau, penahanan, terapkan, ulang tanpa duplikat, kestabilan terhadap evaluasi ulang) pada salinan; deploy kode saja tidak mengoreksi 16 catatan; master/stok/penerimaan/harga/valuasi/jurnal tidak berubah. DB dihapus di akhir.");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).replace('"@@SMOKE_SRC@@"', () => JSON.stringify(lf(smokeNode))).trimEnd() + s.slice(j); }
  r("uji penjadwalan langsung terhadap salinan restore GAGAL", "uji KILOAN/D1 terhadap salinan restore GAGAL");
  r("uji tulis Edit pemakaian dilakukan HANYA pada salinan restore", "uji tulis D1 dilakukan HANYA pada salinan restore");
  // smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke test baca-saja: pratinjau D1 (fungsi layanan, tanpa token), rute D1 tanpa token = 401, D1 TIDAK ikut berjalan, isi catatan pemakaian identik"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (pratinjau D1, rute tertutup tanpa token, D1 belum berjalan, tanpa jejak tulis, sidik isi catatan identik, invarian)"');
  // garis dasar catatan KILOAN (dibandingkan smoke): jumlah BUKAN_STOK dan peristiwa DIKOREKSI pada catatan KILOAN
  gantiBaris("printf 'BASE_TIDAK_SEIMBANG=%q", "BASE_KILOAN_N=\"$(psql_live -At -c \"select count(*) from unit_usage_notes where origin = 'EXCEL' and state = 'BUKAN_STOK' and raw_name ~* 'kiloan'\")\"; BASE_KILOAN_DIKOREKSI=\"$(psql_live -At -c \"select count(*) from unit_usage_note_events e join unit_usage_notes n on n.id = e.note_id where n.raw_name ~* 'kiloan' and e.kind = 'DIKOREKSI'\")\"\nprintf 'BASE_TIDAK_SEIMBANG=%q\\nBASE_GANDA=%q\\nORDER_N=%q\\nJOB_N=%q\\nPKR_N=%q\\nEVT_N=%q\\nBASE_KILOAN_N=%q\\nBASE_KILOAN_DIKOREKSI=%q\\n' \"$BASE_TIDAK_SEIMBANG\" \"$BASE_GANDA\" \"$ORDER_N\" \"$JOB_N\" \"$PKR_N\" \"$EVT_N\" \"$BASE_KILOAN_N\" \"$BASE_KILOAN_DIKOREKSI\" > \"$BK_DIR/garis-dasar.env\"");
  r('-e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<\'NODE\'', '-e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" -e BASE_KILOAN_N="$BASE_KILOAN_N" -e BASE_KILOAN_DIKOREKSI="$BASE_KILOAN_DIKOREKSI" backend node --input-type=module - <<\'NODE\'');
  // hitung baris pra/pasca switch
  gantiBaris('COUNT_SQL="', `COUNT_SQL="${COUNT_SQL}"`);
  r("hitung baris jadwal/Run/stok/pemakaian/harga/jurnal", "hitung baris material/stok/jurnal/Harga Berlaku/catatan KILOAN BUKAN_STOK/peristiwa KILOAN");
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa klasifikasi asal KILOAN (bukan lagi otomatis komponen lama) dan fungsi koreksi D1 (berizin OWNER/FINANCE, idempoten, berjejak). TANPA frontend dan TANPA migrasi. Rilis TIDAK menjalankan D1: keenam belas catatan KILOAN tetap BUKAN_STOK sampai D1 dijalankan atas keputusan terpisah. D2 sampai D5 (master, penerimaan, harga, posting) bukan bagian rilis ini."');
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  const sisa = s.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !l.startsWith("#") && /penjadwalan|jadwal-batch|\bpjl\b|reh-pjl/i.test(l) && !/jadwal\/Run|production_unit_schedule/.test(l)).map(([i]) => i);
  s = lf(s);
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: berkas.filter((f) => f.startsWith("backend/src/")).length, frontendSrc: berkas.filter((f) => f.startsWith("frontend/src/")).length, barisSisaPenjadwalan: sisa.length } };
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
  const hasil = bangkitkan({ baseScript: git(["show", `${base}:${BASE_SCRIPT}`]), blok, berkasList: list, rehNode: fs.readFileSync(path.join(REPO, LIB_REH), "utf8"), smokeNode: fs.readFileSync(path.join(REPO, LIB_SMOKE), "utf8") });
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
