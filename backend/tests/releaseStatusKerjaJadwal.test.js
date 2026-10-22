// Gerbang skrip rilis "status kerja Dijadwalkan dari Rencana Admin" (kode-saja): skrip tersimpan = hasil bangkitan ulang generator; sintaks bash lulus; gerbang kritis ada; tidak ada migrasi/frontend/tulisan data.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-status-kerja-jadwal.sh");
const tpl = baca("scripts/templates/release-status-kerja-jadwal.sh.tpl");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;

test("skrip rilis: tidak ada placeholder tersisa, templat dan generator terpasang, nama berkas konsisten", () => {
  assert.ok(!/@@[A-Z_]+@@/.test(script), "placeholder tersisa");
  assert.match(script, /^LIVE_MIG_TERAKHIR="\d{14}_[a-z0-9_]+"; LIVE_MIG_JUMLAH="\d+"$/m);
  assert.match(script, /^FRONTEND_SRC_EXPECT=""$/m, "rilis ini tidak mengubah frontend");
  assert.match(script, /^BACKEND_SRC_EXPECT="backend\/src\/lib\/domain\/productionWorkStatus\.js backend\/src\/services\/productionOrderList\.js"$/m, "tepat dua berkas backend yang diaudit");
  assert.ok(script.includes("scripts/gen-release-status-kerja-jadwal.cjs"));
  assert.ok(!/route-planner|\brpp\b/.test(script), "tidak ada sisa nama rilis lain");
});

test("skrip rilis: sintaks bash lulus", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-status-kerja-jadwal.sh")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("skrip rilis: gerbang kritis ada — tanpa migrasi/dependensi/frontend, baseline leluhur, tag image = image aktif, pasang ulang hanya bila baca-saja terbukti", () => {
  for (const k of [
    "backend/prisma berubah — rilis ini TANPA migrasi", "pohon backend/prisma kandidat BERBEDA dari baseline", "dependensi (package.json/lock) berubah", "kandidat mengubah frontend", "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat",
    "tag image ${IMG_NAME} TIDAK menunjuk image container aktif", "migrasi terpasang di produksi TIDAK sama dengan migrasi kandidat", "pemeriksaan kode baru terhadap data restore GAGAL", "pemeriksaan kode baru MENGUBAH isi tabel (harus baca-saja)",
    "dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis", "smoke test tidak mencetak ringkasan SMOKE_HASIL", "jadwal_admin", "jadwal_admin_event", "FPB_N=17", "--preflight-only",
  ]) assert.ok(script.includes(k), k);
  assert.ok(!script.includes("prisma migrate deploy"), "rilis ini tidak menerapkan migrasi");
  assert.ok(!/INSERT INTO|UPDATE production_unit_schedules|DELETE FROM/i.test(script), "skrip rilis tidak menulis data jadwal");
  assert.ok(script.indexOf('PHASE="5b-rehearsal-kode"') < script.indexOf('PHASE="7-switch"'), "rehearsal pada restore SEBELUM switch");
  assert.ok(script.indexOf('PHASE="3-backup"') < script.indexOf('PHASE="7-switch"'), "backup SEBELUM switch");
});

test("templat: skrip tersimpan diturunkan dari templat (sha templat tercantum di kepala)", () => {
  const sha = script.match(/templat sha256 ([0-9a-f]{12})…/);
  assert.ok(sha, "sha templat tercantum");
  assert.equal(crypto.createHash("sha256").update(tpl).digest("hex").slice(0, 12), sha[1]);
});

test("pustaka rehearsal dan smoke: baca-saja (tanpa create/update/delete/upsert/INSERT) dan mencetak ringkasan yang dicek skrip", () => {
  for (const f of ["scripts/lib/rehearsal-kode-status-kerja-jadwal.mjs", "scripts/lib/smoke-status-kerja-jadwal.mjs"]) {
    const t = baca(f);
    assert.ok(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(t), `${f}: tanpa tulisan Prisma`);
    assert.ok(!/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(t), `${f}: tanpa SQL tulis`);
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(t) && !/api\(\s*["'](POST|PUT|PATCH|DELETE)/.test(t), `${f}: tanpa permintaan tulis`);
  }
  assert.match(baca("scripts/lib/smoke-status-kerja-jadwal.mjs"), /SMOKE_HASIL fail=" \+ fail \+ " skip=" \+ dilewati/);
  assert.match(baca("scripts/lib/rehearsal-kode-status-kerja-jadwal.mjs"), /REHEARSAL_KODE_BARU gagal=/);
});

test("rehearsal-penuh: mode ada, TIDAK ada switch/migrasi, image bertag rehearsal (tag production tidak disentuh), DB sementara dihapus, bukti 36 jam wajib untuk rilis penuh", () => {
  for (const k of ['[ "$a" = "--rehearsal-penuh" ] && REHEARSAL_PENUH=1', "pilih SATU mode saja", "rehearsal_kode()", 'PHASE="3c-rehearsal-penuh"', "tag image PRODUCTION berubah selama build", "tag image production bergeser", "DB rehearsal masih tersisa di server",
    "image rehearsal masih ada", "cleanup_penuh()", ".rehearsal-penuh-ok-status-kerja-jadwal-", "-mmin -2160", "belum ada bukti --rehearsal-penuh LULUS", "bukti rehearsal-penuh bukan untuk SHA/baseline ini", "rehearsal-skj-"]) assert.ok(script.includes(k), k);
  const ra = script.slice(script.indexOf('PHASE="3c-rehearsal-penuh"'), script.indexOf('PHASE="4-release-dir"'));
  assert.ok(ra.length > 500 && !/up -d|docker tag|migrate deploy|docker compose.*up/.test(ra), "cabang rehearsal-penuh tidak menjalankan switch, tag production, atau migrasi");
  assert.ok(script.indexOf('PHASE="3-backup"') < script.indexOf('PHASE="3c-rehearsal-penuh"') && script.indexOf('PHASE="3c-rehearsal-penuh"') < script.indexOf('PHASE="4-release-dir"'), "urutan: backup → rehearsal-penuh (exit 0) → rilis");
  assert.ok(script.indexOf("belum ada bukti --rehearsal-penuh LULUS") < script.indexOf('PHASE="3-backup"'), "bukti dicek SEBELUM backup/rilis penuh");
});
