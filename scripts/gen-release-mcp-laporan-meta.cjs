// Generator skrip rilis bergerbang "MCP laporan Meta Ads" (BACKEND-SAJA, TANPA migrasi, TANPA perubahan schema.prisma/frontend/env).
// Hasil: scripts/release-mcp-laporan-meta.sh — diturunkan dari scripts/release-po-barang-mirip.sh (kerangka rilis kode-saja bergerbang yang SUDAH LIVE: gerbang identitas kode live, tanpa pembersihan,
// rollback ke image live sebelumnya) + blok di scripts/templates/release-mcp-laporan-meta/* + pustaka scripts/lib/{rehearsal,smoke}-mcp-laporan-meta.mjs.
// Semua nilai yang bergantung pada commit (allowlist berkas, daftar berkas backend) dihitung dari git terhadap baseline.
//
//   node scripts/gen-release-mcp-laporan-meta.cjs --base <SHA_LIVE>          # bangkitkan ulang (base = commit release aktif)
//   node scripts/gen-release-mcp-laporan-meta.cjs --base <SHA_LIVE> --check  # gagal (exit 1) bila skrip tersimpan berbeda dari hasil bangkitan ulang
//
// WAJIB dibangkitkan ulang dari commit FINAL setelah baseline live digabung (allowlist = berkas yang berbeda dari base). Skrip rilis menolak berkas di luar allowlist.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BASE_SCRIPT = "scripts/release-po-barang-mirip.sh";
const OUT = "scripts/release-mcp-laporan-meta.sh";
const TPL_DIR = "scripts/templates/release-mcp-laporan-meta";
const LIB_REH = "scripts/lib/rehearsal-mcp-laporan-meta.mjs", LIB_SMOKE = "scripts/lib/smoke-mcp-laporan-meta.mjs";
const GENERATOR = "scripts/gen-release-mcp-laporan-meta.cjs";
const TPL_FILES = ["header", "rollback"].map((n) => `${TPL_DIR}/${n}.txt`);
const FILE_TETAP = [OUT, GENERATOR, LIB_REH, LIB_SMOKE, ...TPL_FILES];
const CAND_BRANCH = "feat/mcp-laporan-meta-ads";
// Berkas backend/src yang HARUS ikut (rilis tanpa mereka = tool tidak ada / tidak terlihat oleh ChatGPT).
const WAJIB_BACKEND = ["backend/src/mcp/toolsAtribusiIklan.js", "backend/src/mcp/index.js", "backend/src/mcp/chatgptPlugin.js", "backend/src/services/attribution/laporanMeta.js", "backend/src/services/attribution/penjagaLaporan.js", "backend/src/services/attribution/iklanReport.js"];

const lf = (t) => t.replace(/\r\n/g, "\n");
const must = (c, m) => { if (!c) throw new Error("templat/masukan tak cocok: " + m); };
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitLines = (args) => git(args).split("\n").map((x) => x.trim()).filter(Boolean);
const esc = (f) => f.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

const COUNT_SQL = "select 'customers', count(*) from \\\"Customer\\\" union all select 'orders', count(*) from \\\"Order\\\" union all select 'payments', count(*) from payments union all select 'touches', count(*) from attribution_touches union all select 'references', count(*) from meta_ad_references union all select 'spend_rows', count(*) from meta_ad_daily_spend union all select 'spend_imports', count(*) from meta_spend_imports union all select 'journal_entries', count(*) from fin_journal_entries";
const UJI_PENANDA = "# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): ";

function bangkitkan({ baseScript, blok, berkasList, rehNode, smokeNode }) {
  let s = lf(baseScript);
  const r = (a, b) => { must(s.includes(a), "penanda: " + a.slice(0, 90)); s = s.split(a).join(b); };
  const potong = (awal, akhir, ganti) => { const i = s.indexOf(awal); const j = s.indexOf(akhir, i + awal.length); must(i >= 0 && j >= 0, `penanda: ${awal.slice(0, 60)} .. ${akhir.slice(0, 60)}`); s = s.slice(0, i) + ganti + s.slice(j); };
  const gantiBaris = (awalan, baru) => { const L = s.split("\n"); const i = L.findIndex((l) => l.startsWith(awalan)); must(i >= 0, "baris berawalan: " + awalan.slice(0, 70)); L[i] = baru; s = L.join("\n"); };
  const berkas = [...new Set([...berkasList, ...FILE_TETAP])].filter((f) => !f.startsWith("frontend/dist/")).sort();
  const be = berkas.filter((f) => f.startsWith("backend/src/")).join(" ");
  must(!berkas.some((f) => /^backend\/prisma\//.test(f)), "rilis ini TANPA migrasi/schema: ada perubahan backend/prisma");
  must(!berkas.some((f) => /^frontend\//.test(f)), "rilis ini BACKEND-SAJA: ada perubahan frontend/");
  must(!berkas.some((f) => /package(-lock)?\.json$|(^|\/)docker-compose|(^|\/)Dockerfile$|(^|\/)\.env/.test(f)), "dependensi/compose/.env berubah");
  must(!berkas.includes("backend/src/index.js"), "index.js berubah (dipatok tes atribusi)");
  for (const wajib of WAJIB_BACKEND) must(berkas.includes(wajib), "berkas wajib tidak ada di diff: " + wajib);
  must(!berkas.some((f) => /^backend\/src\/(routes\/(analytics|conversations)|middleware\/cacheSingkat)\.js$/.test(f)), "rilis ini tidak boleh menyentuh berkas hotfix performa");

  potong('# RILIS "PO BARANG MIRIP"', "set -Eeuo pipefail", lf(blok.header));
  r('CAND_BRANCH="${CAND_BRANCH:-fix/po-barang-mirip-on-17305848}"', `CAND_BRANCH="\${CAND_BRANCH:-${CAND_BRANCH}}"`);
  const L = s.split("\n"); const ia = L.findIndex((l) => l.startsWith("ALLOWED_RE=")); must(ia > 0 && L[ia + 1].startsWith("BACKEND_SRC_EXPECT=") && L[ia + 2].startsWith("FRONTEND_SRC_EXPECT="), "ALLOWED_RE");
  L[ia] = `ALLOWED_RE='^(${berkas.map(esc).join("|")})$'`; L[ia + 1] = `BACKEND_SRC_EXPECT="${be}"`; L[ia + 2] = 'FRONTEND_SRC_EXPECT=""   # rilis backend-saja: tidak ada berkas frontend yang boleh berubah';
  s = L.join("\n");
  gantiBaris("[ \"$(printf '%s\\n' \"$CHANGED\" | grep -E '^frontend/src/'", '[ -z "$(printf \'%s\\n\' "$CHANGED" | grep -E \'^frontend/\' || true)" ] || die "rilis ini BACKEND-SAJA: ada berkas frontend/ yang berbeda dari baseline"');
  // nama kunci/backup/tag/DB sementara khusus rilis ini
  r("po-barang-mirip", "mcp-laporan-meta"); r("rollback-pre-pbm-", "rollback-pre-mlm-"); r("rehearsal_pbm_", "rehearsal_mlm_"); r('grep -v "pbm\\|release-mcp-laporan-meta', 'grep -v "mlm\\|release-mcp-laporan-meta');
  // blok rollback
  { const i = s.indexOf("Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya"); const j = s.indexOf("\nEOF\n", i); must(i >= 0 && j > i, "blok rollback"); const k = s.lastIndexOf("\n", j - 1) + 1; s = s.slice(0, i) + lf(blok.rollback).trimEnd() + "\n" + s.slice(k); }
  // fase 2b: tanpa node_modules frontend (tidak ada build)
  potong('say "2b. Sumber node_modules frontend', 'if [ "$PREFLIGHT_ONLY" = "1" ]',
    'say "2b. Ruang disk (rilis backend-saja: tanpa build dan tanpa node_modules frontend)"\nDB_BYTES="$(psql_live -At -c "select pg_database_size(\'${DB_NAME}\')")"; AVAIL_KB="$(df -Pk "$HOME" | awk \'NR==2{print $4}\')"\n[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"\nok "ruang disk cukup"\n');
  // fase 4: dist release aktif dibawa apa adanya
  gantiBaris('cp -a "$NM_SRC"', 'cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin frontend/dist release aktif"');
  potong('say "4b. Build frontend di release dir', 'PHASE="5-build-image"',
    'PHASE="4b-dist-tetap"; say "4b. Rilis BACKEND-SAJA: frontend/dist release aktif dibawa APA ADANYA (tidak dibangun ulang; tidak ada aset yang berubah)"\n' +
    'diff -rq "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" >/dev/null || die "frontend/dist release baru berbeda dari release aktif"\n' +
    'NEW_INDEX="$PREV_INDEX"\n[ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "bundel utama tidak ada di dist yang dibawa"\n' +
    'ok "frontend/dist identik dengan release aktif (${NEW_INDEX}); tidak ada build frontend"\n\n');
  // fase 8: bundel publik = dist yang dibawa
  gantiBaris('[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o \'index-', '[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o \'index-[A-Za-z0-9_-]*\\.js\' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik berubah (harus tetap ${NEW_INDEX})"; ok "bundel web publik tetap ${NEW_INDEX} (frontend tidak berubah)"');
  // smoke pasca-switch: tanpa pemeriksaan aset lama (tidak ada aset yang dibawa)
  potong('OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"', '[ "$(curl -s -o /dev/null -w \'%{http_code}\' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ]', "");
  // rehearsal
  gantiBaris(UJI_PENANDA, UJI_PENANDA + "MCP laporan Meta Ads — server kode baru, tiga jalur auth (OAuth ChatGPT, OAuth Claude, token statis), hasil tool == endpoint, tidak ada baris berubah. Tool baca-saja, jadi tanpa skenario tulis. DB dihapus di akhir.");
  { const i = s.indexOf("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\""); must(i >= 0, "REHNODE"); const awalIsi = s.indexOf("\n", i) + 1; const j = s.indexOf("\nREHNODE\n", awalIsi); must(j > 0, "akhir REHNODE");
    s = s.slice(0, awalIsi) + lf(rehNode).replace('"@@SMOKE_SRC@@"', () => JSON.stringify(lf(smokeNode))).trimEnd() + s.slice(j); }
  r("uji PO barang mirip terhadap salinan restore GAGAL", "uji MCP laporan Meta Ads terhadap salinan restore GAGAL");
  r("uji tulis PO/SKU dilakukan HANYA pada salinan restore", "uji server/auth/tool dilakukan HANYA pada salinan restore");
  // smoke baca-saja pasca-switch
  { const a = s.indexOf("<<'NODE' | tee"); const aLine = s.indexOf("\n", a) + 1; const b = s.indexOf("\nNODE\n", aLine); must(a > 0 && b > 0, "NODE smoke"); s = s.slice(0, aLine) + lf(smokeNode).trimEnd() + s.slice(b); }
  gantiBaris('PHASE="8b-smoke"; say "', 'PHASE="8b-smoke"; say "8b. Smoke test baca-saja lewat jalur auth yang sebenarnya (OAuth ChatGPT, OAuth Claude, token statis bila ada): tools/list memuat tiga tool, hasil tool == endpoint, tool lama kompatibel, tanpa jejak tulis"');
  gantiBaris('  ok "smoke test lulus (', '  ok "smoke test lulus (auth nyata, tools/list, hasil tool == endpoint, tool lama, tanpa jejak tulis, invarian)"');
  gantiBaris('COUNT_SQL="', `COUNT_SQL="${COUNT_SQL}"`);
  r("hitung baris material/katalog/asal SKU/PO/Harga Berlaku/stok/jurnal", "hitung baris customer/order/pembayaran/touch/referensi/spend/jurnal");
  gantiBaris('say "CATATAN:', 'say "CATATAN: Rilis ini membawa tiga tool MCP laporan Meta Ads (/mcp dan /mcp-chatgpt sebagai sales_*). TANPA migrasi, TANPA perubahan frontend/env, TANPA tulisan data. SESUDAH rilis (manual, belum terbukti oleh skrip ini): (1) claude.ai: Pengaturan > Konektor > SANSS CRM > putuskan lalu sambungkan ulang atau mulai percakapan baru; (2) ChatGPT: Developer Mode > app SANSS > Refresh (atau buat ulang koneksi), lalu minta Mesa memanggil sales_kesehatan_atribusi_meta; (3) bila Custom GPT Actions dipakai, ambil ulang /gpt-actions/openapi.json. Jangan klaim konektor terhubung sebelum satu panggilan nyata dari klien berhasil."');
  must(!/@@[A-Z_]+@@/.test(s), "placeholder tersisa");
  const sisa = s.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !l.startsWith("#") && /barang mirip|PO\/SKU|BUS-0|purchase.?order|kemiripanBarang|\bpbm\b|reh-pbm|NM_SRC|OLD_ASSETS|LOCK_NEW/i.test(l)).map(([i]) => i);
  s = lf(s);
  return { script: s, ringkasan: { berkas: berkas.length, backendSrc: berkas.filter((f) => f.startsWith("backend/src/")).length, frontend: 0, barisSisaFiturLama: sisa } };
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
  if (hasil.ringkasan.barisSisaFiturLama.length) { console.error("SISA fitur lama di skrip (baris): " + hasil.ringkasan.barisSisaFiturLama.join(",")); process.exit(1); }
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
