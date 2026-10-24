// Gerbang skrip rilis "evaluasi catatan pemakaian historis: global + atomik" (kode-saja): skrip tersimpan diturunkan dari templat; sintaks bash lulus; gerbang kritis ada;
// tidak ada migrasi/frontend/posting/tulisan data pada skrip rilis; pustaka rehearsal & smoke baca-saja; simulasi tulis HANYA pada DB rehearsal_evl_*.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-evaluasi-catatan.sh");
const tpl = baca("scripts/templates/release-evaluasi-catatan.sh.tpl");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;

test("skrip rilis: tanpa placeholder tersisa, generator terpasang, tanpa sisa nama rilis lain, tepat sembilan berkas backend yang diaudit", () => {
  assert.ok(!/@@[A-Z_]+@@/.test(script), "placeholder tersisa");
  assert.match(script, /^LIVE_MIG_TERAKHIR="\d{14}_[a-z0-9_]+"; LIVE_MIG_JUMLAH="\d+"$/m);
  assert.match(script, /^FRONTEND_SRC_EXPECT=""$/m, "rilis ini tidak mengubah frontend");
  assert.ok(script.split(String.fromCharCode(10)).includes('BACKEND_SRC_EXPECT="backend/src/index.js backend/src/routes/pemakaianKoreksi.js backend/src/services/catatanPemakaianHistoris.js backend/src/services/finance/biayaBahan.js backend/src/services/koreksiPemakaian.js backend/src/services/laporanRekonsiliasiPemakaian.js backend/src/services/postingBatchLatar.js backend/src/services/postingPemakaianHistoris.js backend/src/services/productionOrderExport.js"'), "tepat sembilan berkas backend yang diaudit");
  assert.ok(script.includes("scripts/gen-release-evaluasi-catatan.cjs"));
  assert.ok(!/\bskj\b|jadwal_admin|JAD_|status-kerja-jadwal|route-planner|\brpp\b/.test(script), "tidak ada sisa nama rilis lain");
});

test("skrip rilis: sintaks bash lulus", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-evaluasi-catatan.sh")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("skrip rilis: gerbang kritis — tanpa migrasi/dependensi/frontend, baseline leluhur, tag image = image aktif, kode baru diuji pada restore, tidak boleh memposting", () => {
  for (const k of [
    "backend/prisma berubah — rilis ini TANPA migrasi", "pohon backend/prisma kandidat BERBEDA dari baseline", "dependensi (package.json/lock) berubah", "kandidat mengubah frontend", "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat",
    "tag image ${IMG_NAME} TIDAK menunjuk image container aktif", "migrasi terpasang di produksi TIDAK sama dengan migrasi kandidat", "pemeriksaan kode baru terhadap data restore GAGAL", "pemeriksaan kode baru MENGUBAH isi tabel (harus baca-saja)",
    "simulasi posting bersamaan terhadap data restore GAGAL", "dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis", "smoke test tidak mencetak ringkasan SMOKE_HASIL", "catatan_pemakaian", "catatan_pemakaian_event", "FPB_N=17", "--preflight-only",
    "pergerakan hasil posting historis berubah selama rilis — rilis ini TIDAK boleh memposting", "jumlah catatan DIPOSTING berubah selama rilis", "tabel catatan pemakaian historis kosong di produksi",
  ]) assert.ok(script.includes(k), k);
  assert.ok(!script.includes("prisma migrate deploy"), "rilis ini tidak menerapkan migrasi");
  assert.ok(!/INSERT INTO|UPDATE unit_usage_notes|DELETE FROM|jalankanPosting/i.test(script.replace(/<<'SIMNODE'[\s\S]*?\nSIMNODE\n/, "")), "skrip rilis (di luar simulasi pada salinan) tidak menulis catatan/stok dan tidak memposting");
  assert.ok(script.indexOf('PHASE="5b-rehearsal-kode"') < script.indexOf('PHASE="7-switch"'), "rehearsal pada restore SEBELUM switch");
  assert.ok(script.indexOf('PHASE="3-backup"') < script.indexOf('PHASE="7-switch"'), "backup SEBELUM switch");
});

test("templat: skrip tersimpan diturunkan dari templat (sha templat tercantum di kepala)", () => {
  const sha = script.match(/templat sha256 ([0-9a-f]{12})…/);
  assert.ok(sha, "sha templat tercantum");
  assert.equal(crypto.createHash("sha256").update(tpl).digest("hex").slice(0, 12), sha[1]);
});

test("pustaka rehearsal dan smoke: baca-saja (tanpa tulisan Prisma/SQL/HTTP) dan mencetak ringkasan yang dicek skrip", () => {
  for (const f of ["scripts/lib/rehearsal-kode-evaluasi-catatan.mjs", "scripts/lib/smoke-evaluasi-catatan.mjs"]) {
    const t = baca(f);
    assert.ok(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(t), `${f}: tanpa tulisan Prisma`);
    assert.ok(!/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(t), `${f}: tanpa SQL tulis`);
    assert.ok(!/jalankanPosting|evaluasiUlang\s*\(/.test(t), `${f}: tidak memanggil jalur tulis (hanya periksaKeadaanCatatan)`);
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(t) && !/api\(\s*["'](POST|PUT|PATCH|DELETE)/.test(t), `${f}: tanpa permintaan tulis`);
  }
  assert.match(baca("scripts/lib/smoke-evaluasi-catatan.mjs"), /SMOKE_HASIL fail=" \+ fail \+ " skip=" \+ dilewati/);
  assert.match(baca("scripts/lib/rehearsal-kode-evaluasi-catatan.mjs"), /REHEARSAL_KODE_BARU gagal=/);
});

test("simulasi tulis: pagar keras hanya DB rehearsal_evl_*, dijalankan SESUDAH sidik jari baca-saja lulus dan SEBELUM DB sementara dihapus", () => {
  const sim = baca("scripts/lib/simulasi-evaluasi-catatan.mjs");
  assert.match(sim, /\^rehearsal_evl_\\d\+_\\d\+\$/);
  assert.ok(sim.indexOf("process.exit(1)") < sim.indexOf("jalankanPosting("), "pagar DB sebelum tulisan pertama");
  assert.match(sim, /SIMULASI_EVALUASI gagal=/);
  const iCmp = script.indexOf('fp-all-sebelum.txt" "$BK_DIR/fp-all-sesudah.txt"'); const iSim = script.indexOf("simulasi-evaluasi.log"); const iDrop = script.indexOf("\nreh_drop\n", iSim);
  assert.ok(iCmp > 0 && iSim > iCmp && iDrop > iSim, "urutan: sidik jari sebelum=sesudah → simulasi tulis → drop DB rehearsal");
  assert.ok(script.includes("ok \"DB rehearsal (yang ditulis simulasi) dihapus; production tidak pernah dihubungkan\""));
});

test("rehearsal-penuh: mode ada, TIDAK ada switch/migrasi, image bertag rehearsal, DB sementara dihapus, bukti 36 jam wajib untuk rilis penuh", () => {
  for (const k of ['[ "$a" = "--rehearsal-penuh" ] && REHEARSAL_PENUH=1', "pilih SATU mode saja", "rehearsal_kode()", 'PHASE="3c-rehearsal-penuh"', "tag image PRODUCTION berubah selama build", "tag image production bergeser", "DB rehearsal masih tersisa di server",
    "image rehearsal masih ada", "cleanup_penuh()", ".rehearsal-penuh-ok-evaluasi-catatan-", "-mmin -2160", "belum ada bukti --rehearsal-penuh LULUS", "bukti rehearsal-penuh bukan untuk SHA/baseline ini", "rehearsal-evl-", "rehearsal_evl_", "pre-evl-"]) assert.ok(script.includes(k), k);
  const ra = script.slice(script.indexOf('PHASE="3c-rehearsal-penuh"'), script.indexOf('PHASE="4-release-dir"'));
  assert.ok(ra.length > 500 && !/up -d|docker tag|migrate deploy|docker compose.*up/.test(ra), "cabang rehearsal-penuh tidak menjalankan switch, tag production, atau migrasi");
  assert.ok(script.indexOf('PHASE="3-backup"') < script.indexOf('PHASE="3c-rehearsal-penuh"') && script.indexOf('PHASE="3c-rehearsal-penuh"') < script.indexOf('PHASE="4-release-dir"'), "urutan: backup → rehearsal-penuh (exit 0) → rilis");
  assert.ok(script.indexOf("belum ada bukti --rehearsal-penuh LULUS") < script.indexOf('PHASE="3-backup"'), "bukti dicek SEBELUM backup/rilis penuh");
});
