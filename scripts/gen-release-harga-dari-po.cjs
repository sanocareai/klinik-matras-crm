// Generator skrip rilis bergerbang "Harga Berlaku otomatis dari PO" (WEB + BACKEND, TANPA migrasi dan TANPA perubahan schema.prisma). Diturunkan dari gen-release-laporan-produksi.cjs (kerangka + penguncian bersama berbasis kepemilikan).
// Hasil: scripts/release-harga-dari-po.sh — diturunkan dari scripts/release-penjadwalan-langsung.sh (kerangka rilis kode-saja bergerbang yang SUDAH LIVE: gerbang identitas kode live, hotfix dipertahankan, tanpa pembersihan)
// + blok di scripts/templates/release-harga-dari-po/* + pustaka scripts/lib/{rehearsal,smoke}-harga-dari-po.mjs. Semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend/frontend) dihitung dari git diff terhadap --base.
//
//   node scripts/gen-release-harga-dari-po.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-harga-dari-po.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-penjadwalan-langsung.sh";
const OUT = "scripts/release-harga-dari-po.sh";
const TPL_DIR = "scripts/templates/release-harga-dari-po";
const LIB_REH = "scripts/lib/rehearsal-harga-dari-po.mjs", LIB_SMOKE = "scripts/lib/smoke-harga-dari-po.mjs";
const GENERATOR = "scripts/gen-release-harga-dari-po.cjs";
const { terapkanKunci } = require("./lib/gen-kunci-laporan.cjs");
const LIB_KUNCI = "scripts/lib/gen-kunci-laporan.cjs";
const TPL_FILES = ["header", "rollback", "kunci", "uji-pra-switch", "fase0-kunci", "cek-ulang-kunci", "rehearsal-pra-switch"].map((n) => `${TPL_DIR}/${n}.txt`);
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE, LIB_KUNCI, ...TPL_FILES];
const CAND_BRANCH = "feat/harga-berlaku-dari-po-on-c063779c";
// Teks ASCII di bundel web (esbuild menulis karakter non-ASCII sebagai \uXXXX, jadi hanya awalan ASCII yang dicari).
// (hanya teks yang TIDAK ada di bundel release aktif: teks UI baru Harga Berlaku otomatis dari PO)
const DIST_BARU = ["Harga Berlaku otomatis","Apa dampaknya?","Isian yang belum disimpan tidak mengubah harga","Saat PO berhasil disimpan"];
// Fitur live sebelumnya yang tidak boleh hilang dari bundel (Laporan Produksi, redesain Stok & Lokasi, Marketing, KILOAN, drawer bahan, penjadwalan, PO barang mirip).
const DIST_LIVE_TAMBAHAN = ["Total lead (termasuk spam)","Pola lead & respons","Customer lunas (ledger)","Kesehatan & referensi","Lead CTWA terbukti","Tindakan lainnya","Perkiraan biaya penanganan","Penyebab masalah","Solusi yang disepakati","Bahan belum dicatat","Bahan perlu dicek","HPP belum lengkap","Data order kurang","Paling lama belum ditangani","Unit ini memang tanpa bahan baru","Saldo nol atau minus","Saring harga berlaku","Saring kelengkapan data bahan","Belum ada harga berlaku","pkr_nilai_penjualan","pkr_sisa_ditagih","Ada stok","Stok belum diketahui","Nol menurut pergerakan","Saldo minus","Koreksi saldo","Ubah harga","Pilih meja","Pilih semua unit order ini","Belum dijadwalkan","Riwayat dan dokumen pemakaian","Tanpa pengeluaran stok","Mengurangi stok","Beranda Gudang","Pengeluaran Material","Konfirmasi Barang Jadi","Perlu keputusan Anda","Varian serupa yang sudah ada","Batalkan barang baru ini","Ubah barang baru","Periode order masuk","Lengkapi di Order Produksi","Selesai bertanggal pada periode","tanpa tanggal tercatat","Hanya order yang punya pemakaian bahan pada periode","Tampilkan semua bahan","Ada stok, belum ada harga","Saringan aktif","Harga Berlaku (HPP operasional)","Nilai Finance dan harga pembanding","Tambah pemakaian"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

const COUNT_SQL = "select 'purchase_orders', count(*) from fin_purchase_orders union all select 'purchase_order_lines', count(*) from fin_purchase_order_lines union all select 'harga_berlaku', count(*) from material_harga_berlaku union all select 'harga_dari_po', count(*) from material_harga_berlaku where impact->>'sumber' = 'PO' union all select 'stock_movements', count(*) from stock_movements union all select 'valuasi_stok', count(*) from fin_stock_movement_valuations union all select 'biaya_beku', count(*) from stock_movement_biaya_operasional union all select 'material_issues', count(*) from material_issues union all select 'jurnal', count(*) from fin_journal_entries union all select 'baris_jurnal', count(*) from fin_journal_lines union all select 'materials', count(*) from materials union all select 'catatan_pemakaian', count(*) from unit_usage_notes union all select 'units', count(*) from units union all select 'order', count(*) from \\\"Order\\\" union all select 'jobs', count(*) from jobs";

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
  for (const wajib of ["backend/src/services/finance/hargaDariPO.js", "backend/src/services/finance/hargaBerlaku.js", "backend/src/services/finance/purchaseOrder.js", "backend/src/routes/purchaseOrders.js", "frontend/src/pages/finance/FinancePurchaseOrders.jsx", "frontend/src/features/finance/hargaDariPOLogic.js", "frontend/src/features/warehouse/stok/HargaBerlakuPanel.jsx", "frontend/src/api.js"]) must(berkas.includes(wajib), "berkas wajib rilis ini tidak ada di diff: " + wajib);
  must(!berkas.some((f) => /^backend\/src\/(routes\/(analytics|conversations)|middleware\/cacheSingkat)\.js$|^frontend\/src\/pages\/Laporan\.jsx$/.test(f)), "rilis ini tidak boleh menyentuh berkas hotfix performa");

  potong("# RILIS \"PENJADWALAN LANGSUNG", "set -Eeuo pipefail", lf(blok.header));
  r('CAND_BRANCH="${CAND_BRANCH:-feat/rencana-penjadwalan-langsung-on-hotfix}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = `FRONTEND_SRC_EXPECT="${fe}"`;
  s = L.join("\n");
  // nama kunci/backup/tag/DB sementara khusus rilis ini
  r("penjadwalan-langsung-${DEPLOY_SHORT}-${TS}", "harga-dari-po-${DEPLOY_SHORT}-${TS}"); /* termasuk nama backup: pre-komplain-redesign-... */ r("rollback-pre-pjl-", "rollback-pre-hpo-"); r("rehearsal_pjl_", "rehearsal_hpo_");
  r("/tmp/release-penjadwalan-langsung.lock", "/tmp/release-harga-dari-po.lock"); r("pjl\\|release-penjadwalan-langsung\\|pgrep", "hpo\\|release-harga-dari-po\\|pgrep");
  // blok rollback
  { const i = s.indexOf("Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya"); const j = s.indexOf("\nEOF\n", i); must(i >= 0 && j > i, "blok rollback"); const k = s.lastIndexOf("\n", j - 1) + 1; s = s.slice(0, i) + lf(blok.rollback).trimEnd() + "\n" + s.slice(k); }
  // teks fitur di bundel web: fitur rilis ini + fitur live sebelumnya (jangan sampai hilang)
  { const L2 = s.split("\n"); const i = L2.findIndex((l) => l.startsWith('for s1 in "Pilih meja"')); must(i >= 0, "baris s1");
    L2[i] = `for s1 in ${DIST_BARU.map((x) => `"${x}"`).join(" ")}; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: \${s1}"; [ -z "$(grep -lF -- "$s1" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks fitur baru '\${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done`;
    s = L2.join("\n"); }
  r('for s2 in "Tambah pemakaian"', `for s2 in ${DIST_LIVE_TAMBAHAN.map((x) => `"${x}"`).join(" ")} "Tambah pemakaian"`);
  // rehearsal: kode baru sebagai server terhadap salinan restore; direktori data/uploads production TIDAK dipasang (sudah ada di kerangka)
  gantiBaris(UJI_PENANDA, UJI_PENANDA + "Harga Berlaku otomatis dari PO: harga tertulis saat PO disimpan (draf baru/ubah draf) tanpa izin harga tambahan; hanya baris berubah menulis; klik ganda/retry satu hasil; harga lebih baru dan terjadwal tidak tertimpa; persetujuan/pembatalan tidak menulis atau mengembalikan harga; konflik/konversi tidak sah ditolak tanpa tulisan sebagian; saklar HARGA_DARI_PO=0; izin; stok/valuasi/jurnal/biaya beku/pemakaian lama dan seluruh baris Harga Berlaku lama identik; data uji hanya di salinan dan DB dihapus di akhir.");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).replace('"@@SMOKE_SRC@@"', () => JSON.stringify(lf(smokeNode))).trimEnd() + s.slice(j); }
  r("uji penjadwalan langsung terhadap salinan restore GAGAL", "uji Harga Berlaku dari PO terhadap salinan restore GAGAL");
  r("uji tulis Edit pemakaian dilakukan HANYA pada salinan restore", "uji tulis PO uji dan harga manual/terjadwal uji dilakukan HANYA pada salinan restore");
  // smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke test baca-saja: pratinjau harga formulir PO pada bahan nyata (SAMA/NAIK/konversi/konflik/BARU; nol penulisan), izin 401/403, penolakan sebelum menulis; TANPA PO/harga percobaan; PO, Harga Berlaku, stok, valuasi, jurnal, biaya beku identik"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (pratinjau harga baca-saja, izin, penolakan sebelum menulis, tanpa jejak tulis, Harga Berlaku lama identik, PO historis tidak diproses, invarian)"');
  // hitung baris pra/pasca switch
  gantiBaris('COUNT_SQL="', `COUNT_SQL="${COUNT_SQL}"`);
  r("hitung baris jadwal/Run/stok/pemakaian/harga/jurnal", "hitung baris stok/biaya beku/harga/Material Issue/jurnal/unit/order/job/pernyataan/run/jadwal/custody/status kerja");
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa Harga Berlaku otomatis dari PO: harga bahan menjadi Harga Berlaku operasional SAAT PO BERHASIL DISIMPAN (draf baru dan ubah draf), atomik dan idempoten, tanpa izin/dialog harga tambahan; persetujuan dan pembatalan PO tidak menulis atau mengembalikan harga; saklar darurat HARGA_DARI_PO=0. TANPA migrasi. Rilis TIDAK memproses PO historis dan TIDAK membuat PO/harga percobaan; tidak mengubah stok, valuasi Finance, jurnal, biaya beku, atau pemakaian lama. Perubahan nyata baru terjadi saat pengguna menyimpan PO. Rollback kode: harga yang sudah tertulis dari PO tetap ada (append-only)."\n');
  s = terapkanKunci(s, blok);
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
