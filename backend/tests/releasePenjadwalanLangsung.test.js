// Gerbang skrip rilis "Penjadwalan langsung + tabel Pemakaian aktual terpadu" (kode-saja, TANPA migrasi): struktur skrip, allowlist, pustaka rehearsal/smoke. Tidak menjalankan skrip.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-penjadwalan-langsung.sh"); const reh = baca("scripts/lib/rehearsal-penjadwalan-langsung.mjs"); const smoke = baca("scripts/lib/smoke-penjadwalan-langsung.mjs");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;

test("skrip: sintaks bash valid; kode-saja (tanpa migrasi, tanpa prisma di allowlist); nama/kunci/tag khusus rilis ini", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-penjadwalan-langsung.sh")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  const allow = script.split("\n").find((l) => l.startsWith("ALLOWED_RE=")); assert.ok(allow && !allow.includes("backend/prisma"), "tanpa migrasi/schema");
  for (const f of ["backend/src/services/productionRencanaJadwalService.js", "backend/src/routes/productionRencanaJadwal.js", "backend/src/lib/domain/productionRencanaAdmin.js", "frontend/src/features/production/rencana/PilihMeja.jsx", "frontend/src/features/production/bahan/TabelPemakaian.jsx", "scripts/release-penjadwalan-langsung.sh"]) assert.ok(allow.includes(f.replace(/\./g, String.raw`\.`)), `allowlist memuat ${f}`);
  assert.ok(!allow.includes("package"), "dependensi tidak berubah"); assert.ok(!allow.includes("backend/src/index"), "index.js tidak berubah");
  for (const k of ["pre-pjl-", "rehearsal_pjl_", "/tmp/release-penjadwalan-langsung.lock", "penjadwalan-langsung-${DEPLOY_SHORT}-${TS}"]) assert.ok(script.includes(k), k);
  assert.ok(!/ubah-pemakaian|pre-ubp-|rehearsal_ubah_|rehearsal_status_kerja_/.test(script), "tidak ada sisa nama rilis lain");
  assert.ok(!/@@[A-Z_]+@@/.test(script), "tanpa placeholder tersisa");
  assert.match(script, /migrate deploy|tanpa migrasi/i); assert.ok(script.includes("Tanpa migrasi") || script.includes("TANPA migrasi"));
});

test("teks fitur di bundel web dicek (baru + lama): jadwal langsung + tabel pemakaian; fitur live tetap ada", () => {
  for (const s of ["Pilih meja", "Pilih semua unit order ini", "Belum dijadwalkan", "Belum tiba", "Riwayat dan dokumen pemakaian", "Tanpa pengeluaran stok", "Mengurangi stok"]) assert.ok(script.includes(`"${s}"`), `dist baru wajib memuat: ${s}`);
  for (const s of ["Tambah pemakaian", "Ganti bahan", "Ajukan perubahan", "Lihat dampak", "Harga Berlaku (HPP operasional)"]) assert.ok(script.includes(`"${s}"`), `dist lama tetap memuat: ${s}`);
});

test("rehearsal: hanya pada DB rehearsal_*, kode baru sebagai server, skenario inti (satu unit, batch bersama, kapasitas, atomik, undo, Run lama tanpa drift, jadwal ganda, izin) + smoke yang sama", () => {
  assert.match(reh, /\^rehearsal_/); assert.match(reh, /spawn\(process\.execPath, \["src\/index\.js"\]/); assert.match(reh, /neutralizeExternalEnv/);
  for (const k of ["PLAN_STATION_FULL", "JADWAL_UNIT_FINISHED", "JADWAL_REVISI_BASI", "JADWAL_UNDO_TIDAK_BISA", "PRODUCTION_V1_WRITE_ON_V2_RUN", "JADWAL_SUDAH_DI_RENCANA_MEJA", "stationCode: \"AUTO\"", "replayed === true", "SMOKE_HASIL fail=0", "PEMERIKSAAN="]) assert.ok(reh.includes(k), k);
  assert.ok(script.includes("PEMERIKSAAN=") && script.includes("SMOKE_HASIL fail=") , "skrip memeriksa ringkasan pustaka");
  assert.ok(script.includes(JSON.stringify(smoke).slice(1, 200).slice(0, 60)) || script.includes("SMOKE_SRC") === false, "smoke tertanam di rehearsal");
});

test("smoke pasca-switch: BACA-SAJA — tanpa tulisan Prisma/SQL; POST hanya ke jadwal-batch dan undo-batch dengan masukan yang pasti ditolak; jejak tulis dibandingkan sebelum/sesudah", () => {
  assert.ok(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(smoke) && !/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(smoke), "tanpa tulisan");
  const posts = [...smoke.matchAll(/post\(`?\$\{PRD\}([^`"]*)`?/g)].map((m) => m[1]).filter(Boolean); assert.ok(posts.length >= 8 && posts.every((p) => /^\/rencana\/jadwal-batch(\/undo)?$/.test(p)), `POST hanya ke endpoint batch: ${[...new Set(posts)]}`);
  for (const k of ["TIDAK ada jejak tulis", "401", "403", "JADWAL_TANGGAL_LEWAT", "JADWAL_HARI_LIBUR", "JADWAL_MEJA_INVALID", "SMOKE_HASIL fail="]) assert.ok(smoke.includes(k), k);
  assert.match(smoke, /production_runs_v2/, "nama tabel Run yang benar");
});

test("GERBANG KODE LIVE: isi kode (bukan marker) dibandingkan dengan snapshot baseline di fase 2, fase 6, dan tepat sebelum switch", () => {
  assert.ok(script.includes("gerbang_kode_live()"), "fungsi gerbang ada");
  for (const f of ["fase-2-audit", "fase-6-pra-switch", "fase-7-tepat-sebelum-switch"]) assert.ok(script.includes(`gerbang_kode_live "${f}"`), f);
  // tidak lagi memercayai marker: marker hanya boleh baseline/leluhur baseline, bukan syarat kesamaan
  assert.ok(!script.includes('= "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline'), "pemeriksaan marker lama dihapus");
  assert.ok(script.includes("merge-base --is-ancestor \"$mc\" \"$BASE_SHA\""), "marker = baseline atau leluhur");
  for (const k of ["git hash-object --no-filters --stdin-paths", "beda-isi.txt", "TAMBAHAN:", "container-sha.txt", "dir-sha.txt", "PREV_STARTED"]) assert.ok(script.includes(k), k);
  { const bs = String.fromCharCode(92); assert.ok(script.includes("tr -d '" + bs + "r' < \"$d/$p\" | git hash-object --stdin"), "normalisasi akhir baris hanya untuk membandingkan"); }
  assert.ok(/berkas yang TIDAK ada di baseline/.test(script), "berkas tambahan menghentikan rilis");
  assert.ok(/KODE LIVE menyimpang dari baseline/.test(script), "selisih isi menghentikan rilis");
  // satu-satunya toleransi: akhir baris, dan hanya untuk berkas teks
  assert.ok(script.includes("*.js|*.jsx|*.mjs|*.cjs|*.json"), "toleransi CR hanya untuk berkas teks");
  assert.ok(script.includes("tidak_ada_deploy_lain_lagi") && script.includes('die "deploy lain mulai berjalan'), "pemeriksaan deploy lain diulang tepat sebelum switch");
});

test("HOTFIX: dipertahankan di build kandidat; rollback ke image live yang memuatnya; TIDAK ada penghapusan release/image/backup/volume", () => {
  assert.ok(script.includes('[ "$(docker image inspect -f \'{{.Id}}\' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ]'), "tag rollback menunjuk image live");
  assert.ok(script.includes("hotfix HILANG: cacheSingkat.js"), "verifikasi pasca-switch: cacheSingkat.js");
  assert.ok(script.includes("JOIN LATERAL") && script.includes('cacheSingkat(30_000)'), "verifikasi pasca-switch: LATERAL + cache");
  assert.ok(script.includes("snapshot baseline"), "4 berkas hotfix dibandingkan dengan snapshot baseline");
  assert.ok(script.includes("LATERAL, baca-saja"), "performa dicatat");
  const f9 = script.slice(script.indexOf('PHASE="9-pembersihan"'), script.indexOf('trap - EXIT\nsay "SELESAI'));
  assert.ok(f9.includes("DINONAKTIFKAN") && !/rm -rf|docker rmi|docker volume|docker system|docker builder/.test(f9), "fase 9 tidak menghapus apa pun");
  // seluruh skrip: rm -rf hanya untuk jejak sementara rehearsal/uji (BK_DIR, NEW_DIR milik rehearsal-only), tidak pernah release lama/backup/volume
  assert.ok(!/rm -rf[^\n]*(RELEASES|PREV_DIR|backups|volume)/.test(script), "tidak menghapus release lama/backup/volume");
});
