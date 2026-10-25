// Tes skrip rilis scripts/release-akuisisi-biaya.sh (kandidat "Akuisisi — biaya iklan tingkat sumber": web + backend + 1 migrasi ADITIF) — TANPA menyentuh produksi.
// Menjaga pin/allowlist KANDIDAT BARU. Skrip historis (release-akuisisi-sumber.sh dll.) tidak disentuh dan dijaga tes masing-masing.
// Nilai yang bergantung pada commit dihitung dari git terhadap BASE_LIVE (release aktif saat kandidat disiapkan). Bila baseline live berganti, bangkitkan ulang skrip:
//   node scripts/gen-release-akuisisi-biaya.cjs --base <SHA_LIVE>   lalu perbarui BASE_LIVE di bawah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE_LIVE = "8e5437b6";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const gen = require("../../scripts/gen-release-akuisisi-biaya.cjs");
const rel = "scripts/release-akuisisi-biaya.sh";
const scriptPath = path.join(root, rel);
const src = fs.readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");
const lf = (r) => fs.readFileSync(path.join(root, r), "utf8").replace(/\r\n/g, "\n");
const sha = (t) => createHash("sha256").update(t).digest("hex");
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
    if (l.startsWith("harus_ditolak ")) continue;   // mutan uji negatif pemindai (berisi DDL/DML palsu SENGAJA); dijalankan terpisah di tes mutan
    if (/^\s*ok "/.test(l)) continue;                // baris pesan sukses (teks saja)
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

test("sintaks bash valid, LF, tanpa placeholder; guard rollback juga valid", { skip: !punyaBash }, () => {
  assert.equal(spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/rollback-guard-akuisisi-biaya.sh")], { encoding: "utf8" }).status, 0);
  for (const r of [rel, "scripts/rollback-guard-akuisisi-biaya.sh"]) assert.ok(!fs.readFileSync(path.join(root, r), "utf8").includes("\r"), `${r} harus LF`);
  assert.ok(!/@@[A-Z_]+@@/.test(src.replace(/sed -E 's\/\^@@ \[\^@\]\*@@\.\*\$\/@@\/'/g, "")), "placeholder tersisa");
});

test("skrip = hasil bangkitan ulang generator terhadap baseline live (templat/pustaka/kode tidak menyimpang dari skrip)", { skip: adaBase ? false : alasanGit }, () => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/gen-release-akuisisi-biaya.cjs"), "--base", BASE_LIVE, "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 400));
});

test("pin: migrasi sha256 = isi berkas (LF); pin diff schema.prisma = diff terhadap baseline; diff schema MURNI penambahan", { skip: adaBase ? false : alasanGit }, () => {
  const mig = nilai("MIG_NAME"); assert.match(mig, /^\d{14}_biaya_iklan_sumber_manual$/);
  assert.equal(nilai("MIG_PIN"), sha(lf(`backend/prisma/migrations/${mig}/migration.sql`)));
  assert.equal(nilai("SCHEMA_DIFF_SHA"), gen.schemaDiffSha(BASE_LIVE));
  const d = git(["diff", "-U0", "--no-color", BASE_LIVE, "--", "backend/prisma/schema.prisma"]).stdout.split("\n");
  assert.deepEqual(d.filter((l) => l.startsWith("-") && !l.startsWith("---")), [], "schema.prisma tidak boleh menghapus/mengubah baris yang ada");
  assert.ok(d.filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n").includes("model AdSourceSpendEntry"));
  // objek rilis yang dicek di produksi/rehearsal = objek di migrasi
  const ob = gen.namaObjek(lf(`backend/prisma/migrations/${mig}/migration.sql`));
  assert.deepEqual([nilai("IDX_BARU"), nilai("IDX_UNIK"), nilai("CHK_BARU"), nilai("FK_BARU"), nilai("TRG_BARU")], [ob.idx.join(" "), ob.unik.join(" "), ob.chk.join(" "), ob.fk.join(" "), ob.trg.join(" ")]);
  assert.deepEqual([ob.idx.length, ob.unik.length, ob.chk.length, ob.fk.length, ob.trg.length], [5, 2, 8, 1, 1]);
});

test("allowlist = persis berkas kandidat; BACKEND/FRONTEND_SRC_EXPECT cocok; prisma/paket/compose/Dockerfile/.env/index.js/spend.js/campaign/skrip lain ditolak", { skip: adaBase ? false : alasanGit }, () => {
  const re = new RegExp(/ALLOWED_RE='([^']+)'/.exec(src)[1]);
  const berubah = berkasBerubah();
  const luar = berubah.filter((f) => !re.test(f)); assert.deepEqual(luar, [], "berkas kandidat di luar allowlist");
  const be = berubah.filter((f) => f.startsWith("backend/src/")).join(" "), fe = berubah.filter((f) => f.startsWith("frontend/src/")).join(" ");
  assert.equal(nilai("BACKEND_SRC_EXPECT"), be); assert.equal(nilai("FRONTEND_SRC_EXPECT"), fe);
  assert.deepEqual(berubah.filter((f) => f.startsWith("backend/src/")), ["backend/src/routes/attributionAds.js", "backend/src/routes/attributionBiayaSumber.js", "backend/src/services/attribution/biayaSumber.js", "backend/src/services/attribution/sumber.js"], "perubahan backend/src hanya 4 berkas yang diaudit");
  for (const no of ["backend/prisma/migrations/20261231000000_x/migration.sql", "backend/package.json", "backend/package-lock.json", "frontend/package.json", "docker-compose.release.yml", "docker-compose.yml", "backend/Dockerfile", "backend/.env", "backend/src/index.js",
    "backend/src/services/attribution/spend.js", "backend/src/services/attribution/iklanReport.js", "backend/src/services/attribution/biayaKpi.js", "backend/src/services/attribution/d7.js", "backend/src/routes/settings.js", "backend/src/routes/analytics.js", "backend/src/services/attribution/webhook.js",
    "scripts/release-akuisisi-sumber.sh", "scripts/release-ux-bahan.sh", "frontend/dist/index.html", "backend/prisma/seed.js"]) assert.ok(!re.test(no), `harus DITOLAK: ${no}`);
  assert.ok(re.test("scripts/release-akuisisi-biaya.sh") && re.test("backend/src/services/attribution/biayaSumber.js") && re.test("backend/prisma/schema.prisma"));
  assert.ok(!re.test("backend/src/services/attribution/biayaSumber.jsx"), "regex terjangkar (tanpa awalan/akhiran longgar)");
});

test("uji negatif pemindai DDL dijalankan di bash: SEMUA mutan ditolak; kontrol positif (SQL asli) lolos; pemindai longgar akan terdeteksi", { skip: !punyaBash }, () => {
  const awal = src.indexOf("NEG=0\n"); const akhir = src.indexOf('ok "uji negatif pemindai');
  assert.ok(awal > 0 && akhir > awal, "blok uji negatif tidak ditemukan");
  const blok = src.slice(awal, src.indexOf("\n", akhir) + 1);
  const mutan = (blok.match(/^harus_ditolak /gm) || []).length; assert.ok(mutan >= 40, `hanya ${mutan} mutan`);
  const mig = nilai("MIG_NAME"); const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uji-mutan-"));
  try {
    fs.copyFileSync(path.join(root, `backend/prisma/migrations/${mig}/migration.sql`), path.join(dir, "m.sql"));
    fs.copyFileSync(path.join(root, "scripts/lib/scan-migrasi-akuisisi-biaya.mjs"), path.join(dir, "scan.mjs"));
    const scanExpect = /SCAN_EXPECT='([^']*)'/.exec(src)[1];   // di skrip memakai kutip tunggal
    const pre = `set -Eeuo pipefail\ncd "${dir.replace(/\\/g, "/")}"\ndie() { echo "DIE: $*" >&2; exit 1; }\nok() { echo "OK: $*"; }\nALL_SQL="$(tr -d '\\r' < m.sql)"\nSCAN="scan.mjs"\nSCAN_EXPECT='${scanExpect}'\nsql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }\n`;
    const jalan = (isi) => spawnSync("bash", ["-c", pre + isi], { encoding: "utf8", cwd: dir });
    const r = jalan(blok); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 500)); assert.match(r.stdout, /OK: uji negatif pemindai: \d+ mutan/);
    // kontrol positif: SQL asli melalui pemindai = SCAN_EXPECT
    const pos = jalan(`o="$(printf '%s\\n' "$ALL_SQL" | sql_bersih | node "$SCAN")"; [ "$o" = "$SCAN_EXPECT" ] && echo POSITIF_OK`); assert.match(pos.stdout, /POSITIF_OK/);
    // bukti harness peka: mutan yang tidak mengubah hitungan (spasi) HARUS memicu die pada blok asli → pemindai yang longgar tidak lolos diam-diam
    const longgar = jalan(`NEG=0\nharus_ditolak() { local nama="$1" teks="$2" o; if o="$(printf '%s\\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "mutan '$nama' LOLOS"; fi; NEG=$((NEG+1)); }\nharus_ditolak "salinan identik" "$ALL_SQL"`);
    assert.notEqual(longgar.status, 0); assert.match(longgar.stderr, /LOLOS/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("TANPA tulis biaya produksi / env / flag / push / hapus / Meta / cron di kode skrip (komentar, heredoc, mutan pemindai, dan baris pesan diabaikan)", () => {
  for (const [re, nama] of [
    [/\bINSERT\s+INTO\s+"?ad_source/i, "INSERT biaya"], [/\bUPDATE\s+"?ad_source/i, "UPDATE biaya"], [/\bDELETE\s+FROM\s+"?(ad_source|AdSpend|meta_ad)/i, "DELETE spend"], [/\bTRUNCATE\b/i, "TRUNCATE"],
    [/\bgit\b[^\n]*\bpush\b/, "git push"], [/\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+\/(?!tmp)/, "rm -r di luar /tmp"], [/>>?\s*"?\$?\{?PERSIST\}?\/backend\/\.env/, "tulis .env"], [/\bsed\s+-i[^\n]*\.env/, "sed -i .env"],
    [/SPEND_SYNC_ENABLED=(true|"true")/, "sync ON"], [/graph\.facebook\.com|api\.windsor\.ai/i, "panggilan Meta/Windsor"], [/curl[^\n]*(-X\s*POST|--data|-d\s)/i, "curl POST"], [/crontab/i, "cron"], [/\bprune\b/, "prune"],
  ]) assert.ok(!re.test(kode), `perintah terlarang: ${nama}`);
  const sudo = kode.split("\n").filter((l) => /\bsudo\b/.test(l));
  assert.ok(sudo.length <= 1 && sudo.every((l) => l.includes('sudo -n rm -rf -- "$d"') && l.includes("HAPUS")), "sudo hanya untuk membersihkan direktori rilis LAMA (HAPUS) — bukan data");
  const drops = kode.split("\n").filter((l) => /\bDROP\s+(TABLE|DATABASE|SCHEMA|COLUMN)\b/i.test(l));
  assert.equal(drops.length, 1, "satu-satunya DROP = menghapus DB rehearsal sementara");
  assert.match(drops[0], /^reh_drop\(\) .*DROP DATABASE IF EXISTS \\"\$\{REH_DB\}\\"/);
  assert.match(kode, /prisma migrate deploy/); // satu-satunya migrasi = migrate deploy (migrasi pinned)
  assert.ok(!/prisma\s+(migrate\s+(dev|reset|resolve)|db\s+push|generate)/.test(kode), "hanya migrate deploy yang diizinkan");
});

test("smoke produksi HANYA membaca: setiap PUT adalah penolakan validasi atau dryRun; tidak ada batalkan/POST; tabel biaya dibandingkan sebelum=sesudah", () => {
  const smoke = lf("scripts/lib/smoke-akuisisi-biaya.mjs");
  const put = smoke.split("\n").filter((l) => /req\("PUT"|\["PUT"/.test(l));
  assert.ok(put.length >= 2);
  for (const l of put) assert.ok(/nominal: "-5"|INSTAGRAM|dari: hariIni|dryRun: true|\["PUT", "\/api\/atribusi\/iklan\/biaya-sumber"\]/.test(l), `PUT tidak aman di smoke: ${l.trim().slice(0, 140)}`);
  assert.ok(!/prisma\.\$executeRaw|\.create\(|\.update\(|\.delete\(|\.upsert\(/.test(smoke), "smoke tidak boleh menulis lewat prisma");
  assert.match(smoke, /sebelum\[t\]\.n !== sesudah\[t\]\.n/); assert.match(smoke, /ad_source_spend_entries/);
  for (const k of [...smoke.matchAll(/B\("([A-Z_]+)"\)/g)].map((m) => m[1])) assert.ok(new RegExp(`-e ${k}="\\$${k}"`).test(src), `smoke membutuhkan env ${k} yang tidak diteruskan skrip`);
  // lib rehearsal & kode-lama hanya menyentuh DB sementara (REH_DB / RH_URL), tidak pernah DB produksi
  const baris = src.split("\n").filter((l) => /REHNODE|LAMANODE/.test(l) && /(run|docker)/.test(l));
  assert.ok(baris.length >= 2); for (const l of baris) assert.ok(/REH_DB|RH_URL/.test(l) && !/DB_NAME/.test(l), `uji aplikasi harus ke DB rehearsal: ${l.slice(0, 120)}`);
});

test("gerbang kunci ada & berurutan: baseline, disk, ancestry, allowlist, pin, backup+checksum, build, rehearsal (migrasi idempoten, constraint fungsional, kode baru, kode LAMA, rekonsiliasi), migrate SEKALI, switch, smoke, rollback", () => {
  for (const [re, nama] of [
    [/BUKAN baseline \$\{BASE_SHA:0:8\}; produksi bergeser/, "baseline"], [/ruang disk kurang/, "disk"], [/pg_dump -U/, "pg_dump"], [/sha256sum -c /, "checksum"], [/merge-base --is-ancestor/, "ancestry"],
    [/berkas prisma yang berubah HARUS tepat migrasi rilis ini/, "prisma terbatas"], [/ada migrasi baseline yang DIUBAH\/DIHAPUS/, "migrasi lama utuh"], [/schema\.prisma: ada baris DIHAPUS\/DIUBAH/, "schema murni tambahan"],
    [/uji negatif pemindai: \$\{NEG\} mutan/, "mutan pemindai"], [/keadaan production berubah sejak preflight/, "keadaan diulang"], [/migrate deploy ke-2 MENERAPKAN sesuatu/, "migrasi idempoten"],
    [/harus 22 PASS dan 0 FAIL/, "constraint fungsional"], [/REKONSILIASI GAGAL: angka kode LAMA ≠ kode BARU/, "rekonsiliasi lama=baru"], [/rollback kode TIDAK terbukti aman/, "kode lama vs DB bermigrasi"],
    [/rehearsal MENGUBAH isi tabel/, "sidik jari rehearsal"], [/--rehearsal-only/, "rehearsal-only"], [/--preflight-only/, "preflight-only"], [/jumlah migrasi terpasang != baseline \+ 1/, "tepat 1 migrasi"],
    [/URL laporan ber-state tidak dilayani/, "deep-link periode/URL"], [/bundel web publik = dist baru/, "bundel publik"], [/rollback-guard-akuisisi-biaya\.sh/, "guard rollback"], [/docker tag \$\{ROLLBACK_TAG/, "perintah rollback kode"],
    [/dist baru tidak memuat teks fitur/, "teks fitur di dist"], [/RestartCount/, "stabil"],
  ]) assert.ok(re.test(src), `gerbang hilang: ${nama}`);
  const p = (x) => src.indexOf(x);
  const fase = ["PHASE=\"3-backup\"", "PHASE=\"5-build-image\"", "PHASE=\"5b-rehearsal\"", "PHASE=\"6-migrate\"", "PHASE=\"7-switch\"", "PHASE=\"8b-smoke\""].map(p);
  assert.ok(fase.every((x) => x > 0) && fase.every((x, i) => i === 0 || fase[i - 1] < x), "urutan fase salah");
  assert.ok(p('if [ "$REHEARSAL_ONLY" = "1" ]') > p("REKONSILIASI GAGAL") && p('if [ "$REHEARSAL_ONLY" = "1" ]') < p('PHASE="6-migrate"'), "rehearsal-only harus berhenti SEBELUM migrasi produksi");
  assert.equal((kode.match(/prisma migrate deploy <\/dev\/null \|\| die "migrate deploy GAGAL/g) || []).length, 1, "migrate deploy produksi tepat satu kali");
  for (const t of ["Kelola biaya iklan", "Atribusi label CRM", "Impor detail Ad", "Total rentang", "Sumber biaya yang dipakai", "Detail Ad mungkin parsial"]) assert.ok(src.includes(`"${t}"`), `teks dist ${t}`);
});

test("konsistensi pustaka: jumlah uji constraint (22) = skrip; rehearsal memeriksa kontrak yang dipakai UI; guard rollback hanya membaca", () => {
  const sql = lf("scripts/lib/constraint-akuisisi-biaya.sql");
  const n = (sql.match(/SELECT pg_temp\.(tolak|terima)\(/g) || []).length; assert.equal(n, 22);
  assert.ok(src.includes(`= "22" ]`));
  assert.ok(/ROLLBACK;\s*$/.test(sql.trim()), "uji constraint harus dibatalkan (ROLLBACK)");
  const reh = lf("scripts/lib/rehearsal-akuisisi-biaya.mjs");
  for (const k of ["DETAIL_AD_SELISIH", "MANUAL_OVERRIDE", "TIDAK_BERUBAH", "AKTIFKAN", "=== 409", "AGREGAT_BARU", "ATRIBUSI_LABEL_CRM"]) assert.ok(reh.includes(k), `rehearsal tidak menguji ${k}`);
  const guard = lf("scripts/rollback-guard-akuisisi-biaya.sh");
  assert.ok(!/\b(insert|update|delete|truncate|drop|alter)\b\s+(into|\w+\s+set|from|table)/i.test(guard.replace(/^\s*#.*$/gm, "")), "guard tidak boleh menulis");
  assert.match(guard, /BEGIN READ ONLY/);
  const lama = lf("scripts/lib/rehearsal-kompat-lama-akuisisi-biaya.mjs");
  assert.match(lama, /AGREGAT_LAMA/); assert.ok(!/\.(create|update|delete|upsert)\(|executeRaw/.test(lama), "uji kode lama hanya membaca");
});
