// Tes skrip rilis scripts/release-mcp-laporan-meta.sh (kandidat "MCP laporan Meta Ads": BACKEND-SAJA, tanpa migrasi/frontend/env) — TANPA menyentuh produksi.
// Menjaga pin/allowlist KANDIDAT. Nilai yang bergantung pada commit dihitung dari git terhadap BASE_LIVE (release aktif saat kandidat disiapkan). Bila baseline live berganti, bangkitkan ulang:
//   node scripts/gen-release-mcp-laporan-meta.cjs --base <SHA_LIVE>   lalu perbarui BASE_LIVE di bawah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE_LIVE = "e7883bc6";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rel = "scripts/release-mcp-laporan-meta.sh";
const scriptPath = path.join(root, rel);
const lf = (r) => fs.readFileSync(path.join(root, r), "utf8").replace(/\r\n/g, "\n");
const src = lf(rel);
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const adaBase = git(["cat-file", "-e", `${BASE_LIVE}^{commit}`]).status === 0;
const alasanGit = `commit baseline ${BASE_LIVE} tidak ada di klon ini (riwayat dangkal)`;
const nilai = (nama) => new RegExp(`^${nama}="([^"]*)"`, "m").exec(src)?.[1];

function kodeBersih() {
  const out = []; let akhir = null;
  for (const l of src.split("\n")) {
    if (akhir) { if (l === akhir) akhir = null; continue; }
    const h = /<<'([A-Z0-9_]+)'/.exec(l);
    if (h) akhir = h[1];
    if (l.trimStart().startsWith("#")) continue;
    if (/^\s*ok "/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n");
}
const kode = kodeBersih();
function berkasBerubah() {
  const a = git(["diff", "--name-only", BASE_LIVE]).stdout.split("\n").filter(Boolean);
  const b = git(["ls-files", "-o", "--exclude-standard"]).stdout.split("\n").filter((f) => f && !/^backend\/(data|uploads)\//.test(f));
  return [...new Set([...a, ...b])].filter((f) => !f.startsWith("frontend/dist/")).sort();
}

test("sintaks bash valid, LF, tanpa placeholder", { skip: !punyaBash }, () => {
  assert.equal(spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" }).status, 0);
  for (const r of [rel, "scripts/lib/smoke-mcp-laporan-meta.mjs", "scripts/lib/rehearsal-mcp-laporan-meta.mjs"]) assert.ok(!fs.readFileSync(path.join(root, r), "utf8").includes("\r"), `${r} harus LF`);
  assert.ok(!/@@[A-Z_]+@@/.test(src), "placeholder tersisa");
});

test("skrip = hasil bangkitan ulang generator terhadap baseline live (templat/pustaka/kode tidak menyimpang dari skrip)", { skip: adaBase ? false : alasanGit }, () => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/gen-release-mcp-laporan-meta.cjs"), "--base", BASE_LIVE, "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 400));
  assert.match(r.stdout, /barisSisaFiturLama":\[\]/);
});

test("ancestry: baseline live adalah leluhur kandidat; origin/main (bila ada) leluhur kandidat; tanpa migrasi/schema/frontend/paket/compose/env", { skip: adaBase ? false : alasanGit }, () => {
  assert.equal(git(["merge-base", "--is-ancestor", BASE_LIVE, "HEAD"]).status, 0, "baseline live BUKAN leluhur HEAD");
  const main = git(["rev-parse", "--verify", "-q", "origin/main"]);
  if (main.status === 0) assert.equal(git(["merge-base", "--is-ancestor", main.stdout.trim(), "HEAD"]).status, 0, "origin/main bukan leluhur kandidat");
  assert.equal(git(["diff", "--name-only", BASE_LIVE, "--", "backend/prisma"]).stdout.trim(), "", "backend/prisma berubah");
  const berubah = berkasBerubah();
  assert.deepEqual(berubah.filter((f) => /^frontend\//.test(f)), [], "rilis BACKEND-SAJA");
  assert.deepEqual(berubah.filter((f) => /package(-lock)?\.json$|docker-compose|Dockerfile|(^|\/)\.env|^backend\/prisma\//.test(f)), []);
  assert.ok(!berubah.includes("backend/src/index.js"));
  for (const hotfix of ["backend/src/routes/analytics.js", "backend/src/routes/conversations.js", "backend/src/middleware/cacheSingkat.js"]) assert.ok(!berubah.includes(hotfix), `hotfix performa tersentuh: ${hotfix}`);
});

test("allowlist = persis berkas kandidat; BACKEND_SRC_EXPECT cocok; prisma/paket/compose/Dockerfile/.env/index.js/frontend/skrip lain ditolak", { skip: adaBase ? false : alasanGit }, () => {
  const re = new RegExp(/ALLOWED_RE='([^']+)'/.exec(src)[1]);
  const berubah = berkasBerubah();
  assert.deepEqual(berubah.filter((f) => !re.test(f)), [], "berkas kandidat di luar allowlist");
  assert.equal(nilai("BACKEND_SRC_EXPECT"), berubah.filter((f) => f.startsWith("backend/src/")).join(" "));
  assert.equal(nilai("FRONTEND_SRC_EXPECT"), "");
  assert.deepEqual(berubah.filter((f) => f.startsWith("backend/src/")), [
    "backend/src/mcp/chatgptPlugin.js", "backend/src/mcp/index.js", "backend/src/mcp/toolsAtribusiIklan.js", "backend/src/mcp/toolsTraffic.js", "backend/src/routes/attributionAds.js",
    "backend/src/services/attribution/biayaKpi.js", "backend/src/services/attribution/iklanReport.js", "backend/src/services/attribution/laporanMeta.js", "backend/src/services/attribution/penjagaLaporan.js"], "perubahan backend/src hanya 9 berkas yang diaudit");
  for (const no of ["backend/prisma/migrations/20261231000000_x/migration.sql", "backend/prisma/schema.prisma", "backend/package.json", "backend/package-lock.json", "frontend/package.json", "frontend/src/api.js", "docker-compose.release.yml", "docker-compose.yml", "backend/Dockerfile", "backend/.env",
    "backend/src/index.js", "backend/src/services/attribution/spend.js", "backend/src/services/attribution/d7.js", "backend/src/services/attribution/sumber.js", "backend/src/routes/settings.js", "backend/src/routes/analytics.js", "backend/src/routes/conversations.js",
    "backend/src/mcp/oauth.js", "backend/src/mcp/security.js", "scripts/release-po-barang-mirip.sh", "scripts/release-ux-bahan.sh", "frontend/dist/index.html", "backend/prisma/seed.js"]) assert.ok(!re.test(no), `harus DITOLAK: ${no}`);
  assert.ok(re.test(rel) && re.test("backend/src/mcp/toolsAtribusiIklan.js") && re.test("backend/src/services/attribution/laporanMeta.js"));
  assert.ok(!re.test("backend/src/mcp/toolsAtribusiIklan.jsx"), "regex terjangkar (tanpa awalan/akhiran longgar)");
});

test("gerbang: identitas kode live 3x (fase 2, pra-switch, tepat sebelum switch), tidak ada deploy lain, backup + checksum + restore rehearsal, ancestry baseline, rollback", () => {
  for (const g of ["fase-2-audit", "fase-6-pra-switch", "fase-7-tepat-sebelum-switch"]) assert.ok(src.includes(`gerbang_kode_live "${g}"`), `gerbang ${g} hilang`);
  assert.match(src, /tidak_ada_deploy_lain_lagi\ngerbang_kode_live "fase-7-tepat-sebelum-switch"/, "urutan: kunci deploy lain lalu gerbang kode TEPAT sebelum switch");
  assert.match(src, /sg merge-base --is-ancestor "\$BASE_SHA" "\$DEPLOY_SHA" \|\| die/);
  assert.match(src, /sg merge-base --is-ancestor "\$MAIN_SHA" "\$DEPLOY_SHA" \|\| die/);
  assert.match(src, /LUAR="\$\(printf '%s\\n' "\$CHANGED" \| grep -Ev "\$ALLOWED_RE"/);
  assert.match(src, /pg_dump/); assert.match(src, /sha256sum -c/); assert.match(src, /gzip -t/); assert.match(src, /CREATE DATABASE \\"\$\{REH_DB\}\\"/);
  assert.match(src, /psql -U "\$DB_USER" -d "\$REH_DB"|-d "\$REH_DB"/);
  assert.match(src, /REHEARSAL_ONLY" = "1"/); assert.match(src, /--rehearsal-only/); assert.match(src, /--preflight-only/);
  assert.match(src, /ROLLBACK_TAG="\$\{IMG_NAME%%:\*\}:rollback-pre-mlm-\$\{DEPLOY_SHORT\}"/);
  assert.match(src, /rollback_instructions\(\)/); assert.match(src, /trap 'rc=\$\?; pulihkan_jejak; \[ \$rc -ne 0 \] && rollback_instructions; exit \$rc' EXIT/);
  assert.match(src, /refresh\/sambung ulang|refresh lagi/i, "rollback menyebut refresh klien konektor");
  assert.match(src, /flock -n 9/); assert.match(src, /\/tmp\/release-mcp-laporan-meta\.lock/);
  assert.ok(src.indexOf('PHASE="3-backup"') < src.indexOf('PHASE="5b-rehearsal"') && src.indexOf('PHASE="5b-rehearsal"') < src.indexOf('PHASE="7-switch"'), "urutan fase: backup → rehearsal → switch");
  assert.equal((src.match(/up -d --no-deps backend/g) || []).length, 1, "tepat SATU switch");
});

test("backend-saja: tidak ada build frontend, dist dibawa apa adanya, tanpa migrate deploy (hanya status), pembersihan release lama dinonaktifkan, tanpa sudo/push/DROP selain DB rehearsal", () => {
  assert.ok(!/npm run build|npm ci|npm install/.test(kode), "tidak boleh ada build/instal frontend");
  assert.match(src, /cp -a "\$PREV_DIR\/frontend\/dist" "\$NEW_DIR\/frontend\/dist"/); assert.match(src, /diff -rq "\$PREV_DIR\/frontend\/dist" "\$NEW_DIR\/frontend\/dist"/);
  assert.ok(!/prisma\s+(migrate\s+(deploy|dev|reset|resolve)|db\s+push|generate)/.test(kode), "rilis ini TANPA migrasi: hanya migrate status");
  assert.match(kode, /prisma migrate status/);
  for (const [re, nama] of [[/\bgit\b[^\n]*\bpush\b/, "git push"], [/\bsudo\b/, "sudo"], [/\bTRUNCATE\b/i, "TRUNCATE"], [/\bprune\b/, "prune"], [/crontab/i, "cron"], [/>>?\s*"?\$?\{?PERSIST\}?\/backend\/\.env/, "tulis .env"], [/\bsed\s+-i[^\n]*\.env/, "sed -i .env"],
    [/graph\.facebook\.com|api\.windsor\.ai/i, "panggilan Meta/Windsor"], [/curl[^\n]*(-X\s*POST|--data|-d\s)/i, "curl POST"], [/\bINSERT\s+INTO\b|\bUPDATE\s+"?[a-z_]+"?\s+SET\b|\bDELETE\s+FROM\b/i, "DML"]]) assert.ok(!re.test(kode), `perintah terlarang: ${nama}`);
  assert.match(src, /PHASE="9-pembersihan"; say "9\. Pembersihan release lama DINONAKTIFKAN/);
  const drops = kode.split("\n").filter((l) => /\bDROP\s+(TABLE|DATABASE|SCHEMA|COLUMN)\b/i.test(l));
  assert.equal(drops.length, 1); assert.match(drops[0], /^reh_drop\(\) .*DROP DATABASE IF EXISTS \\"\$\{REH_DB\}\\"/);
  assert.match(kode, /pulihkan_jejak\(\) \{\n  \[ "\$\{REHEARSAL_ONLY:-0\}" = "1" \] \|\| return 0/);
});

test("smoke dan rehearsal: tiga jalur auth, tools/list, hasil tool == endpoint, tool lama, baca-saja; uji lokal dibedakan dari discovery konektor", () => {
  const smoke = lf("scripts/lib/smoke-mcp-laporan-meta.mjs"), reh = lf("scripts/lib/rehearsal-mcp-laporan-meta.mjs");
  for (const k of ["/mcp-chatgpt", "ChatGPT (OAuth ADMIN", "Claude (OAuth ADMIN", "token statis", "tools/list", "performa_campaign_meta", "rekap_harian_meta", "kesehatan_atribusi_meta", "performa_iklan", "hasil tool == endpoint", "tepat sembilan tool", "audience /mcp"]) assert.ok(smoke.includes(k), `smoke tidak memuat: ${k}`);
  assert.ok(!/\.create\(|\.update\(|\.delete\(|\.upsert\(|executeRaw|\$transaction/.test(smoke), "smoke tidak boleh menulis");
  assert.ok(!/method: "(PUT|DELETE|PATCH)"/.test(smoke));
  assert.deepEqual([...new Set([...smoke.matchAll(/method: "(\w+)"/g)].map((m) => m[1]))], ["POST"], "satu-satunya metode tulis-bentuk = POST JSON-RPC ke /mcp*; endpoint laporan dibaca dengan GET bawaan");
  for (const nama of [...smoke.matchAll(/panggil\([^)]*?awalan \+ "(\w+)"/g)].map((m) => m[1])) assert.ok(["performa_campaign_meta", "rekap_harian_meta", "kesehatan_atribusi_meta", "performa_iklan"].includes(nama), `tool tak dikenal di smoke: ${nama}`);
  assert.match(smoke, /const MONOTON = \["customer", "order", "pembayaran", "touch", "jurnal"\]/); assert.match(smoke, /const STRIK = \["spend", "impor", "referensi", "biayaSumber", "sidikReferensi"\]/);
  assert.ok(!/const STRIK = \[[^\]]*"(customer|order|pembayaran|touch|jurnal)"/.test(smoke), "tabel lalu lintas tidak boleh masuk daftar identik-ketat (gagal palsu di produksi hidup)");
  assert.match(smoke, /BUKAN bahwa klien \(claude\.ai \/ ChatGPT\) sudah menyegarkan daftar tool/);
  assert.match(reh, /\/\^rehearsal_\/\.test\(nm\)/, "rehearsal hanya pada DB rehearsal_*");
  assert.match(reh, /UJI HANDLER\/SERVER LOKAL/); assert.match(reh, /skip=0\$/, "rehearsal mewajibkan tiga jalur auth teruji tanpa SKIP");
  assert.match(reh, /DISABLE_BACKGROUND_JOBS: "1"/); assert.match(reh, /neutralizeExternalEnv/);
  // rehearsal TIDAK memasang direktori data/uploads production (dijaga skrip) dan token rehearsal bukan rahasia produksi
  assert.match(src, /rehearsal TIDAK terisolasi dari direktori data\/uploads production/);
  assert.match(reh, /rehearsal-token-statis/);
  assert.match(src, /CATATAN: Rilis ini membawa tiga tool MCP laporan Meta Ads/); assert.match(src, /Developer Mode > app SANSS > Refresh/); assert.match(src, /Jangan klaim konektor terhubung sebelum satu panggilan nyata dari klien berhasil/);
});

test("fasad ChatGPT: katalog 21 entri, 9 aktif (6 lama + 3 Meta agregat) dan dokumentasi menyebut refresh konektor", () => {
  const p = lf("backend/src/mcp/chatgptPlugin.js");
  for (const n of ["sales_performa_campaign_meta", "sales_rekap_harian_meta", "sales_kesehatan_atribusi_meta"]) assert.match(p, new RegExp(`name: "${n}", canonical: "[a-z_]+", active: true, division: "sales", sensitivity: "aggregate"`));
  assert.match(p, /registerAtribusiIklanTools\(facade\)/);
  const d = lf("docs/CHATGPT-MCP-PLUGIN.md"); assert.match(d, /## Sembilan tool aktif/); assert.match(d, /\*\*Refresh\*\*/);
  const m = lf("docs/MCP-LAPORAN-META-ADS.md"); assert.match(m, /Uji lokal ≠ discovery konektor/);
});
