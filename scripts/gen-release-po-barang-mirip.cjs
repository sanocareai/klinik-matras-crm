// Generator skrip rilis bergerbang "PO barang mirip" (Finance → Purchase Order Baru) (WEB + BACKEND, TANPA migrasi dan TANPA perubahan schema.prisma).
// Hasil: scripts/release-po-barang-mirip.sh — diturunkan dari scripts/release-penjadwalan-langsung.sh (kerangka rilis kode-saja bergerbang yang SUDAH LIVE: gerbang identitas kode live, hotfix dipertahankan, tanpa pembersihan)
// + blok di scripts/templates/release-po-barang-mirip/* + pustaka scripts/lib/{rehearsal,smoke}-po-barang-mirip.mjs. Semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend/frontend) dihitung dari git terhadap --base.
//
//   node scripts/gen-release-po-barang-mirip.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-po-barang-mirip.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-penjadwalan-langsung.sh";
const OUT = "scripts/release-po-barang-mirip.sh";
const TPL_DIR = "scripts/templates/release-po-barang-mirip";
const LIB_REH = "scripts/lib/rehearsal-po-barang-mirip.mjs", LIB_SMOKE = "scripts/lib/smoke-po-barang-mirip.mjs";
const GENERATOR = "scripts/gen-release-po-barang-mirip.cjs";
const TPL_FILES = ["header", "rollback"].map((n) => `${TPL_DIR}/${n}.txt`);
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE, ...TPL_FILES];
const CAND_BRANCH = "fix/po-barang-mirip-on-17305848";
// Teks ASCII di bundel web (esbuild menulis karakter non-ASCII sebagai \uXXXX, jadi hanya awalan ASCII yang dicari).
// (hanya teks yang TIDAK ada di bundel release aktif; "Barang ini sudah ada", "Pakai material ini", "Hapus baris ini" sudah ada sebelumnya)
const DIST_BARU = ["Perlu keputusan Anda", "Varian serupa yang sudah ada", "Batalkan barang baru ini", "Ubah barang baru"];
// Fitur live sebelumnya yang tidak boleh hilang dari bundel (drawer bahan ringkas + penjadwalan langsung + pemakaian).
const DIST_LIVE_TAMBAHAN = ["Ada stok", "Stok belum diketahui", "Nol menurut pergerakan", "Saldo minus", "Koreksi saldo", "Ubah harga", "Pilih meja", "Pilih semua unit order ini", "Belum dijadwalkan", "Riwayat dan dokumen pemakaian", "Tanpa pengeluaran stok", "Mengurangi stok", "Beranda Gudang", "Pengeluaran Material", "Konfirmasi Barang Jadi"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

const COUNT_SQL = "select 'materials', count(*) from materials union all select 'supplier_materials', count(*) from fin_supplier_materials union all select 'sku_origins', count(*) from fin_material_sku_origins union all select 'purchase_orders', count(*) from fin_purchase_orders union all select 'purchase_order_lines', count(*) from fin_purchase_order_lines union all select 'harga_berlaku', count(*) from material_harga_berlaku union all select 'stock_movements', count(*) from stock_movements union all select 'journal_entries', count(*) from fin_journal_entries union all select 'journal_lines', count(*) from fin_journal_lines union all select 'material_issues', count(*) from material_issues";

const UJI_PENANDA = "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): ";

function bangkitkan({ baseScript, blok, berkasList, rehNode, smokeNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); const j = s.indexOf(akhir, i + awal.length); must(i >= 0 && j >= 0, `penanda: ${awal.slice(0, 60)} .. ${akhir.slice(0, 60)}`); s = s.slice(0, i) + ganti + s.slice(j); };
  const gantiBaris = (awalan, baru) => { const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith(awalan)); must(i >= 0, "baris berawalan: " + awalan.slice(0, 70)); L[i] = baru; s = L.join("\n"); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  const fe = berkas.filter((f) => f.startsWith("frontend/src/")).join(" ");
  must(!berkas.some((f) => /^backend\/prisma\//.test(f)), "rilis ini TANPA migrasi/schema: ada perubahan backend/prisma");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.includes("backend/src/index.js"), "index.js berubah (dipatok tes atribusi)");
  for (const wajib of ["backend/src/lib/domain/kemiripanBarang.js", "backend/src/services/finance/skuBaru.js", "backend/src/services/finance/purchaseOrder.js", "backend/src/routes/purchaseOrders.js", "frontend/src/pages/finance/FinancePurchaseOrders.jsx", "frontend/src/features/finance/purchaseOrderLogic.js", "frontend/src/api.js"]) must(berkas.includes(wajib), "berkas inti harus ada di diff: " + wajib);
  must(!berkas.some((f) => /^backend\/src\/(routes\/(analytics|conversations)|middleware\/cacheSingkat)\.js$|^frontend\/src\/pages\/Laporan\.jsx$/.test(f)), "rilis ini tidak boleh menyentuh berkas hotfix performa");

  potong("# RILIS \"PENJADWALAN LANGSUNG", "set -Eeuo pipefail", lf(blok.header));
  r('CAND_BRANCH="${CAND_BRANCH:-feat/rencana-penjadwalan-langsung-on-hotfix}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`;
  s = L.join("\n");
  // nama kunci/backup/tag/DB sementara khusus rilis ini
  r("penjadwalan-langsung-${DEPLOY_SHORT}-${TS}", "po-barang-mirip-${DEPLOY_SHORT}-${TS}"); /* termasuk nama backup: pre-po-barang-mirip-... */ r("rollback-pre-pjl-", "rollback-pre-pbm-"); r("rehearsal_pjl_", "rehearsal_pbm_");
  r("/tmp/release-penjadwalan-langsung.lock", "/tmp/release-po-barang-mirip.lock"); r("pjl\\|release-penjadwalan-langsung\\|pgrep", "pbm\\|release-po-barang-mirip\\|pgrep");
  // blok rollback
  { const i = s.indexOf("Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya"); const j = s.indexOf("\nEOF\n", i); must(i >= 0 && j > i, "blok rollback"); const k = s.lastIndexOf("\n", j - 1) + 1; s = s.slice(0, i) + lf(blok.rollback).trimEnd() + "\n" + s.slice(k); }
  // teks fitur di bundel web: fitur rilis ini + fitur live sebelumnya (jangan sampai hilang)
  { const L2 = s.split("\n"); const i = L2.findIndex((l) => l.startsWith('for s1 in "Pilih meja"')); must(i >= 0, "baris s1");
    L2[i] = `for s1 in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: \${s1}"; [ -z "$(grep -lF -- "$s1" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks fitur baru '\${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done`;
    s = L2.join("\n"); }
  r('for s2 in "Tambah pemakaian"', `for s2 in ${DIST_LIVE_TAMBAHAN.map((x) => `"${x}"`).join(" ")} "Tambah pemakaian"`);
  // rehearsal: kode baru sebagai server terhadap salinan restore; direktori data/uploads production TIDAK dipasang (sudah ada di kerangka)
  gantiBaris(UJI_PENANDA, UJI_PENANDA + "PO barang mirip (delapan varian tanpa paksaan alasan, klik ganda, ambigu, duplikat antar-baris, gagal simpan tanpa setengah jadi, dua pengguna bersamaan, izin) pada salinan; pada material nyata di salinan: pratinjau menunjuk kodenya sendiri dan isi barisnya tidak berubah. Stok/jurnal/Harga Berlaku tidak berubah. DB dihapus di akhir.");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).replace('"@@SMOKE_SRC@@"', () => JSON.stringify(lf(smokeNode))).trimEnd() + s.slice(j); }
  r("uji penjadwalan langsung terhadap salinan restore GAGAL", "uji PO barang mirip terhadap salinan restore GAGAL");
  r("uji tulis Edit pemakaian dilakukan HANYA pada salinan restore", "uji tulis PO/SKU dilakukan HANYA pada salinan restore");
  // smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke test baca-saja: pratinjau cek-duplikat-po pada katalog nyata, izin (401/403), penolakan sebelum menulis; tanpa PO/material percobaan; isi baris material (termasuk BUS-008..015) identik"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (pratinjau cek-duplikat-po, izin, penolakan sebelum menulis, tanpa jejak tulis, sidik isi material identik, invarian)"');
  // hitung baris pra/pasca switch
  gantiBaris('COUNT_SQL="', `COUNT_SQL="${COUNT_SQL}"`);
  r("hitung baris jadwal/Run/stok/pemakaian/harga/jurnal", "hitung baris material/katalog/asal SKU/PO/Harga Berlaku/stok/jurnal");
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa pencocokan barang mirip pada Purchase Order Baru (SAMA / varian BERBEDA / AMBIGU; aksi penyelesaian per baris; cek duplikat antar-baris sebelum simpan). TANPA migrasi. Rilis TIDAK membuat PO, material, katalog supplier, stok, jurnal, atau Harga Berlaku, dan TIDAK menyentuh BUS-008..015; perubahan nyata baru terjadi saat Admin Finance menyimpan PO."');
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
