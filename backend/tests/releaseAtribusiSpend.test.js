// Tes skrip rilis scripts/release-atribusi-spend.sh (Fase 3) — TANPA menyentuh produksi.
// Mengunci: sinkronisasi/flag tidak dinyalakan, migrasi aditif bergerbang, tidak ada DROP/DELETE/UPDATE data, tidak push, tidak ada panggilan ke Meta, pin sha256 (kode + migrasi + skema),
// allowlist ketat, pemindai DDL menolak mutan, smoke = dry-run saja, rollback = kode saja dengan semua tabel utuh.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.join(root, "scripts/release-atribusi-spend.sh");
const migrasiRel = "backend/prisma/migrations/20261201090000_atribusi_spend_kpi/migration.sql";
const src = fs.readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");
const lf = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const sha = (t) => createHash("sha256").update(t).digest("hex");
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const posix = (p) => p.split(path.sep).join("/");

function kodeBersih() {
  const out = []; let akhir = null;
  for (const l of src.split("\n")) {
    if (akhir) { if (l === akhir) akhir = null; continue; }
    const h = /<<'([A-Z0-9_]+)'/.exec(l);
    if (h) akhir = h[1];
    if (l.trimStart().startsWith("#")) continue;
    if (/^\s*harus_ditolak "/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n");
}
const kode = kodeBersih();
const heredoc = (nama) => {
  const m = new RegExp(`read -r -d '' ${nama} <<'([A-Z0-9_]+)' \\|\\| true\\n([\\s\\S]*?)\\n\\1\\n`).exec(src);
  assert.ok(m, `${nama} tidak ditemukan`);
  return m[2];
};

test("sintaks bash valid, berkas LF, dan tidak ada placeholder pin", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.readFileSync(scriptPath, "utf8").includes("\r"), "skrip harus LF");
  assert.ok(!/__PIN_/.test(src), "pin masih placeholder");
});

test("TIDAK pernah menghapus berkas/image, mem-push, mengubah env/flag, memanggil Meta, atau menulis data produksi", () => {
  const terlarang = [
    [/\brm\s+-[a-zA-Z]*r/, "rm -r"], [/\bdocker\s+(image\s+)?rmi?\b/, "docker rmi/image rm"], [/\bprune\b/, "prune"],
    [/\bdocker\s+volume\s+(rm|prune)/, "docker volume rm"], [/\bgit\b[^\n]*\bpush\b/, "git push"], [/\bsudo\b/, "sudo"],
    [/>>?\s*"?\$?\{?PERSIST\}?\/backend\/\.env/, "menulis ke .env"], [/\bsed\s+-i[^\n]*\.env/, "sed -i .env"],
    [/\bprisma\s+migrate\s+(dev|reset|resolve)/, "migrate dev/reset/resolve"], [/\bDROP\s+(TABLE|SCHEMA|COLUMN|INDEX|FUNCTION|TRIGGER)/i, "DROP objek"], [/\bALTER\s+TABLE/i, "ALTER TABLE"],
    [/SPEND_SYNC_ENABLED=(true|"true"|'true')/, "menyalakan sinkronisasi spend"], [/ATRIBUSI_TOUCH_CAPTURE_ENABLED\s*=/, "mengubah flag capture"],
    [/\b(INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i, "SQL tulis"],
    [/curl[^\n]*(-X\s*POST|--data|-d\s)/i, "curl POST ke produksi"], [/graph\.facebook\.com|api\.windsor\.ai/i, "panggilan ke Meta/Windsor"],
    [/crontab/i, "memasang cron"], [/ATRIBUSI_ALERT_NOTIFY_PHONE\s*=/, "menetapkan tujuan WA"],
  ];
  for (const [re, nama] of terlarang) assert.ok(!re.test(kode), `skrip memuat perintah terlarang: ${nama}`);
  const drops = kode.match(/DROP DATABASE[^\n]*/gi) || [];
  assert.equal(drops.length, 1, "satu DROP DATABASE saja");
  assert.match(drops[0], /IF EXISTS \\"\$\{REH_DB\}\\"/, "hanya DB rehearsal");
});

test("migrate deploy hanya di DUA tempat: DB rehearsal dan fase 6 produksi setelah gerbang", () => {
  const baris = kode.split("\n");
  const idx = baris.map((l, i) => (/prisma migrate deploy/.test(l) ? i : -1)).filter((i) => i >= 0);
  assert.equal(idx.length, 2);
  assert.match(baris[idx[0]], /-e DATABASE_URL="postgresql:\/\/\$\{DB_USER\}:\$\{REH_PW\}@postgres:5432\/\$\{REH_DB\}"/);
  const fase6 = baris.findIndex((l) => /PHASE="6-migrate"/.test(l));
  assert.ok(fase6 >= 0 && idx[1] > fase6);
  assert.ok(!/DATABASE_URL/.test(baris[idx[1]]));
  const sebelum = baris.slice(fase6, idx[1]).join("\n");
  for (const re of [/release aktif berubah sebelum migrasi/, /\.env berubah selama rilis/, /migrasi pending bukan tepat migrasi rilis ini/, /SUDAH terpasang sebelum rilis/]) assert.match(sebelum, re);
});

test("gerbang yang dijanjikan ada, dan urutan fase benar", () => {
  const wajib = [
    [/BUKAN baseline \$\{BASE_SHORT\}; produksi bergeser/, "baseline bergeser"], [/MIN_FREE_KB=\$\(\(5 \* 1024 \* 1024\)\)/, "disk 5 GiB"],
    [/disk_gate "awal"/, "disk awal"], [/disk_gate "setelah backup"/, "disk setelah backup"], [/disk_gate "sebelum build"/, "disk sebelum build"], [/disk_gate "sebelum switch"/, "disk sebelum switch"],
    [/pg_dump -U/, "pg_dump"], [/gzip -t /, "uji arsip"], [/sha256sum -c /, "checksum backup"], [/gzip -dc "\$BACKUP_FILE" \| dcp/, "restore backup nyata"],
    [/ALLOWED_RE/, "allowlist"], [/die "isi \$\{f\} di kandidat/, "pin kandidat"], [/isi migrasi \$\{n\} BERBEDA dari yang diaudit/, "pin migrasi"], [/uji_negatif_pemindai\n/, "uji negatif pemindai"],
    [/schema\.prisma menghapus\/mengubah/, "schema hanya penambahan"], [/ada migrasi baseline yang DIUBAH\/DIHAPUS/, "migrasi lama utuh"],
    [/\$\{FLAG_SYNC\}=true SUDAH menyala/, "sync sudah menyala = berhenti"], [/touch BERKURANG/, "touch tidak berkurang"],
    [/migrasi\/uji rehearsal MENGUBAH isi tabel lama atau tabel atribusi Fase 2/, "rehearsal tidak mengubah tabel lama/atribusi"], [/skema tabel lama\/atribusi BERUBAH oleh migrasi/, "skema lama utuh"],
    [/\.env berubah setelah rilis/, "hash .env"], [/capture CTWA Fase 0 tidak tersentuh/, "capture Fase 0"], [/nilai \$\{FLAG_CAPTURE\} di container berubah/, "flag capture tidak berubah"],
    [/diff menyentuh jalur otomasi campaign\/budget/, "tanpa otomasi campaign"], [/adapter Meta memuat metode non-GET/, "adapter hanya GET"], [/log memuat token\/Bearer/, "log tanpa token"],
    [/IMPOR_DRY_FLAG/, "smoke impor dry-run"], [/IMPOR_KOMIT_TANPA_ZONA/, "commit tanpa zona ditolak"], [/TARGET_SEMUA_NULL/, "target default null"], [/BIAYA_STATUS/, "biaya tanpa spend"],
    [/TABEL_BARU_BERUBAH/, "smoke tidak menulis"], [/MONITOR_TOKEN/, "monitor tanpa token"], [/bundel web publik = dist baru/, "web live"], [/aset lama masih 200/, "aset lama"],
    [/MODE=rollback/, "mode rollback"], [/tabel atribusi\/spend tidak lengkap setelah rollback/, "rollback tidak menghapus tabel"], [/rollback-pre-\$\{TAG_KODE\}-\$\{DEPLOY_SHORT\}/, "tag rollback"],
  ];
  for (const [re, nama] of wajib) assert.ok(re.test(src), `gerbang hilang: ${nama}`);
  const p = (x) => src.indexOf(x);
  assert.ok(p('disk_gate "sebelum switch"') < p('PHASE="7-switch"'));
  assert.ok(p('PHASE="3-backup"') < p('PHASE="4-release-dir"') && p('PHASE="4-release-dir"') < p('PHASE="5-build-image"'));
  assert.ok(p('PHASE="5b-rehearsal"') < p('PHASE="6-migrate"') && p('PHASE="6-migrate"') < p('PHASE="7-switch"'));
});

test("pin sha256: berkas runtime + skema + migrasi cocok dengan pohon kerja; daftar backend/src = BACKEND_SRC_EXPECT; frontend/src = FRONTEND_SRC_EXPECT", () => {
  const pins = [...src.matchAll(/\["(backend\/[^"]+)"\]="([0-9a-f]{64})"/g)];
  assert.equal(pins.length, 10);
  for (const m of pins) assert.equal(sha(lf(m[1])), m[2], `pin ${m[1]} basi — tinjau perubahan lalu perbarui pin`);
  const mig = /MIGS="([0-9]{14}_[a-z0-9_]+):([0-9a-f]{64})"/.exec(src);
  assert.equal(mig[1], "20261201090000_atribusi_spend_kpi");
  assert.equal(sha(lf(migrasiRel)), mig[2], "pin migrasi basi");
  const be = /BACKEND_SRC_EXPECT="([^"]+)"/.exec(src)[1].split(" ").sort();
  assert.deepEqual(pins.map((m) => m[1]).filter((f) => f.startsWith("backend/src/")).sort(), be);
  const fe = /FRONTEND_SRC_EXPECT="([^"]+)"/.exec(src)[1].split(" ");
  for (const f of fe) assert.ok(fs.existsSync(path.join(root, f)), `berkas frontend tidak ada: ${f}`);
});

test("allowlist: hanya berkas Fase 3; skema lain/paket/compose/Finance/Production/campaign automation ditolak", () => {
  const re = new RegExp(/ALLOWED_RE='([^']+)'/.exec(src)[1]);
  for (const ok of [
    migrasiRel, "backend/prisma/schema.prisma", "backend/src/routes/attributionAds.js", "backend/src/routes/attributionSpend.js", "backend/src/services/attribution/biayaKpi.js",
    "backend/src/services/attribution/iklanReport.js", "backend/src/services/attribution/monitor.js", "backend/src/services/attribution/spend.js", "backend/src/services/attribution/spendSyncMeta.js",
    "backend/scripts/atribusi-monitor.js", "backend/scripts/sync-spend-meta.js", "backend/tests/atribusiSpendKpi.test.js", "backend/tests/releaseAtribusiSpend.test.js",
    "backend/tests/integration/atribusiIklan.integration.test.js", "frontend/src/api.js", "frontend/src/features/laporan/iklanCampaignLogic.js",
    "frontend/src/features/laporan/components/IklanCampaignTab.jsx", "frontend/src/features/laporan/components/IklanBiayaPanel.jsx", "frontend/tests/iklanCampaignLogic.test.js",
    "docs/ATRIBUSI-SPEND-KPI-FASE3.md", "scripts/release-atribusi-spend.sh", "scripts/atribusi-monitor-cron.sh",
  ]) assert.ok(re.test(ok), `harus diizinkan: ${ok}`);
  for (const no of [
    "backend/prisma/migrations/20261202000000_lain/migration.sql", "backend/package.json", "backend/package-lock.json", "docker-compose.release.yml", "backend/Dockerfile", "frontend/package.json",
    "frontend/src/pages/Laporan.jsx", "frontend/src/App.jsx", "backend/src/routes/finance.js", "backend/src/routes/analytics.js", "backend/src/index.js", "backend/src/routes/webhooks.js",
    "backend/src/services/attribution/touchCapture.js", "backend/src/services/attribution/cohort.js", "backend/src/services/meta/campaignAutomation.js", "backend/src/db.js", "backend/.env", "frontend/dist/index.html", "scripts/release-lain.sh",
  ]) assert.ok(!re.test(no), `harus ditolak: ${no}`);
});

test("pemindai DDL: menerima migrasi asli (hitungan persis) dan menolak SEMUA mutan; migrasi yang diselundupi ditolak", { skip: !punyaBash }, () => {
  const A = "a".repeat(40), B = "b".repeat(40);
  const jalan = (file) => spawnSync("bash", [scriptPath, A, B], { encoding: "utf8", timeout: 120_000, env: { ...process.env, ATRI3_SCAN_SELFTEST_FILE: posix(file) } });
  const r = jalan(path.join(root, migrasiRel));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SCAN_OK \{"total":12,"create_table":5,"create_index":5,"fk":2,"check":14\}/);
  assert.ok(Number(/uji negatif pemindai: (\d+) mutan/.exec(r.stdout)?.[1]) >= 30);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atri3-scan-"));
  try {
    for (const tambah of ["UPDATE \"Customer\" SET \"leadSource\" = 'META_ADS';", "INSERT INTO \"attribution_kpi_targets\" (\"id\", \"max_cpl\") VALUES (1, 200000);", "ALTER TABLE \"attribution_touches\" ADD COLUMN \"spend\" TEXT;"]) {
      const rusak = path.join(tmp, "m.sql");
      fs.writeFileSync(rusak, lf(migrasiRel) + "\n" + tambah + "\n");
      const r2 = jalan(rusak);
      assert.equal(r2.status, 1, tambah);
      assert.match(r2.stdout + r2.stderr, /SCAN_DITOLAK|DI LUAR DAFTAR PUTIH/);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("migrasi sesuai klaim: 5 tabel baru, IDR/non-negatif, tanpa kolom token/PII/respons mentah, FK RESTRICT, tanpa DROP/DELETE/UPDATE/INSERT", () => {
  const m = lf(migrasiRel).replace(/^--.*$/gm, "");
  assert.equal((m.match(/CREATE TABLE/g) || []).length, 5);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(m.replace(/ON (DELETE|UPDATE) /g, "")));
  for (const kolom of ["phone", "token", "access_token", "payload", "raw_response", "customer_id", "message_id", "ctwa_clid", "content"]) assert.ok(!new RegExp(`"${kolom}" `).test(m), `kolom terlarang: ${kolom}`);
  assert.match(m, /"meta_ad_daily_spend_currency_check" CHECK \("currency" = 'IDR'\)/);
  assert.match(m, /"meta_ad_daily_spend_spend_check" CHECK \("spend" >= 0\)/);
  assert.match(m, /CREATE UNIQUE INDEX "meta_ad_daily_spend_key" ON "meta_ad_daily_spend"\("date_wib", "account_id", "ad_id", "source"\)/);
  assert.match(m, /"attribution_kpi_targets_singleton_check" CHECK \("id" = 1\)/);
  assert.equal((m.match(/ON DELETE RESTRICT/g) || []).length, 2);
});

// ── MODE --rollback dieksekusi NYATA terhadap shim docker/curl/flock: gerbang dan urutan perintah ───────────────────────
function siapkanSandboxRollback({ rilisAktif }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atri3-rb-"));
  const DEP = "e".repeat(40), BASE = "b".repeat(40);
  const home = path.join(tmp, "home"), bin = path.join(tmp, "bin");
  const dirBase = path.join(home, "releases/klinik-matras", BASE.slice(0, 8)), dirDep = path.join(home, "releases/klinik-matras", DEP.slice(0, 8));
  for (const d of [bin, path.join(dirBase, "frontend/dist"), dirDep, path.join(home, "klinik-matras/backend")]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(dirBase, "docker-compose.release.yml"), "services: {}\n");
  fs.writeFileSync(path.join(dirBase, "docker-compose.yml"), "services: {}\n");
  fs.writeFileSync(path.join(dirBase, ".release-commit"), BASE.slice(0, 8) + "\n");
  fs.writeFileSync(path.join(dirBase, "frontend/dist/index.html"), '<script src="/assets/index-LAMA123.js"></script>');
  fs.writeFileSync(path.join(dirDep, ".release-commit"), DEP.slice(0, 8) + "\n");
  fs.writeFileSync(path.join(home, "klinik-matras/backend/.env"), "JWT_SECRET=x\nCTWA_CAPTURE_HASH_SALT=y\n");
  const state = path.join(tmp, "state.dir"), log = path.join(tmp, "docker.log");
  fs.writeFileSync(state, rilisAktif === "dep" ? `releases/klinik-matras/${DEP.slice(0, 8)}` : "releases/klinik-matras/ffffffff");
  const sh = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  sh("flock", "exit 0");
  sh("curl", 'case "$*" in *health*) echo \'{"ok":true}\' ;; *) echo \'<script src="/assets/index-LAMA123.js"></script>\' ;; esac');
  sh("docker", `
STATE="${posix(state)}"; LOG="${posix(log)}"
echo "docker $*" >> "$LOG"
case "$1" in
  ps) echo cid123 ;;
  inspect)
    case "$*" in
      *working_dir*) echo "$HOME/$(cat "$STATE")" ;;
      *Config.Image*) echo klinik-matras-backend:latest ;;
      *RestartCount*) echo 0 ;;
      *'{{.Image}}'*) echo sha256:aaaaaaaaaaaaaaaaaaaaaaaa ;;
      *) echo ;;
    esac ;;
  image) exit 0 ;;
  tag) exit 0 ;;
  exec) echo 3 ;;
  compose)
    if [[ "$*" == *"up -d --no-deps --force-recreate backend"* ]]; then echo "cwd=$PWD" >> "$LOG"; REL="$PWD"; REL="\${REL#$HOME/}"; echo "$REL" > "$STATE"; fi
    if [[ "$*" == *" exec "* && "$*" == *psql* ]]; then echo 8; fi ;;
esac
exit 0`);
  return { tmp, bin, home, DEP, BASE, log, state };
}
const jalankanRollback = (sb) => spawnSync("bash", [scriptPath, sb.DEP, sb.BASE, "--rollback"], { encoding: "utf8", timeout: 60_000, env: { PATH: `${sb.bin}${path.delimiter}${process.env.PATH}`, HOME: posix(sb.home) } });

test("--rollback (shim): rilis aktif = kandidat → tag ulang image, recreate dari release SEBELUMNYA, .env utuh, 8 tabel utuh, tanpa build/DROP", { skip: !punyaBash }, () => {
  const sb = siapkanSandboxRollback({ rilisAktif: "dep" });
  try {
    const r = jalankanRollback(sb);
    assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1500));
    const log = fs.readFileSync(sb.log, "utf8");
    assert.match(log, /docker tag klinik-matras-backend:rollback-pre-atri3-eeeeeeee klinik-matras-backend:latest/);
    assert.match(log, /cwd=.*releases[\\/]klinik-matras[\\/]bbbbbbbb/);
    assert.ok(!/\bbuild\b/.test(log) && !/drop|delete|truncate|migrate/i.test(log.replace(/force-recreate/g, "")));
    assert.match(r.stdout, /rollback selesai: release bbbbbbbb/);
    assert.match(r.stdout, /8 tabel atribusi\+spend UTUH/);
    assert.equal(fs.readFileSync(path.join(sb.home, "klinik-matras/backend/.env"), "utf8"), "JWT_SECRET=x\nCTWA_CAPTURE_HASH_SALT=y\n");
  } finally { fs.rmSync(sb.tmp, { recursive: true, force: true }); }
});

test("--rollback (shim): rilis aktif BUKAN kandidat → berhenti, tidak ada tag/recreate", { skip: !punyaBash }, () => {
  const sb = siapkanSandboxRollback({ rilisAktif: "lain" });
  try {
    const r = jalankanRollback(sb);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /BUKAN eeeeeeee; rollback ini tidak berlaku/);
    const log = fs.existsSync(sb.log) ? fs.readFileSync(sb.log, "utf8") : "";
    assert.ok(!/docker tag /.test(log) && !/force-recreate/.test(log));
  } finally { fs.rmSync(sb.tmp, { recursive: true, force: true }); }
});

test("SMOKE_JS valid sintaks; impor hanya DRY-RUN (commit tanpa zona = 400); tanpa penulisan Prisma; token tidak tercetak", () => {
  const js = heredoc("SMOKE_JS");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atri3-smoke-"));
  try {
    const f = path.join(tmp, "smoke.cjs");
    fs.writeFileSync(f, js);
    assert.equal(spawnSync(process.execPath, ["--check", f], { encoding: "utf8" }).status, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.ok(!/\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/.test(js), "smoke tidak boleh menulis lewat Prisma");
  assert.ok(!/dryRun:\s*false/.test(js.replace(/\{ csv, accountId: "9999999999", dryRun: false \}/, "")), "satu-satunya dryRun:false adalah uji penolakan commit tanpa zona");
  assert.ok(!/zonaWaktuAkun/.test(js), "smoke tidak pernah menyertakan zona (commit tidak mungkin berhasil)");
  assert.ok(!/console\.log\(\s*(tA|tS)\b/.test(js), "token tidak boleh dicetak");
});
