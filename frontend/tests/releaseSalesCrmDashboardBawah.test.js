// Gerbang skrip rilis FRONTEND-SAJA "Dashboard Sales CRM — bagian bawah" (scripts/release-sales-crm-dashboard-bawah.sh): struktur, allowlist, gerbang kode live, disk, rollback, tanpa penghapusan. Tidak menjalankan skrip.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-sales-crm-dashboard-bawah.sh");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;
const allow = script.split("\n").find((l) => l.startsWith("ALLOWED_RE="));

test("skrip: sintaks bash valid; FRONTEND-SAJA (allowlist tanpa backend/, prisma, package, Docker, .env, dist)", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-sales-crm-dashboard-bawah.sh")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  assert.ok(allow, "ALLOWED_RE ada");
  for (const terlarang of ["backend/", "prisma", "package", "Dockerfile", "docker-compose", "frontend/dist", ".env"]) assert.ok(!allow.includes(terlarang), `allowlist tidak boleh memuat ${terlarang}`);
  for (const f of ["sanss-crm-dashboard\\.css", "PipelineFunnelCard", "TopRepsCard", "TaskQueueCard", "HotLeadsCard", "RecentActivityCard", "MiniIkon", "Dashboard\\.jsx"]) assert.ok(allow.includes(f), `allowlist memuat ${f}`);
  assert.ok(script.includes('FRONTEND_SRC_EXPECT="'), "daftar frontend/src diaudit");
  assert.ok(!/@@[A-Z_]+@@/.test(script), "tanpa placeholder");
  assert.ok(script.includes("backend/ di release baru BERBEDA dari release aktif"), "backend/ harus identik dengan release aktif");
  assert.ok(script.includes("image berubah (rilis ini tidak boleh mengganti image)"), "image harus sama setelah recreate");
});

test("sumber dari git (git archive SHA kandidat), tanpa overlay / salinan berkas dari release aktif", () => {
  assert.ok(script.includes('sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR"'), "git archive");
  assert.ok(!/overlay|\.prev-release|rsync/i.test(script.replace(/Dibangun dari SUMBER GIT[^\n]*/, "")), "tanpa model overlay");
  assert.ok(script.includes('CAND_BRANCH="${CAND_BRANCH:-feat/sales-crm-dashboard-bawah-on-a434c858}"'), "cabang kandidat");
});

test("GERBANG KODE LIVE (isi, bukan marker): fase 3, pra-switch, tepat sebelum switch; deploy lain diperiksa ulang", () => {
  assert.ok(script.includes("gerbang_kode_live()"));
  for (const f of ["fase-3-audit", "fase-4c-pra-switch", "fase-5-tepat-sebelum-switch"]) assert.ok(script.includes(`gerbang_kode_live "${f}"`), f);
  assert.ok(!script.includes('= "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline'), "marker tidak lagi dipercaya");
  for (const k of ["git hash-object --no-filters --stdin-paths", "KODE LIVE menyimpang dari baseline", "TAMBAHAN:", "container-sha.txt", "PREV_STARTED"]) assert.ok(script.includes(k), k);
  assert.ok(script.includes("tidak_ada_deploy_lain_lagi") && script.includes("/tmp/release-sales-crm-dashboard-bawah.lock"), "kunci khusus rilis ini");
});

test("DISK: batas 5 GiB dipertahankan (awal dan sebelum switch) + ruang node_modules/build", () => {
  assert.ok(script.includes("MIN_FREE_KB=$((5 * 1024 * 1024))"));
  assert.ok(script.includes('cek_disk "awal"') && script.includes('cek_disk "sebelum switch"'));
  assert.ok(script.includes("ruang disk kurang untuk salinan node_modules + build"));
});

test("TANPA PENGHAPUSAN: tidak ada rm/docker rmi/prune/volume terhadap release lama, image, tag rollback, backup, container, volume", () => {
  assert.ok(!/docker (rmi|image rm|system prune|builder prune|volume rm|rm )|docker volume prune/.test(script), "tidak ada penghapusan docker");
  const rm = script.split("\n").filter((l) => /\brm\b|find .* -delete/.test(l));
  for (const l of rm) assert.ok(/rm -f "\$NEW_DIR\/frontend\/\.env"|rm -rf -- "\$NEW_DIR"|find "\$NEW_DIR\/frontend\/dist\/assets" -type f -mtime \+21 -delete|rm -f \$/.test(l) || /(^|[^a-z])rm -f "\$NEW_DIR/.test(l), `rm hanya untuk berkas sementara rilis ini: ${l.slice(0, 120)}`);
  assert.ok(!/rm -rf[^\n]*(RELEASES\b|PREV_DIR|backups|volume|\$HOME)/.test(script.replace('rm -rf -- "$NEW_DIR"', "")), "tidak menghapus release lama/backup");
});

test("--build-only: build dist terisolasi; hanya release dir SEMENTARA yang diverifikasi yang dihapus; tanpa switch", () => {
  const i = script.indexOf('if [ "$MODE" = "buildonly" ]'); assert.ok(i > 0); const blok = script.slice(i, script.indexOf("\nfi\n", i));
  assert.ok(blok.includes('[ "$NEW_DIR" != "$PREV_DIR" ]') && blok.includes('= "$DEPLOY_SHORT"'), "diverifikasi sebelum dihapus");
  assert.ok(blok.includes("exit 0") && i < script.indexOf('PHASE="5-switch"'), "keluar sebelum switch");
});

test("ROLLBACK: kembali ke baseline (folder BASE, image SAMA yang memuat hotfix); hotfix dan backend diverifikasi pasca-switch", () => {
  assert.ok(script.includes('TARGET="${BASE_SHA:0:8}"') && script.includes("up -d --no-deps --force-recreate backend"), "rollback ke folder baseline");
  assert.ok(script.includes("Rollback = baseline ${BASE_SHA:0:8} (image sama)"), "catatan rollback");
  assert.ok(script.includes("hotfix HILANG: cacheSingkat.js") && script.includes("JOIN LATERAL") && script.includes("cacheSingkat(30_000)") && script.includes("useOptionalTabs"), "hotfix diverifikasi");
  assert.ok(script.includes("backend identik: kode di container sebelum == sesudah switch"), "backend identik pasca-switch");
  assert.ok(script.includes("hitung baris jadwal/Run/stok/pemakaian/harga/jurnal"), "hitung baris");
  assert.ok(script.includes("3 berkas backend == snapshot baseline"), "hotfix backend byte-identik; Laporan.jsx diperiksa lewat isi");
});

test("teks dist: bagian bawah baru ada, fitur live tetap, gerbang data mengabaikan kolom pesan", () => {
  assert.ok(script.includes('for s0 in "needs-action-daftar" "hot-leads-daftar" "aktivitas-toggle" "crm-pipe-baris"'));
  assert.ok(script.includes(".crm-pipe-isi") && script.includes(".crm-dash") && script.includes(".crm-skin"), "aturan CSS bar + Dashboard + tema diperiksa");
  for (const f of ["Sales Overview", "Deal Pipeline", "Kasus Komplain Butuh Follow-up", "sanss-crm-skin", "Tutup emoji", "Nilai Penjualan Tim", "crm-kpi-tile"]) assert.ok(script.includes(f), f);
  assert.ok(script.includes('[ "${FP_1%|*}" = "${FP_0%|*}" ] || die "hitungan data BERUBAH selama rilis (selain pesan)'), "lima kolom pertama dijaga");
  assert.ok(script.includes("kolom pesan WhatsApp bertambah selama rilis"), "kolom pesan hanya dicatat");
  assert.ok(!script.includes('[ "$FP_1" = "$FP_0" ] || die'), "gerbang lama yang menggagalkan karena pesan sudah diganti");
});


test("rilis redesain: koordinasi deploy lain, aset lama dilindungi, rollback ke frontend baseline, frontend-saja, nama rilis lain tidak tersisa", () => {
  for (const k of ["tidak_ada_deploy_lain_lagi", 'PHASE="4c-aset-lama"', "aset lama dibawa; index.html baru hanya merujuk aset baru", "--rollback", "scb1"]) assert.ok(script.includes(k), k);
  const tanpaKepala = script.replace(/\n# \(dibangkitkan[^\n]*\n/, "\n").split("scripts/release-gudang-pintu-masuk.sh").join("");
  for (const sisa of ["drw.sh", "release-drawer-bahan", "gpm.sh", "release-gudang-pintu-masuk.lock", "pjl.sh", "release-penjadwalan-langsung.lock"]) assert.ok(!tanpaKepala.includes(sisa), `sisa nama rilis lain: ${sisa}`);
  assert.ok(allow.includes("sanss-crm") && !allow.includes("backend/"), "frontend-saja");
  assert.ok(baca("scripts/gen-release-sales-crm-dashboard-bawah.cjs").includes("rilis ini FRONTEND-SAJA"), "generator memaksa frontend-saja");
});
