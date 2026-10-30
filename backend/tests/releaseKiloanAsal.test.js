// Gerbang skrip rilis "klasifikasi asal KILOAN + D1" (backend-saja, tanpa migrasi): struktur, allowlist, tanpa sisa rilis lain, D1 tidak dijalankan oleh skrip, rehearsal+smoke memuat pemeriksaan kunci.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-kiloan-asal.sh"); const reh = baca("scripts/lib/rehearsal-kiloan-asal.mjs"); const smoke = baca("scripts/lib/smoke-kiloan-asal.mjs");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;
const allow = script.split("\n").find((l) => l.startsWith("ALLOWED_RE="));

test("skrip: sintaks valid, LF, allowlist hanya berkas rilis ini; tanpa frontend, prisma, package, Docker, .env, index.js; FRONTEND_SRC_EXPECT kosong", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-kiloan-asal.sh").replace(/\\/g, "/")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.readFileSync(path.join(repo, "scripts/release-kiloan-asal.sh"), "utf8").includes("\r"), "LF saja");
  for (const t of ["backend/prisma", "frontend/", "package", "Dockerfile", "docker-compose", ".env", "backend/src/index"]) assert.ok(!allow.includes(t.replace(/\./g, "\\.")) && !allow.includes(t), `allowlist tidak memuat ${t}`);
  for (const f of ["backend/src/lib/domain/pemakaianHistoris", "backend/src/services/catatanPemakaianHistoris", "backend/src/routes/pemakaianKoreksi", "koreksiKiloanD1.integration", "kiloanAsalBahan.integration", "releaseSidikData", "scripts/lib/sidik-data"]) assert.ok(allow.includes(f.replace(/\./g, "\\.")), `allowlist memuat ${f}`);
  assert.match(script, /^FRONTEND_SRC_EXPECT=""$/m); assert.match(script, /^BACKEND_SRC_EXPECT="backend\/src\/lib\/domain\/pemakaianHistoris\.js backend\/src\/routes\/pemakaianKoreksi\.js backend\/src\/services\/catatanPemakaianHistoris\.js"$/m);
  assert.ok(!/@@[A-Z_]+@@/.test(script), "tanpa placeholder"); assert.ok(!/po-barang-mirip|cek-duplikat-po|BUS-008|rollback-pre-pbm|rehearsal_pbm|rehearsal_pjl|rollback-pre-pjl/.test(script), "tanpa sisa nama rilis lain");
  assert.ok(script.includes("rollback-pre-kla-") && script.includes("rehearsal_kla_") && script.includes("/tmp/release-kiloan-asal.lock") && script.includes("kiloan-asal-${DEPLOY_SHORT}-${TS}"));
});

test("gerbang: kode live (3 titik), hotfix performa, tanpa migrasi, rehearsal terisolasi, switch satu kali, pembersihan release lama NONAKTIF, tidak ada perintah penghapus di luar folder sementara", () => {
  assert.ok((script.match(/gerbang_kode_live "/g) ?? []).length >= 3, "gerbang kode live ≥ 3 titik");
  for (const t of ["LATERAL", "cacheSingkat", "migrate status", "rehearsal terisolasi", "Pembersihan release lama DINONAKTIFKAN", "--rehearsal-only", "--preflight-only"]) assert.ok(script.includes(t), t);
  assert.ok(!/rm -rf[^\n]*(RELEASES\b|PREV_DIR|backups|volume)/.test(script.replace(/rm -rf -- "\$NEW_DIR"/g, "")), "tidak menghapus di luar release dir sementara");
  assert.ok(!/docker (volume rm|system prune|image prune|builder prune)/.test(script), "tidak membersihkan volume/cache");
  const fn = script.slice(script.indexOf("pulihkan_jejak() {"), script.indexOf("\n}\n", script.indexOf("pulihkan_jejak() {")));
  assert.ok(fn.includes("REHEARSAL_ONLY") && (script.match(/docker rmi/g) ?? []).length === (fn.match(/docker rmi/g) ?? []).length, "docker rmi HANYA di pulihkan_jejak (mode --rehearsal-only; image/tag buatan skrip ini sendiri)");
  assert.ok(script.includes("Rilis ini TIDAK menjalankan D1"), "catatan akhir menyatakan D1 tidak dijalankan");
});

test("D1 TIDAK dijalankan oleh skrip rilis: tidak ada pemanggilan rute/fungsi terapkan di jalur produksi; hanya rehearsal (DB sementara) yang menulis", () => {
  const luarRehearsal = script.split("<<'REHNODE'")[0] + script.slice(script.indexOf("\nREHNODE\n"));
  const tanpaTokenSaja = luarRehearsal.split("\n").filter((l) => !/tanpa token = 401/.test(l) && !l.startsWith("const SMOKE_SRC = ")).join("\n");
  assert.ok(!/koreksi-kiloan\/terapkan|terapkanKoreksiKiloan/.test(tanpaTokenSaja), "tak ada pemanggilan terapkan D1 di luar rehearsal (selain uji tertutup tanpa token = 401)");
  assert.ok(/ulang dengan kunci SAMA/.test(reh) && /deploy kode saja TIDAK mengoreksi/.test(reh) && /kestabilan: evaluasi ulang global/.test(reh) && /rehearsal_/.test(reh), "rehearsal menguji D1 penuh pada DB rehearsal_*");
  assert.ok(/uji D1\/KILOAN hanya pada DB rehearsal/.test(reh), "pagar DB rehearsal");
});

test("smoke production: baca-saja TANPA token, D1 belum berjalan, isi catatan identik; rute D1 tanpa token = 401", () => {
  assert.ok(!/jwt\.sign|JWT_SECRET/.test(smoke), "smoke tidak membuat token pengguna");
  for (const t of ["pratinjauKoreksiKiloan", "tanpa token = 401", "BASE_KILOAN_N", "BASE_KILOAN_DIKOREKSI", "md5Catatan", "SMOKE_HASIL fail="]) assert.ok(smoke.includes(t), t);
  assert.ok(!/terapkanKoreksiKiloan|method: "POST".*terapkan.*token/.test(smoke.replace(/"POST", "\/api\/production\/catatan-historis\/koreksi-kiloan\/terapkan", \{ manifest: \[\]/, "")), "smoke tidak menerapkan D1");
  assert.ok(script.includes("BASE_KILOAN_N=%q") && script.includes('-e BASE_KILOAN_N="$BASE_KILOAN_N"'), "garis dasar KILOAN diteruskan ke smoke");
});
