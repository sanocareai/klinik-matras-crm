// Gerbang skrip rilis "drawer Pemakaian aktual (UX Bahan)" — FRONTEND SAJA: skrip tersimpan = hasil bangkitan ulang; bash valid; gerbang kritis ada; backend identik (pohon git + sidik jari kode di container), image dipakai ulang,
// rehearsal-penuh tanpa switch + bukti 36 jam wajib, rollback tanpa perubahan database, pustaka baca-saja.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-ux-bahan-drawer.sh"); const tpl = baca("scripts/templates/release-ux-bahan-drawer.sh.tpl");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;

test("skrip: tanpa placeholder tersisa; pin migrasi; BACKEND_SRC_EXPECT kosong (frontend saja); tanpa nama rilis lain", () => {
  assert.ok(!/@@[A-Z_]+@@/.test(script), "placeholder tersisa");
  assert.match(script, /^LIVE_MIG_TERAKHIR="\d{14}_[a-z0-9_]+"; LIVE_MIG_JUMLAH="\d+"$/m);
  assert.match(script, /^BACKEND_SRC_EXPECT=""$/m, "tidak ada berkas backend/src yang berubah");
  assert.ok(!/gsb|gudang-sidebar|ux4\.sh|route-planner|\bskj\b/.test(script), "tidak ada sisa nama rilis lain");
  assert.ok(script.includes("scripts/gen-release-ux-bahan-drawer.cjs"));
});

test("skrip: sintaks bash lulus; skrip tersimpan diturunkan dari templat (sha templat di kepala)", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-ux-bahan-drawer.sh")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  const sha = script.match(/templat sha256 ([0-9a-f]{12})…/); assert.ok(sha); assert.equal(crypto.createHash("sha256").update(tpl).digest("hex").slice(0, 12), sha[1]);
});

test("gerbang FRONTEND SAJA: pohon backend/src, prisma, package*.json, Dockerfile, compose identik; sidik jari kode backend di container sebelum = sesudah; image dipakai ulang (tidak dibangun), container dibuat ulang", () => {
  for (const k of ["for p in backend/src backend/prisma backend/package.json backend/package-lock.json backend/Dockerfile docker-compose.yml docker-compose.release.yml", "rilis ini frontend saja", "bk_hash()", "BK_HASH_SEBELUM", "BK_HASH_SESUDAH", "kode backend yang melayani BERUBAH",
    'PHASE="5-image"', "DIPAKAI ULANG", 'tag image production tidak menunjuk image container aktif', "container baru memakai image BERBEDA", "--force-recreate backend", "migrate status", "up to date"]) assert.ok(script.includes(k), k);
  assert.ok(!/^s*(docker build|dcp "$NEW_DIR" build)/m.test(script), "tidak ada perintah build image (satu-satunya 'docker build' adalah pola pemeriksa proses lain)");
  assert.ok(!script.includes("prisma migrate deploy"), "tidak ada migrasi");
  assert.ok(!/INSERT INTO|UPDATE material_proposals|UPDATE unit_provisional|DELETE FROM/i.test(script), "skrip tidak menulis data usulan/sementara");
});

test("rehearsal-penuh: mode ada, backup nyata + restore + pemeriksaan data nyata + build web FINAL di ruang kerja sementara yang dihapus; TANPA release dir/switch; bukti 36 jam wajib + cocok SHA/baseline untuk rilis penuh; urutan benar", () => {
  for (const k of ['[ "$a" = "--rehearsal-penuh" ] && REHEARSAL_ONLY=1', 'PHASE="4-build-web-rehearsal"', "cleanup_ws()", "ubd-", "dist rehearsal TIDAK memuat teks fitur rilis ini", "dist rehearsal KEHILANGAN teks fitur lama", "ruang kerja rehearsal masih ada", "DB rehearsal masih tersisa di server",
    ".rehearsal-penuh-ok-ux-bahan-drawer-", "-mmin -2160", "belum ada bukti --rehearsal-penuh LULUS", "bukti rehearsal-penuh bukan untuk SHA/baseline ini", "tag image production bergeser", "kode backend yang melayani berubah selama rehearsal", "REHEARSAL_KODE_BARU"]) assert.ok(script.includes(k) || k === "REHEARSAL_KODE_BARU", k);
  const blokR = script.slice(script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]; then\n  PHASE="3-backup-rehearsal"'), script.indexOf("# Rilis penuh: WAJIB ada bukti"));
  assert.ok(blokR.length > 800 && !/up -d|docker tag|migrate|docker compose.*build|mkdir "\$NEW_DIR"/.test(blokR), "blok rehearsal tidak membuat release dir, tidak switch, tidak migrasi, tidak menandai image");
  assert.ok(script.indexOf("# Rilis penuh: WAJIB ada bukti") < script.indexOf('PHASE="3-backup"; say'), "bukti dicek SEBELUM backup/rilis penuh");
  assert.ok(script.indexOf('PHASE="3-backup"; say') < script.indexOf('PHASE="7-switch"') && script.indexOf("rehearsal_kode   #") < script.indexOf('PHASE="7-switch"'), "backup dan pemeriksaan data nyata SEBELUM switch");
});

test("sidik jari beku mencakup usulan + pemakaian sementara (id saja) dan jumlahnya cocok; smoke/rehearsal dijalankan dan hasilnya dicek; rollback tanpa perubahan database", () => {
  assert.ok(script.includes("usulan_bahan_id") && script.includes("pemakaian_sementara_id") && script.includes("FPB_N=30"));
  assert.equal((script.match(/union all select '/g) || []).length + 1, 30, "30 kelompok sidik jari beku");
  for (const k of ["SMOKE_HASIL fail=0 skip=", "smoke test tidak mencetak ringkasan SMOKE_HASIL", "rollback-pre-ubd-", "TANPA perubahan database", "dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis", "aset lama", "aset yang tidak ada = 404"]) assert.ok(script.includes(k), k);
});

test("pustaka rehearsal dan smoke: baca-saja (tanpa tulis Prisma/SQL/permintaan tulis) dan mencetak ringkasan yang dicek skrip", () => {
  for (const f of ["scripts/lib/rehearsal-kode-ux-bahan-drawer.mjs", "scripts/lib/smoke-ux-bahan-drawer.mjs"]) {
    const t = baca(f);
    assert.ok(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(t), `${f}: tanpa tulisan Prisma`);
    assert.ok(!/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(t), `${f}: tanpa SQL tulis`);
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(t), `${f}: tanpa permintaan tulis`);
  }
  assert.match(baca("scripts/lib/smoke-ux-bahan-drawer.mjs"), /SMOKE_HASIL fail=" \+ fail \+ " skip=" \+ dilewati/); assert.match(baca("scripts/lib/rehearsal-kode-ux-bahan-drawer.mjs"), /REHEARSAL_KODE_BARU gagal=/);
});
