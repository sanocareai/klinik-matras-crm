// Gerbang skrip rilis "Konfirmasi manifest posting historis" (5 berkas backend + 3 frontend, TANPA migrasi): skrip tersimpan diturunkan dari templat; sintaks bash lulus; gerbang kritis ada;
// build frontend + aset lama; evaluator/penulis live tidak berubah; skrip tidak memposting; pustaka rehearsal/smoke tidak menulis (smoke hanya mengirim POST tanpa izin yang HARUS ditolak 403).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-posting-historis-ui.sh");
const tpl = baca("scripts/templates/release-posting-historis-ui.sh.tpl");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;

test("skrip rilis: tanpa placeholder, generator terpasang, tanpa sisa nama rilis lain, daftar berkas backend (5) dan frontend (3) yang diaudit", () => {
  assert.ok(!/@@[A-Z_]+@@/.test(script), "placeholder tersisa");
  assert.match(script, /^LIVE_MIG_TERAKHIR="\d{14}_[a-z0-9_]+"; LIVE_MIG_JUMLAH="\d+"$/m);
  const be = script.split("\n").find((l) => l.startsWith("BACKEND_SRC_EXPECT=")); assert.equal(be, 'BACKEND_SRC_EXPECT="backend/src/routes/pemakaianKoreksi.js backend/src/services/postingBatchLatar.js backend/src/services/postingKonfirmasiManifest.js backend/src/services/postingPemakaianHistoris.js backend/src/services/postingPratinjau.js"', "tepat lima berkas backend yang diaudit");
  const fe = script.split("\n").find((l) => l.startsWith("FRONTEND_SRC_EXPECT=")); assert.ok(fe && fe.includes("WarehousePostingHistoris.jsx") && fe.includes("postingHistorisModel.js") && fe.includes("frontend/src/api.js"), "daftar frontend yang diaudit");
  assert.ok(script.includes("scripts/gen-release-posting-historis-ui.cjs"));
  assert.ok(!/evaluasi-catatan|\bskj\b|\bevl\.sh|route-planner/.test(script.split(String.fromCharCode(10)).filter((l) => !l.startsWith("ALLOWED_RE=")).join(String.fromCharCode(10)).replace(/rehearsal_evl_/g, "").replace(/simulasi-evaluasi-catatan/g, "")), "tidak ada sisa nama rilis lain (pustaka simulasi dipakai ulang sengaja)");
});

test("skrip rilis: sintaks bash lulus", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-posting-historis-ui.sh")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("skrip rilis: gerbang kritis — tanpa migrasi/dependensi/Docker, baseline leluhur, tag image = image aktif, evaluator live identik, tidak memposting", () => {
  for (const k of [
    "backend/prisma berubah — rilis ini TANPA migrasi", "pohon backend/prisma kandidat BERBEDA dari baseline", "dependensi (package.json/lock) berubah", "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat",
    "tag image ${IMG_NAME} TIDAK menunjuk image container aktif", "migrasi terpasang di produksi TIDAK sama dengan migrasi kandidat", "pemeriksaan kode baru terhadap data restore GAGAL", "pemeriksaan kode baru MENGUBAH isi tabel (harus baca-saja)",
    "simulasi posting bersamaan terhadap data restore GAGAL", "dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis", "smoke test tidak mencetak ringkasan SMOKE_HASIL", "FPB_N=17", "--preflight-only",
    "pergerakan hasil posting historis berubah selama rilis — rilis ini TIDAK boleh memposting", "jumlah catatan DIPOSTING berubah selama rilis", "frontend/src yang berubah bukan tepat daftar yang diaudit", "backend/src yang berubah bukan tepat yang diaudit",
  ]) assert.ok(script.includes(k), k);
  assert.ok(!script.includes("kandidat mengubah frontend"), "frontend memang berubah pada rilis ini");
  assert.ok(!script.includes("prisma migrate deploy"), "rilis ini tidak menerapkan migrasi");
  assert.ok(!/INSERT INTO|UPDATE unit_usage_notes|DELETE FROM|jalankanPosting/i.test(script.replace(/<<'SIMNODE'[\s\S]*?\nSIMNODE\n/, "")), "skrip rilis (di luar simulasi pada salinan) tidak menulis catatan/stok dan tidak memposting");
  const guard = script.split("\n").find((l) => l.startsWith("GUARD_UNCHANGED="));
  assert.ok(!guard.includes("postingPemakaianHistoris.js"), "postingPemakaianHistoris.js sengaja berubah (pagar sebelum movement)");
  for (const f of ["catatanPemakaianHistoris.js", "koreksiPemakaian.js", "finance/biayaBahan.js", "productionOrderExport.js", "laporanRekonsiliasiPemakaian.js", "backend/src/index.js", "inventoryLedger.js"]) assert.ok(guard.includes(f), `berkas pelindung: ${f}`);
  assert.ok(script.indexOf('PHASE="5b-rehearsal-kode"') < script.indexOf('PHASE="7-switch"'), "rehearsal pada restore SEBELUM switch");
  assert.ok(script.indexOf('PHASE="3-backup"') < script.indexOf('PHASE="7-switch"'), "backup SEBELUM switch");
});

test("build frontend: node_modules identik dicari, dist baru diperiksa (Maps key, teks fitur baru + lama, chunk halaman), aset lama dibawa, dipakai di rehearsal DAN rilis", () => {
  for (const k of ["bangun_frontend()", "tidak ada release dengan frontend/node_modules dan package.json identik", "dist baru TIDAK memuat teks fitur rilis ini", "dist baru KEHILANGAN teks fitur lama", "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY",
    "chunk halaman Posting Pemakaian Historis tidak ada di dist baru", 'PHASE="4c-aset-lama"', "aset lama (${ASET_LAMA_CONTOH}) tidak lagi terlayani", 'PHASE="4b-rehearsal-frontend"', "rute SPA /warehouse/posting-historis tidak 200", "chunk halaman baru tidak terlayani publik"]) assert.ok(script.includes(k), k);
  assert.ok((script.match(/bangun_frontend "\$/g) || []).length === 2, "dipanggil di rehearsal ($WS) dan rilis ($NEW_DIR)");
  assert.ok(script.indexOf("bangun_frontend() {") < script.indexOf('bangun_frontend "$WS"'), "fungsi didefinisikan sebelum dipakai");
  for (const t of ["Konfirmasi manifest oleh Owner", "Rujukan yang akan dicatat", "Order yang akan diposting", "bukan persetujuan Owner yang tercatat terpisah", "BELUM DIKETAHUI (bukan Rp0)", "Pilih hanya yang tampil", "Hentikan setelah order ini"]) assert.ok(script.includes(`"${t}"`), `teks dist baru: ${t}`);
  assert.ok(!script.includes('cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist"'), "dist TIDAK lagi disalin dari release aktif — dibangun baru");
  assert.ok(script.indexOf('PHASE="4c-aset-lama"') < script.indexOf('PHASE="5-build-image"'), "aset lama dibawa sebelum build image/switch");
});

test("templat: skrip tersimpan diturunkan dari templat (sha templat tercantum di kepala)", () => {
  const sha = script.match(/templat sha256 ([0-9a-f]{12})…/);
  assert.ok(sha, "sha templat tercantum");
  assert.equal(crypto.createHash("sha256").update(tpl).digest("hex").slice(0, 12), sha[1]);
});

test("pustaka rehearsal: baca-saja; smoke: hanya GET + POST tanpa izin yang harus ditolak; keduanya mencetak ringkasan yang dicek skrip", () => {
  const reh = baca("scripts/lib/rehearsal-kode-posting-ui.mjs"); const smoke = baca("scripts/lib/smoke-posting-ui.mjs");
  for (const [f, t] of [["rehearsal", reh], ["smoke", smoke]]) {
    assert.ok(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(t), `${f}: tanpa tulisan Prisma`);
    assert.ok(!/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(t), `${f}: tanpa SQL tulis`);
    assert.ok(!/jalankanPosting|jalankanBatch|ajukanBatch|mulaiBatch|evaluasiUlang\s*\(/.test(t), `${f}: tidak memanggil jalur tulis`);
  }
  assert.match(reh, /pratinjauPosting/); assert.match(reh, /REHEARSAL_KODE_BARU gagal=/); assert.match(smoke, /SMOKE_HASIL fail=" \+ fail \+ " skip=" \+ dilewati/);
  const posts = [...smoke.matchAll(/kirim\("POST", [^)]*\)/g)].length; assert.ok(posts === 4, "empat POST gerbang izin");
  assert.ok(/adminMurni/.test(smoke) && /SMOKE-TANPA-IZIN/.test(smoke) && /every\(\(x\) => x === 403\)/.test(smoke), "POST hanya dari ADMIN tanpa izin persetujuan dan wajib 403");
  assert.ok(!/method:\s*["'](PUT|PATCH|DELETE)/i.test(smoke), "tanpa PUT/PATCH/DELETE");
});

test("rehearsal-penuh: mode ada, TIDAK ada switch/migrasi, image bertag rehearsal, DB sementara dihapus, bukti 36 jam wajib untuk rilis penuh", () => {
  for (const k of ['[ "$a" = "--rehearsal-penuh" ] && REHEARSAL_PENUH=1', "pilih SATU mode saja", "rehearsal_kode()", 'PHASE="3c-rehearsal-penuh"', "tag image PRODUCTION berubah selama build", "tag image production bergeser", "DB rehearsal masih tersisa di server",
    "image rehearsal masih ada", "cleanup_penuh()", ".rehearsal-penuh-ok-posting-historis-ui-", "-mmin -2160", "belum ada bukti --rehearsal-penuh LULUS", "bukti rehearsal-penuh bukan untuk SHA/baseline ini", "rehearsal-pui-", "rehearsal_evl_", "pre-pui-"]) assert.ok(script.includes(k), k);
  const ra = script.slice(script.indexOf('PHASE="3c-rehearsal-penuh"'), script.indexOf('PHASE="4-release-dir"'));
  assert.ok(ra.length > 500 && !/up -d|docker tag|migrate deploy|docker compose.*up/.test(ra), "cabang rehearsal-penuh tidak menjalankan switch, tag production, atau migrasi");
  assert.ok(script.indexOf('PHASE="3-backup"') < script.indexOf('PHASE="3c-rehearsal-penuh"') && script.indexOf('PHASE="3c-rehearsal-penuh"') < script.indexOf('PHASE="4-release-dir"'), "urutan: backup → rehearsal-penuh (exit 0) → rilis");
  assert.ok(script.indexOf("belum ada bukti --rehearsal-penuh LULUS") < script.indexOf('PHASE="3-backup"'), "bukti dicek SEBELUM backup/rilis penuh");
});
