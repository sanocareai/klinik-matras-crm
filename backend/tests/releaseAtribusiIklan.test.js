// Tes skrip rilis scripts/release-atribusi-iklan.sh (Fase 2) — TANPA menyentuh produksi.
// Mengunci: flag tidak pernah dinyalakan oleh skrip, migrasi hanya aditif dan hanya di dua tempat bergerbang, tidak ada DROP/DELETE/UPDATE data, tidak push,
// pin sha256 (kode + migrasi + skema) cocok dengan pohon kerja, allowlist ketat, pemindai DDL menolak mutan, dan rollback = kode saja dengan tabel utuh.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.join(root, "scripts/release-atribusi-iklan.sh");
const migrasiPath = path.join(root, "backend/prisma/migrations/20261107090000_atribusi_touch_iklan/migration.sql");
const src = fs.readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");
const lf = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const sha = (t) => createHash("sha256").update(t).digest("hex");
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const posix = (p) => p.split(path.sep).join("/");

// kode = tanpa komentar, tanpa isi heredoc (SMOKE_JS/SCAN_JS/UJI_SQL), tanpa baris mutan uji negatif (memang memuat DROP/UPDATE sebagai BAHAN UJI)
function kodeBersih() {
  const out = []; let akhir = null;
  for (const l of src.split("\n")) {
    if (akhir) { if (l === akhir) akhir = null; continue; }
    const h = /<<'([A-Z0-9_]+)'/.exec(l);
    if (h) akhir = h[1];
    if (l.trimStart().startsWith("#")) continue;
    if (/^\s*harus_ditolak "/.test(l)) continue;
    if (/^\s*[tf] flag_mati_teks /.test(l)) continue;      // kasus selftest (string uji, bukan perintah)
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

test("gerbang murni lulus selftest (disk 5 GiB, mount, flag MATI, respons bersih)", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", [scriptPath], { encoding: "utf8", env: { ...process.env, ATRI2_RELEASE_SELFTEST: "1" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!/^FAIL/m.test(r.stdout), r.stdout);
  assert.ok(/PASS\(gagal sesuai harapan\) gate_disk_kb 5242879/.test(r.stdout));
  assert.ok(/PASS\(gagal sesuai harapan\) flag_mati_teks ATRIBUSI_TOUCH_CAPTURE_ENABLED=true/.test(r.stdout));
  assert.ok(/PASS\(gagal sesuai harapan\) respons_bersih \{"x":\{"phone"/.test(r.stdout));
});

test("TIDAK pernah menghapus, mem-push, mengubah env/flag, membangun frontend, atau menulis data produksi", () => {
  const terlarang = [
    [/\brm\s+-[a-zA-Z]*r/, "rm -r"], [/\bdocker\s+(image\s+)?rmi?\b/, "docker rmi/image rm"], [/\bprune\b/, "prune"],
    [/\bdocker\s+volume\s+(rm|prune)/, "docker volume rm"], [/\bgit\b[^\n]*\bpush\b/, "git push"], [/\bfind\b[^\n]*-delete/, "find -delete"],
    [/\bsudo\b/, "sudo"], [/>>?\s*"?\$?\{?PERSIST\}?\/backend\/\.env/, "menulis ke .env"], [/\bsed\s+-i[^\n]*\.env/, "sed -i .env"],
    [/\bnpm\s+(ci|install|run\s+build)/, "npm install/build"], [/\bprisma\s+migrate\s+(dev|reset|resolve)/, "migrate dev/reset/resolve"],
    [/\bDROP\s+(TABLE|SCHEMA|COLUMN|INDEX|FUNCTION|TRIGGER)/i, "DROP objek"], [/\bALTER\s+TABLE/i, "ALTER TABLE"],
    [/ctwa-capture-purge/, "purge capture"], [/CTWA_ATTRIBUTION_CAPTURE_ENABLED\s*=/, "mengubah flag capture Fase 0"],
    [/ATRIBUSI_TOUCH_CAPTURE_ENABLED=(true|"true"|'true')/, "menyalakan flag touch"],
    [/\b(INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i, "SQL tulis"],
    [/curl[^\n]*(-X\s*POST|--data|-d\s)/i, "curl POST ke produksi"],
  ];
  for (const [re, nama] of terlarang) assert.ok(!re.test(kode), `skrip memuat perintah terlarang: ${nama}`);
  const drops = kode.match(/DROP DATABASE[^\n]*/gi) || [];
  assert.equal(drops.length, 1, "satu DROP DATABASE saja");
  assert.match(drops[0], /IF EXISTS \\"\$\{d\}\\"/, "hanya DB sementara (variabel d dari VERIFY_DB/REH_DB)");
});

test("migrate deploy hanya di DUA tempat: DB rehearsal (DATABASE_URL ke DB sementara) dan fase 6 produksi setelah gerbang", () => {
  const baris = kode.split("\n");
  const idx = baris.map((l, i) => (/prisma migrate deploy/.test(l) ? i : -1)).filter((i) => i >= 0);
  assert.equal(idx.length, 2);
  assert.match(baris[idx[0]], /-e DATABASE_URL="postgresql:\/\/\$\{DB_USER\}:\$\{REH_PW\}@postgres:5432\/\$\{REH_DB\}"/);
  const fase6 = baris.findIndex((l) => /PHASE="6-migrate"/.test(l));
  assert.ok(fase6 >= 0 && idx[1] > fase6, "migrate deploy produksi harus setelah PHASE 6");
  assert.ok(!/DATABASE_URL/.test(baris[idx[1]]), "migrate deploy produksi memakai env container apa adanya");
  // gerbang tepat sebelum migrasi produksi
  const sebelum = baris.slice(fase6, idx[1]).join("\n");
  for (const re of [/release aktif berubah sebelum migrasi/, /\.env berubah selama rilis/, /migrasi pending bukan tepat migrasi rilis ini/, /SUDAH terpasang sebelum rilis/]) assert.match(sebelum, re);
});

test("gerbang yang dijanjikan ada di kode", () => {
  const wajib = [
    [/BUKAN baseline \$\{BASE_SHORT\}; produksi bergeser/, "baseline live bergeser = berhenti"],
    [/MIN_FREE_KB=\$\(\(5 \* 1024 \* 1024\)\)/, "gerbang disk 5 GiB"],
    [/disk_gate "awal"/, "disk awal"], [/disk_gate "setelah backup"/, "disk setelah backup"], [/disk_gate "sebelum build"/, "disk sebelum build"], [/disk_gate "sebelum switch"/, "disk sebelum switch"],
    [/pg_dump -U/, "pg_dump"], [/gzip -t /, "uji arsip"], [/sha256sum -c /, "checksum backup"],
    [/CREATE DATABASE \\"\$\{REH_DB\}\\"/, "restore ke DB rehearsal"], [/gzip -dc "\$BACKUP_FILE" \| dcp/, "restore backup nyata"],
    [/sg diff --name-only "\$BASE_SHA" "\$DEPLOY_SHA"/, "audit berkas berbeda dari baseline"], [/ALLOWED_RE/, "allowlist"], [/die "isi \$\{f\} di kandidat/, "pin sha256 kandidat"],
    [/isi migrasi \$\{n\} BERBEDA dari yang diaudit/, "pin migrasi"], [/uji negatif pemindai/, "uji negatif pemindai"],
    [/schema\.prisma menghapus\/mengubah/, "schema.prisma hanya penambahan"], [/ada migrasi baseline yang DIUBAH\/DIHAPUS/, "migrasi lama tidak berubah"],
    [/flag \$\{FLAG_NAME\} SUDAH menyala di produksi/, "flag sudah menyala = berhenti"], [/rilis ini harus flag MATI/, "flag MATI saat rilis"],
    [/migrasi\/uji rehearsal MENGUBAH isi tabel lama/, "rehearsal tidak mengubah tabel lama"], [/skema tabel lama BERUBAH oleh migrasi/, "skema tabel lama"],
    [/\.env berubah setelah rilis/, "hash .env sesudah"], [/capture CTWA Fase 0 tidak tersentuh/, "capture Fase 0 tidak tersentuh"],
    [/STATUS_NOAUTH/, "smoke 401"], [/STATUS_SALES/, "smoke 403"], [/STATUS_TANPA_RENTANG/, "smoke rentang wajib"], [/STATUS_SINYAL_SEMUA/, "smoke sinyal"], [/STATUS_ADMIN/, "smoke ADMIN 200"],
    [/CPA_ROAS_NULL/, "CPA/ROAS null"], [/KES_CAPTURE_AKTIF/, "kesehatan capture"], [/Gagal proses webhook WAHA/, "galat webhook"], [/inbox hidup/, "smoke inbox baca-saja"],
    [/MODE=rollback/, "mode rollback"], [/tabel atribusi tidak lengkap setelah rollback/, "rollback tidak menghapus tabel"], [/rollback-pre-\$\{TAG_KODE\}-\$\{DEPLOY_SHORT\}/, "tag image rollback"],
  ];
  for (const [re, nama] of wajib) assert.ok(re.test(src), `gerbang hilang: ${nama}`);
  // switch dan migrasi tidak boleh mendahului gerbang disk
  assert.ok(src.indexOf('disk_gate "sebelum switch"') < src.indexOf('PHASE="7-switch"'));
  assert.ok(src.indexOf('PHASE="5b-rehearsal"') < src.indexOf('PHASE="6-migrate"') && src.indexOf('PHASE="6-migrate"') < src.indexOf('PHASE="7-switch"'));
  assert.ok(src.indexOf('PHASE="3-backup"') < src.indexOf('PHASE="5-build-image"'));
});

test("pin sha256: berkas runtime + skema + migrasi cocok dengan pohon kerja; daftar backend/src = BACKEND_SRC_EXPECT", () => {
  const pins = [...src.matchAll(/\["(backend\/[^"]+)"\]="([0-9a-f]{64})"/g)];
  assert.equal(pins.length, 9);
  for (const m of pins) assert.equal(sha(lf(m[1])), m[2], `pin ${m[1]} basi — tinjau perubahan lalu perbarui pin`);
  const mig = /MIGS="([0-9]{14}_[a-z0-9_]+):([0-9a-f]{64})"/.exec(src);
  assert.ok(mig);
  assert.equal(mig[1], "20261107090000_atribusi_touch_iklan");
  assert.equal(sha(lf("backend/prisma/migrations/20261107090000_atribusi_touch_iklan/migration.sql")), mig[2], "pin migrasi basi");
  const be = /BACKEND_SRC_EXPECT="([^"]+)"/.exec(src)[1].split(" ").sort();
  assert.deepEqual(pins.map((m) => m[1]).filter((f) => f.startsWith("backend/src/")).sort(), be);
});

test("allowlist: hanya berkas Fase 2 + dua skrip lama yang di-pin ulang; skema/paket/compose/frontend/Finance/Production ditolak", () => {
  const re = new RegExp(/ALLOWED_RE='([^']+)'/.exec(src)[1]);
  for (const ok of [
    "backend/prisma/migrations/20261107090000_atribusi_touch_iklan/migration.sql", "backend/prisma/schema.prisma", "backend/src/index.js",
    "backend/src/routes/attributionAds.js", "backend/src/routes/webhooks.js", "backend/src/services/attribution/touchCapture.js", "backend/src/services/attribution/iklanReport.js",
    "backend/src/services/attribution/adReferensi.js", "backend/src/services/attribution/captureHealth.js", "backend/src/services/attribution/cohortLoader.js",
    "backend/tests/atribusiTouchAtomik.test.js", "backend/tests/releaseAtribusiIklan.test.js", "backend/tests/integration/atribusiTouchCrash.integration.test.js",
    "backend/tests/integration/helpers/atribusiCrashChild.mjs", "docs/ATRIBUSI-FASE2-TOUCH-IKLAN.md", "scripts/release-atribusi-iklan.sh",
    "scripts/release-atribusi-kohort.sh", "scripts/release-ctwa-capture-flag-off.sh",
  ]) assert.ok(re.test(ok), `harus diizinkan: ${ok}`);
  for (const no of [
    "backend/prisma/migrations/20261108000000_lain/migration.sql", "backend/package.json", "backend/package-lock.json", "docker-compose.release.yml", "docker-compose.yml",
    "backend/Dockerfile", "frontend/src/App.jsx", "frontend/package.json", "backend/src/routes/finance.js", "backend/src/routes/analytics.js", "backend/src/services/ctwaCapture.js",
    "backend/src/services/attribution/cohort.js", "backend/src/db.js", ".env", "backend/.env", "backend/data/ctwa-capture/x.jsonl", "scripts/release-lain.sh",
  ]) assert.ok(!re.test(no), `harus ditolak: ${no}`);
});

test("pemindai DDL: menerima migrasi asli (hitungan persis) dan menolak SEMUA mutan; migrasi yang diselundupi ditolak", { skip: !punyaBash }, () => {
  const A = "a".repeat(40), B = "b".repeat(40);
  const jalan = (file) => spawnSync("bash", [scriptPath, A, B], { encoding: "utf8", timeout: 120_000, env: { ...process.env, ATRI2_SCAN_SELFTEST_FILE: posix(file) } });
  const r = jalan(migrasiPath);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SCAN_OK \{"total":13,"create_table":3,"create_index":6,"fk":4,"check":13\}/);
  const n = Number(/uji negatif pemindai: (\d+) mutan/.exec(r.stdout)?.[1]);
  assert.ok(n >= 30, `mutan ${n}`);
  // selundupkan satu UPDATE ke tabel lama
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atri2-scan-"));
  try {
    const rusak = path.join(tmp, "m.sql");
    fs.writeFileSync(rusak, lf("backend/prisma/migrations/20261107090000_atribusi_touch_iklan/migration.sql") + "\nUPDATE \"Customer\" SET \"leadSource\" = 'META_ADS';\n");
    const r2 = jalan(rusak);
    assert.equal(r2.status, 1);
    assert.match(r2.stdout + r2.stderr, /SCAN_DITOLAK|DI LUAR DAFTAR PUTIH/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("migrasi sesuai klaim: 3 tabel baru kosong, tanpa kolom pribadi/clid mentah/payload, FK customer CASCADE dan message SET NULL", () => {
  const m = lf("backend/prisma/migrations/20261107090000_atribusi_touch_iklan/migration.sql").replace(/^--.*$/gm, "");
  assert.equal((m.match(/CREATE TABLE/g) || []).length, 3);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(m.replace(/ON (DELETE|UPDATE) /g, "")));
  const touch = /CREATE TABLE "attribution_touches" \(([\s\S]*?)\n\);/.exec(m)[1];
  for (const kolom of ["phone", "name", "content", "text", "body", "payload", "jid", "raw", "ctwa_clid"]) assert.ok(!new RegExp(`"${kolom}" `).test(touch), `kolom terlarang pada attribution_touches: ${kolom}`);
  assert.match(m, /"attribution_touches_customer_id_fkey"\s+FOREIGN KEY \("customer_id"\) REFERENCES "Customer"\("id"\) ON DELETE CASCADE/);
  assert.match(m, /"attribution_touches_message_id_fkey"\s+FOREIGN KEY \("message_id"\) REFERENCES "Message"\("id"\) ON DELETE SET NULL/);
});

// ── MODE --rollback dieksekusi NYATA terhadap shim docker/curl/flock (tanpa produksi): gerbang dan urutan perintah ───────────────────────
function siapkanSandboxRollback({ rilisAktif }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atri2-rb-"));
  const DEP = "e".repeat(40), BASE = "b".repeat(40);
  const home = path.join(tmp, "home"), bin = path.join(tmp, "bin");
  const dirBase = path.join(home, "releases/klinik-matras", BASE.slice(0, 8)), dirDep = path.join(home, "releases/klinik-matras", DEP.slice(0, 8));
  for (const d of [bin, dirBase, dirDep, path.join(home, "klinik-matras/backend")]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(dirBase, "docker-compose.release.yml"), "services: {}\n");
  fs.writeFileSync(path.join(dirBase, "docker-compose.yml"), "services: {}\n");
  fs.writeFileSync(path.join(dirBase, ".release-commit"), BASE.slice(0, 8) + "\n");
  fs.writeFileSync(path.join(dirDep, ".release-commit"), DEP.slice(0, 8) + "\n");
  fs.writeFileSync(path.join(home, "klinik-matras/backend/.env"), "JWT_SECRET=x\nCTWA_CAPTURE_HASH_SALT=y\n");
  const state = path.join(tmp, "state.dir"), log = path.join(tmp, "docker.log");
  fs.writeFileSync(state, rilisAktif === "dep" ? `releases/klinik-matras/${DEP.slice(0, 8)}` : "releases/klinik-matras/ffffffff");
  const sh = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  sh("flock", "exit 0");
  sh("curl", 'echo \'{"ok":true}\'');
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
    if [[ "$*" == *" exec "* && "$*" == *psql* ]]; then echo 3; fi ;;
esac
exit 0`);
  return { tmp, bin, home, DEP, BASE, log, state, dirBase, dirDep };
}
const jalankanRollback = (sb) => spawnSync("bash", [scriptPath, sb.DEP, sb.BASE, "--rollback"], {
  encoding: "utf8", timeout: 60_000, env: { PATH: `${sb.bin}${path.delimiter}${process.env.PATH}`, HOME: posix(sb.home) },
});

test("--rollback (shim): rilis aktif = kandidat → tandai ulang image, recreate dari release SEBELUMNYA, .env utuh, 3 tabel utuh, tanpa build/DROP", { skip: !punyaBash }, () => {
  const sb = siapkanSandboxRollback({ rilisAktif: "dep" });
  try {
    const r = jalankanRollback(sb);
    assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1500));
    const log = fs.readFileSync(sb.log, "utf8");
    assert.match(log, /docker tag klinik-matras-backend:rollback-pre-atri2-eeeeeeee klinik-matras-backend:latest/);
    assert.match(log, /up -d --no-deps --force-recreate backend/);
    assert.match(log, /cwd=.*releases[\\/]klinik-matras[\\/]bbbbbbbb/, "recreate dijalankan dari direktori release SEBELUMNYA");
    assert.ok(!/\bbuild\b/.test(log), "rollback tidak membangun image");
    assert.ok(!/drop|delete|truncate|migrate/i.test(log.replace(/force-recreate/g, "")), "rollback tidak menyentuh data/skema");
    assert.match(r.stdout, /rollback selesai: release bbbbbbbb/);
    assert.match(r.stdout, /3 tabel atribusi UTUH/);
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
    assert.ok(!/docker tag /.test(log) && !/force-recreate/.test(log), "tidak boleh mengubah apa pun");
  } finally { fs.rmSync(sb.tmp, { recursive: true, force: true }); }
});

test("SMOKE_JS valid secara sintaks, hanya GET, tidak mencetak token, dan hanya membaca (tanpa POST/penulisan Prisma)", () => {
  const js = heredoc("SMOKE_JS");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atri2-smoke-"));
  try {
    const f = path.join(tmp, "smoke.cjs");
    fs.writeFileSync(f, js);
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.ok(!/method:\s*["']POST|\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/.test(js), "smoke tidak boleh menulis");
  assert.ok(!/console\.log\([^)]*(token|tA\b|tS\b)/.test(js), "token tidak boleh tercetak");
  assert.ok(/http\.get\(/.test(js));
});
