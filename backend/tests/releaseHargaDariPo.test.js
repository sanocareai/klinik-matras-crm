// Gerbang skrip rilis "Harga Berlaku otomatis dari PO" (kode-saja, tanpa migrasi): struktur skrip, allowlist, gerbang kode live, penguncian bersama berbasis kepemilikan, rehearsal (uji pra-switch + data nyata + saklar), smoke baca-saja, tanpa penghapusan
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-harga-dari-po.sh"); const reh = baca("scripts/lib/rehearsal-harga-dari-po.mjs"); const smoke = baca("scripts/lib/smoke-harga-dari-po.mjs");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;
const allow = script.split("\n").find((l) => l.startsWith("ALLOWED_RE="));

test("skrip: sintaks valid; TANPA migrasi/schema/dependensi/compose/.env/index.js; allowlist memuat berkas rilis ini dan berkas hotfix/Laporan Produksi/redesain Stok tidak tersentuh", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-harga-dari-po.sh")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  for (const t of ["backend/prisma", "package", "Dockerfile", "docker-compose", ".env", "backend/src/index\\.js", "cacheSingkat", "routes/analytics", "routes/conversations", "pages/Laporan\\.jsx", "laporanProduksi", "productionLaporan", "WarehouseInventory", "ItemDetailDrawer", "DaftarBahan", "kontras\\.css"]) assert.ok(!allow.includes(t), `allowlist tidak memuat ${t}`);
  for (const f of ["backend/src/services/finance/hargaDariPO\\.js", "backend/src/services/finance/hargaBerlaku\\.js", "backend/src/services/finance/purchaseOrder\\.js", "backend/src/routes/purchaseOrders\\.js", "frontend/src/pages/finance/FinancePurchaseOrders\\.jsx", "frontend/src/features/finance/hargaDariPOLogic\\.js", "frontend/src/features/warehouse/stok/HargaBerlakuPanel\\.jsx", "frontend/src/api\\.js", "scripts/release-harga-dari-po\\.sh", "scripts/lib/rehearsal-harga-dari-po\\.mjs", "scripts/lib/smoke-harga-dari-po\\.mjs"]) assert.ok(allow.includes(f), `allowlist memuat ${f}`);
  assert.ok(!/@@[A-Z_]+@@/.test(script) && !/komplain|Komplain|laporan-produksi|release-laporan/.test(script), "tanpa placeholder dan sisa nama rilis lain");
  assert.ok(!/prisma migrate deploy/.test(script), "tidak ada penerapan migrasi (rilis kode-saja)");
});

test("GERBANG KODE LIVE (isi, bukan marker) di fase audit, tepat sebelum persiapan akhir, dan tepat sebelum switch; deploy lain diperiksa ulang", () => {
  for (const f of ["fase-2-audit", "fase-6-pra-switch", "fase-7-tepat-sebelum-switch"]) assert.ok(script.includes(`gerbang_kode_live "${f}"`), f);
  for (const k of ["git hash-object --no-filters --stdin-paths", "KODE LIVE menyimpang dari baseline", "TAMBAHAN:", "container-sha.txt", "PREV_STARTED"]) assert.ok(script.includes(k), k);
  const p7 = script.indexOf('PHASE="7-switch"'); const up = script.indexOf("up -d --no-deps backend", p7); assert.ok(script.slice(p7, up).includes("tidak_ada_deploy_lain_lagi") && script.slice(p7, up).includes('gerbang_kode_live "fase-7-tepat-sebelum-switch"'));
});

test("PENGUNCIAN: kunci bersama + kunci sendiri (release-harga-dari-po.lock, BUKAN kunci rilis lain) atomik SEBELUM memeriksa yang lain; kepemilikan dari proses (perangkat:inode), bukan nama; cek ulang sebelum persiapan akhir dan tepat sebelum switch; rehearsal menguji logika pra-switch", () => {
  const f0 = script.indexOf("kunci_ambil   #"); assert.ok(f0 > 0 && script.indexOf('kunci_cek_lain || die "deploy lain sedang berjalan', f0) > f0);
  assert.ok(script.includes("release-deploy-bersama.lock") && script.includes("release-harga-dari-po.lock") && script.includes("exec 7>>") && script.includes("exec 9>>") && script.includes("/proc/$$/fd/$fd") && script.includes("stat -Lc '%d:%i'"));
  assert.ok(!script.includes('"$lf" = "/tmp/release-'), "kunci sendiri TIDAK dilewati berdasarkan nama berkas");
  const fn = script.match(/^tidak_ada_deploy_lain_lagi\(\) \{[\s\S]*?^\}/m)?.[0] ?? ""; assert.ok(fn.includes("kunci_milik_sendiri") && fn.includes("kunci_cek_lain") && fn.includes("proses_lain"));
  const g6 = script.indexOf('gerbang_kode_live "fase-6-pra-switch"'); assert.ok(script.slice(g6, g6 + 80).includes("tidak_ada_deploy_lain_lagi"));
  const u = script.indexOf('PHASE="5c-uji-pra-switch"'); const stop = script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]; then', u); assert.ok(u > 0 && stop > u);
  for (const k of ["uji_gerbang_kunci", "uji_baseline_bergeser", "tidak_ada_deploy_lain_lagi", 'gerbang_kode_live "rehearsal-pra-switch"']) assert.ok(script.slice(u, stop).includes(k), k);
  const blokUji = script.slice(script.indexOf("uji_gerbang_kunci() {"), script.indexOf("uji_baseline_bergeser() {")); assert.ok(!/\bwait\s*(;|\|\||&&|$)/m.test(blokUji.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")), "tanpa 'wait' tanpa argumen (macet karena tee)");
});

test("UJI KUNCI TERISOLASI (Linux): memuat blok KUNCI-DEPLOY dari skrip rilis ini; kunci sendiri/lain/bagian kritis", { skip: !(punyaBash && process.platform === "linux" && spawnSync("bash", ["-c", "command -v flock && command -v pgrep && command -v setsid"]).status === 0) }, () => {
  const r = spawnSync("bash", [path.join(repo, "scripts/lib/uji-kunci-kelengkapan.sh"), path.join(repo, "scripts/release-harga-dari-po.sh")], { encoding: "utf8", timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /SEMUA UJI KUNCI LULUS/);
});

test("REHEARSAL: server kode baru pada salinan restore; harga tertulis saat simpan tanpa izin harga; klik ganda; ubah jumlah/harga; harga lebih baru & terjadwal tidak tertimpa; persetujuan/pembatalan; konflik & konversi tanpa tulisan sebagian; saklar =0 (server kedua); izin; invarian; smoke yang sama dijalankan", () => {
  for (const k of ["simpan PO baru: 201 DRAFT", "TANPA izin harga", "klik ganda (paralel + susulan, kunci sama)", "ubah jumlah saja", "simpan ulang draf LAMA", "persetujuan PO: 200 DISETUJUI, TIDAK menulis ulang", "harga TERJADWAL", "dua baris bahan SAMA dengan harga stok berbeda", "TANPA faktor konversi di baris 2", "ubah draf yang gagal di baris 2", "pembatalan PO: 200 DIBATALKAN", "saklar HARGA_DARI_PO=0", "HARGA_DARI_PO: \"0\"", "izin: tanpa token 401", "SEMUA baris Harga Berlaku yang sudah ada sebelum uji identik", "tak satu pun PO historis diproses", "stok, valuasi Finance, jurnal, baris jurnal, biaya beku operasional, catatan pemakaian, dan material IDENTIK", "SMOKE pasca-switch"]) assert.ok(reh.includes(k), k);
  assert.ok(/rehearsal_/.test(reh) && reh.includes("uji Harga Berlaku dari PO hanya pada DB rehearsal"), "hanya DB rehearsal");
  assert.ok(script.includes('const SMOKE_SRC = "'), "smoke ditanam di rehearsal");
  assert.ok(script.includes("uji Harga Berlaku dari PO terhadap salinan restore GAGAL") && script.includes("rollback-pre-hpo-") && script.includes("rehearsal_hpo_"), "nama tag rollback & DB rehearsal khusus rilis ini");
});

test("SMOKE pasca-switch BACA-SAJA: tanpa SQL tulis dan tanpa tulisan Prisma; satu-satunya POST = pratinjau (baca-saja) dan penolakan sebelum menulis (tanpa token / tanpa izin / tanpa baris); tanpa PO atau harga percobaan; invarian jejak tulis", () => {
  assert.ok(smoke.includes('console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati)') && script.includes("^SMOKE_HASIL fail=0 skip="), "kontrak SMOKE_HASIL");
  assert.ok(!/\b(insert into|update\s+[a-z_"]+\s+set|delete from)\b/i.test(smoke) && !/\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/.test(smoke), "smoke tidak menulis");
  assert.ok(!/method:\s*"(PUT|PATCH|DELETE)"/.test(smoke), "tidak ada PUT/PATCH/DELETE");
  const panggilan = [...smoke.matchAll(/await post\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.ok(panggilan.length >= 10 && panggilan.every((p) => ["PV", "PO", "CEK"].includes(p)), `semua POST menuju PV/PO: ${[...new Set(panggilan)]}`);
  // setiap POST ke PO (simpan) HARUS gagal sebelum menulis: tanpa token (null), akun tanpa izin (tN), atau tanpa baris (lines: [])
  for (const m of smoke.matchAll(/await post\(PO, ([^,]+),([^\n]*)/g)) assert.ok(m[1].trim() === "null" || m[1].trim() === "tN" || /lines: \[\]/.test(m[2]), `POST simpan PO hanya penolakan: ${m[0].slice(0, 100)}`);
  for (const k of ["TIDAK ada jejak tulis", "isi LENGKAP semua baris Harga Berlaku identik", "PO historis TIDAK diproses oleh rilis", "tanpa token = 401", "KONVERSI_TIDAK_ADA", "KONFLIK_HARGA_BEDA", "SAMA", "NAIK"]) assert.ok(smoke.includes(k), k);
});

test("GARIS DASAR smoke: BASE_HARGA_PO dihitung, divalidasi angka, disimpan di garis-dasar.env, dan diteruskan ke smoke fase 8b (regresi: sebelumnya NaN)", () => {
  assert.ok(script.includes(`BASE_HARGA_PO="$(psql_live -At -c "select count(*)::int from material_harga_berlaku where impact->>'sumber' = 'PO'")"`), "dihitung");
  assert.ok(script.includes(`for v in "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA" "$BASE_HARGA_PO"; do`), "divalidasi angka");
  assert.ok(script.includes("BASE_HARGA_PO=%q") && script.includes(`"$BASE_GANDA" "$BASE_HARGA_PO" "$ORDER_N"`), "disimpan di garis-dasar.env");
  assert.ok(script.includes(`-e BASE_HARGA_PO="$BASE_HARGA_PO"`), "diteruskan ke smoke 8b");
});

test("TANPA PENGHAPUSAN: fase pembersihan dinonaktifkan; hanya jejak sementara rehearsal/trap; gerbang disk tetap (tidak diturunkan)", () => {
  assert.ok(script.includes('PHASE="9-pembersihan"; say "9. Pembersihan release lama DINONAKTIFKAN') && script.includes("tidak ada folder release/image/backup/volume yang dihapus oleh skrip ini"));
  assert.ok(script.includes('[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"'), "gerbang disk apa adanya");
  assert.ok(!/docker (system|image|builder|volume) prune|docker volume rm|rm -rf "?\$HOME\/(releases|backups)/.test(script));
});

test("HITUNG BARIS pra/pasca switch mencakup PO, baris PO, Harga Berlaku (dan yang bersumber PO), stok, valuasi, biaya beku, Material Issue, jurnal, material, catatan pemakaian", () => {
  const cs = script.split("\n").find((l) => l.startsWith('COUNT_SQL="')) ?? "";
  for (const t of ["fin_purchase_orders", "fin_purchase_order_lines", "material_harga_berlaku", "impact->>'sumber' = 'PO'", "stock_movements", "fin_stock_movement_valuations", "stock_movement_biaya_operasional", "material_issues", "fin_journal_entries", "fin_journal_lines", "unit_usage_notes", "materials"]) assert.ok(cs.includes(t), t);
});

test("COUNT_SQL setelah dievaluasi bash tetap memuat tabel \"Order\" berkutip (tanpa kutip, Postgres menolak: kata kunci ORDER)", { skip: !punyaBash }, () => {
  const baris = script.split("\n").find((l) => l.startsWith('COUNT_SQL="'));
  const r = spawnSync("bash", ["-c", `${baris}\nprintf '%s' "$COUNT_SQL"`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('from "Order" union'), r.stdout.slice(0, 600));
  assert.ok(!/from Order\b/.test(r.stdout), "tidak boleh ada 'from Order' tanpa kutip");
});

test("GERBANG TEKS FITUR di bundel web: teks baru ada hanya di dist baru; 51 teks fitur live (Laporan Produksi, redesain Stok, Marketing, KILOAN, PO barang mirip, drawer, penjadwalan) tetap ada", () => {
  for (const k of ["Harga Berlaku otomatis", "Apa dampaknya?", "Isian yang belum disimpan tidak mengubah harga", "Saat PO berhasil disimpan"]) assert.ok(script.includes(`"${k}"`), k);
  for (const k of ["Tampilkan semua bahan", "Periode order masuk", "Total lead (termasuk spam)", "Lead CTWA terbukti", "Saring harga berlaku", "Varian serupa yang sudah ada", "Konfirmasi Barang Jadi"]) assert.ok(script.includes(`"${k}"`), `fitur live tidak boleh hilang: ${k}`);
});
