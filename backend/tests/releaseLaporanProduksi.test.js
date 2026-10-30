// Gerbang skrip rilis "Laporan Produksi terpadu" (kode-saja, tanpa migrasi): struktur skrip, allowlist, gerbang kode live, penguncian bersama berbasis kepemilikan, rehearsal (uji pra-switch + data nyata), smoke baca-saja, tanpa penghapusan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-laporan-produksi.sh"); const reh = baca("scripts/lib/rehearsal-laporan-produksi.mjs"); const smoke = baca("scripts/lib/smoke-laporan-produksi.mjs");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;
const allow = script.split("\n").find((l) => l.startsWith("ALLOWED_RE="));

test("skrip: sintaks valid; TANPA migrasi/schema/dependensi/compose/.env/index.js; allowlist memuat berkas rilis ini dan berkas hotfix tidak tersentuh", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-laporan-produksi.sh")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  for (const t of ["backend/prisma", "package", "Dockerfile", "docker-compose", ".env", "backend/src/index\\.js", "cacheSingkat", "routes/analytics", "routes/conversations", "pages/Laporan\\.jsx"]) assert.ok(!allow.includes(t), `allowlist tidak memuat ${t}`);
  for (const f of ["backend/src/routes/productionLaporan\\.js", "backend/src/services/laporanProduksi\\.js", "backend/src/services/laporanProduksiDokumen\\.js", "backend/src/lib/domain/laporanProduksi\\.js", "backend/src/routes/productionExperience\\.js", "frontend/src/features/production/laporan/LaporanProduksi\\.jsx", "frontend/src/pages/bengkel/ProductionKpi\\.jsx", "scripts/release-laporan-produksi\\.sh", "scripts/lib/rehearsal-laporan-produksi\\.mjs", "scripts/lib/smoke-laporan-produksi\\.mjs"]) assert.ok(allow.includes(f), `allowlist memuat ${f}`);
  assert.ok(!/@@[A-Z_]+@@/.test(script) && !/komplain|Komplain/.test(script), "tanpa placeholder dan sisa nama rilis lain");
  assert.ok(!/prisma migrate deploy/.test(script), "tidak ada penerapan migrasi (rilis kode-saja)");
});

test("GERBANG KODE LIVE (isi, bukan marker) di fase audit, tepat sebelum migrasi/persiapan akhir, dan tepat sebelum switch; deploy lain diperiksa ulang", () => {
  for (const f of ["fase-2-audit", "fase-6-pra-switch", "fase-7-tepat-sebelum-switch"]) assert.ok(script.includes(`gerbang_kode_live "${f}"`), f);
  for (const k of ["git hash-object --no-filters --stdin-paths", "KODE LIVE menyimpang dari baseline", "TAMBAHAN:", "container-sha.txt", "PREV_STARTED"]) assert.ok(script.includes(k), k);
  const p7 = script.indexOf('PHASE="7-switch"'); const up = script.indexOf("up -d --no-deps backend", p7); assert.ok(script.slice(p7, up).includes("tidak_ada_deploy_lain_lagi") && script.slice(p7, up).includes('gerbang_kode_live "fase-7-tepat-sebelum-switch"'));
});

test("PENGUNCIAN: kunci bersama + kunci sendiri atomik SEBELUM memeriksa yang lain; kepemilikan dari proses (perangkat:inode), bukan nama; cek ulang sebelum persiapan akhir dan tepat sebelum switch; rehearsal menguji logika pra-switch", () => {
  const f0 = script.indexOf("kunci_ambil   #"); assert.ok(f0 > 0 && script.indexOf('kunci_cek_lain || die "deploy lain sedang berjalan', f0) > f0);
  assert.ok(script.includes("release-deploy-bersama.lock") && script.includes("exec 7>>") && script.includes("exec 9>>") && script.includes("/proc/$$/fd/$fd") && script.includes("stat -Lc '%d:%i'"));
  assert.ok(!script.includes('"$lf" = "/tmp/release-'), "kunci sendiri TIDAK dilewati berdasarkan nama berkas");
  const fn = script.match(/^tidak_ada_deploy_lain_lagi\(\) \{[\s\S]*?^\}/m)?.[0] ?? ""; assert.ok(fn.includes("kunci_milik_sendiri") && fn.includes("kunci_cek_lain") && fn.includes("proses_lain"));
  const g6 = script.indexOf('gerbang_kode_live "fase-6-pra-switch"'); assert.ok(script.slice(g6, g6 + 80).includes("tidak_ada_deploy_lain_lagi"));
  const u = script.indexOf('PHASE="5c-uji-pra-switch"'); const stop = script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]; then', u); assert.ok(u > 0 && stop > u);
  for (const k of ["uji_gerbang_kunci", "uji_baseline_bergeser", "tidak_ada_deploy_lain_lagi", 'gerbang_kode_live "rehearsal-pra-switch"']) assert.ok(script.slice(u, stop).includes(k), k);
  const blokUji = script.slice(script.indexOf("uji_gerbang_kunci() {"), script.indexOf("uji_baseline_bergeser() {")); assert.ok(!/\bwait\s*(;|\|\||&&|$)/m.test(blokUji.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")), "tanpa 'wait' tanpa argumen (macet karena tee)");
});

test("UJI KUNCI TERISOLASI (Linux): memuat blok KUNCI-DEPLOY dari skrip rilis ini; kunci sendiri/lain/bagian kritis", { skip: !(punyaBash && process.platform === "linux" && spawnSync("bash", ["-c", "command -v flock && command -v pgrep && command -v setsid"]).status === 0) }, () => {
  const r = spawnSync("bash", [path.join(repo, "scripts/lib/uji-kunci-kelengkapan.sh"), path.join(repo, "scripts/release-laporan-produksi.sh")], { encoding: "utf8", timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /SEMUA UJI KUNCI LULUS/);
});

test("REHEARSAL: server kode baru pada salinan restore; konsistensi antar tab; lingkup penuh; selesai posisi/bertanggal/tanpa tanggal; PIC penugasan; SANO GUARD; waktu respons; ekspor; izin; baca-saja; smoke yang sama dijalankan", () => {
  for (const k of ["lingkup PENUH", "hanya pemakaian", "selesai posisi saat ini", "TIDAK 0 palsu", "PIC = penugasan", "SANO GUARD: ISSUE ber-snapshot resmi IKUT dihitung", "serah barang jadi uji", "WAKTU", "Ekspor Excel", "tanpa token 401", "tidak mengubah stok, biaya beku, harga", "SMOKE pasca-switch"]) assert.ok(reh.includes(k), k);
  assert.ok(/rehearsal_/.test(reh) && reh.includes("uji Laporan Produksi hanya pada DB rehearsal"), "hanya DB rehearsal");
  assert.ok(script.includes("REH_DECL") === false && script.includes('const SMOKE_SRC = "'), "smoke ditanam di rehearsal");
});

test("SMOKE pasca-switch BACA-SAJA: hanya GET; kontrak ringkasan SMOKE_HASIL dibaca skrip; invarian jejak tulis; nominal hanya finance:read; Excel = layar", () => {
  assert.ok(smoke.includes('console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati)') && script.includes("^SMOKE_HASIL fail=0 skip="), "kontrak SMOKE_HASIL");
  assert.ok(!/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(smoke) && !/\b(insert into|update\s+[a-z_"]+\s+set|delete from)\b/i.test(smoke) && !/\.(create|update|delete|upsert)\(/.test(smoke), "smoke tidak menulis");
  for (const k of ["tanpa jejak tulis", "nilai Rp dikirim null", "Excel memuat SEMUA order", "selesai posisi saat ini = hitungan langsung tabel", "lingkup bawaan PENUH", "SANO GUARD", "PIC: berlabel PENUGASAN"]) assert.ok(smoke.includes(k) || smoke.includes(k.replace("tanpa jejak tulis", "TIDAK ada jejak tulis")), k);
});

test("TANPA PENGHAPUSAN: fase pembersihan dinonaktifkan; hanya jejak sementara rehearsal/trap; gerbang disk tetap (tidak diturunkan)", () => {
  assert.ok(script.includes('PHASE="9-pembersihan"; say "9. Pembersihan release lama DINONAKTIFKAN') && script.includes("tidak ada folder release/image/backup/volume yang dihapus oleh skrip ini"));
  assert.ok(script.includes('[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"'), "gerbang disk apa adanya");
  assert.ok(!/docker (system|image|builder|volume) prune|docker volume rm|rm -rf "?\$HOME\/(releases|backups)/.test(script));
});

test("HITUNG BARIS pra/pasca switch mencakup stok, biaya beku, harga, Material Issue, jurnal, unit, pernyataan, run, jadwal, custody, status kerja", () => {
  const cs = script.split("\n").find((l) => l.startsWith('COUNT_SQL="')) ?? "";
  for (const t of ["stock_movements", "stock_movement_biaya_operasional", "material_harga_berlaku", "material_issues", "fin_journal_entries", "units", "unit_material_declarations", "production_runs_v2", "production_unit_schedules", "unit_custody_handoffs_v2", "production_unit_work_progress"]) assert.ok(cs.includes(t), t);
});

test("COUNT_SQL setelah dievaluasi bash tetap memuat tabel \"Order\" berkutip (tanpa kutip, Postgres menolak: kata kunci ORDER)", { skip: !punyaBash }, () => {
  const baris = script.split("\n").find((l) => l.startsWith('COUNT_SQL="'));
  const r = spawnSync("bash", ["-c", `${baris}\nprintf '%s' "$COUNT_SQL"`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('from "Order" union'), r.stdout.slice(0, 400));
  assert.ok(!/from Order\b/.test(r.stdout), "tidak boleh ada 'from Order' tanpa kutip");
});
