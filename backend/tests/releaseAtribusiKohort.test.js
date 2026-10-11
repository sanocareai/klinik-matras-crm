// Tes skrip rilis scripts/release-atribusi-kohort.sh — TANPA menyentuh produksi.
// Mengunci jaminan: kode saja, tanpa migrasi, env tidak diubah, capture CTWA tidak disentuh, tidak menghapus apa pun, tidak push,
// berhenti pada gerbang yang disebut, dan ada mode rollback bergerbang.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.join(root, "scripts/release-atribusi-kohort.sh");
const src = fs.readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");
const kode = src.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n"); // tanpa komentar

const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;

test("skrip rilis atribusi: sintaks bash valid dan berkas LF", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.readFileSync(scriptPath, "utf8").includes("\r"), "skrip harus LF");
});

test("skrip rilis atribusi: gerbang murni lulus selftest (disk 5 GiB, mount, snapshot, respons bersih)", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", [scriptPath], { encoding: "utf8", env: { ...process.env, ATRK_RELEASE_SELFTEST: "1" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!/^FAIL/m.test(r.stdout), r.stdout);
  assert.ok(/PASS\(gagal sesuai harapan\) gate_disk_kb 5242879/.test(r.stdout));
  assert.ok(/PASS\(gagal sesuai harapan\) respons_bersih \{"roas"/.test(r.stdout));
});

test("skrip rilis atribusi: TIDAK pernah menghapus, memangkas, mem-push, mengubah env, migrasi, atau menyentuh capture", () => {
  const terlarang = [
    [/\brm\s+-[a-zA-Z]*r/, "rm -r"], [/\bdocker\s+(image\s+)?rmi?\b/, "docker rmi/image rm"], [/\bprune\b/, "prune"],
    [/\bdocker\s+volume\s+(rm|prune)/, "docker volume rm"], [/\bgit\b[^\n]*\bpush\b/, "git push"], [/\bfind\b[^\n]*-delete/, "find -delete"],
    [/\bsudo\b/, "sudo"], [/>>\s*"?\$?\{?PERSIST\}?\/backend\/\.env/, "append ke .env"], [/\bsed\s+-i[^\n]*\.env/, "sed -i .env"],
    [/\bmigrate\s+(deploy|dev|reset|resolve)/, "migrate deploy/dev/reset/resolve"], [/\bnpm\s+(ci|install|run\s+build)/, "npm install/build"],
    [/\bDROP\s+(TABLE|SCHEMA|COLUMN)/i, "DROP TABLE/SCHEMA/COLUMN"], [/ctwa-capture-purge/, "purge capture"], [/CTWA_ATTRIBUTION_CAPTURE_ENABLED\s*=/, "mengubah flag capture"],
    [/\b(INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i, "SQL tulis"],
  ];
  for (const [re, nama] of terlarang) assert.ok(!re.test(kode), `skrip memuat perintah terlarang: ${nama}`);
  const drops = kode.match(/DROP DATABASE[^\n]*/gi) || [];
  assert.equal(drops.length, 1);
  assert.match(drops[0], /IF EXISTS \\"\$\{VERIFY_DB\}\\"/);
});

test("skrip rilis atribusi: gerbang yang dijanjikan ada (baseline, disk, backup+restore, pin, allowlist, .env, CTWA, migrasi, RBAC, SQL)", () => {
  const wajib = [
    [/BUKAN baseline \$\{BASE_SHORT\}; produksi bergeser/, "baseline live bergeser = berhenti"],
    [/MIN_FREE_KB=\$\(\(5 \* 1024 \* 1024\)\)/, "gerbang disk 5 GiB"],
    [/disk_gate "awal"/, "disk awal"], [/disk_gate "setelah backup\+verifikasi restore"/, "disk setelah backup"],
    [/disk_gate "sebelum build"/, "disk sebelum build"], [/disk_gate "sebelum switch"/, "disk sebelum switch"],
    [/pg_dump -U/, "pg_dump"], [/gzip -t /, "uji arsip"], [/sha256sum -c /, "checksum backup"], [/CREATE DATABASE \\"\$\{VERIFY_DB\}\\"/, "restore ke DB sementara"],
    [/DIST|frontend\/dist/, "dist disalin, bukan dibangun"],
    [/sg diff --name-only "\$BASE_SHA" "\$DEPLOY_SHA"/, "audit berkas berbeda dari baseline"], [/ALLOWED_RE/, "allowlist"], [/die "isi \$\{f\} di kandidat/, "pin sha256 kandidat"],
    [/migrate status[^\n]*\n?[^\n]*up to date/, "tanpa migration pending"], [/diff -rq "\$PREV_DIR\/backend\/prisma"/, "prisma identik"],
    [/ENV_BEFORE="\$\(env_sha\)"/, "hash .env sebelum"], [/\.env berubah setelah rilis/, "hash .env sesudah"],
    [/CTWA_BEFORE=/, "variabel CTWA_* sebelum"], [/capture CTWA tidak tersentuh/, "capture tidak tersentuh"],
    [/STATUS_NOAUTH/, "smoke 401"], [/STATUS_SALES/, "smoke 403"], [/STATUS_ADMIN/, "smoke ADMIN 200"],
    [/angka endpoint != SQL independen/, "pembanding SQL independen"],
    [/MODE=rollback/, "mode rollback"], [/rollback-pre-\$\{TAG_KODE\}-\$\{DEPLOY_SHORT\}/, "tag image rollback"],
  ];
  for (const [re, nama] of wajib) assert.ok(re.test(src), `gerbang hilang: ${nama}`);
});

test("skrip rilis atribusi: ref sumber UNIK (tidak berbagi refs/remotes/origin/cand dengan skrip rilis lain)", () => {
  assert.match(src, /CAND_REF="refs\/remotes\/origin\/cand-atrk"/);
  const tanpaKomentarInline = kode.split("\n").map((l) => l.replace(/\s#\s.*$/, "")).join("\n");
  assert.ok(!/refs\/remotes\/origin\/cand(?!-atrk)/.test(tanpaKomentarInline), "tidak boleh memakai ref bersama refs/remotes/origin/cand");
});

test("skrip rilis atribusi: pin sha256 sesuai isi berkas saat ini (basi = tinjau ulang)", () => {
  const pins = [...src.matchAll(/\["(backend\/[^"]+)"\]="([0-9a-f]{64})"/g)];
  assert.equal(pins.length, 6);
  for (const m of pins) {
    const isi = fs.readFileSync(path.join(root, m[1]), "utf8").replace(/\r\n/g, "\n");
    assert.equal(createHash("sha256").update(isi).digest("hex"), m[2], `pin ${m[1]} sudah basi — perbarui pin setelah meninjau perubahan`);
  }
});

test("skrip rilis atribusi: allowlist hanya Fase 1; area lain ditolak", () => {
  const re = new RegExp(/ALLOWED_RE='([^']+)'/.exec(src)[1]);
  for (const ok of [
    "backend/src/index.js", "backend/src/routes/attributionCohort.js", "backend/src/services/attribution/cohort.js", "backend/src/services/attribution/cohortLoader.js",
    "backend/tests/attributionCohort.test.js", "backend/tests/fixtures/attributionAuditShape.js", "backend/tests/integration/attributionCohort.integration.test.js",
    "docs/ATRIBUSI-COHORT-FASE1.md", "scripts/release-atribusi-kohort.sh",
  ]) assert.ok(re.test(ok), `harus diizinkan: ${ok}`);
  for (const no of [
    "backend/prisma/schema.prisma", "backend/prisma/migrations/x/migration.sql", "backend/package.json", "docker-compose.release.yml", "frontend/src/App.jsx",
    "backend/src/routes/analytics.js", "backend/src/routes/webhooks.js", "backend/src/services/ctwaCapture.js", "backend/src/services/attribution/touchContract.js",
    "backend/scripts/cohort-report.js", "backend/src/services/finance/allocation.js", "backend/src/services/paymentLedger.js", ".env", "backend/.env",
  ]) assert.ok(!re.test(no), `harus ditolak: ${no}`);
});

// ── SMOKE JS yang dijalankan skrip rilis di dalam container (docker exec node -) — diuji TANPA DB dan TANPA produksi ─────────
// Server tiruan memakai komposisi laporan ASLI (buildCohort + susunLaporan) dan verifikasi JWT/peran sungguhan; hanya @prisma/client yang di-stub
// (satu-satunya pemakaian: mencari id ADMIN aktif). Membuktikan: skrip JS valid, menghasilkan kunci yang dibaca skrip bash, tidak mencetak token,
// dan mendeteksi respons yang memuat kunci terlarang.
import http from "node:http";
import os from "node:os";
import jwt from "jsonwebtoken";
import { buildCohort } from "../src/services/attribution/cohort.js";
import { susunLaporan } from "../src/services/attribution/cohortReport.js";

const ambilSmoke = () => {
  const m = /read -r -d '' SMOKE_JS <<'JS' \|\| true\n([\s\S]*?)\nJS\n/.exec(src);
  assert.ok(m, "SMOKE_JS tidak ditemukan");
  return m[1];
};
const fixtureKonflik = () => {
  const cust = { id: "c1", createdAt: "2026-09-10T03:00:00Z", pipelineStage: "NEW", leadSource: "META_ADS", isInternalStaff: false, staffUserId: null, transitions: [] };
  const ord = (id, v, st, paid, pa) => ({ id, customerId: "c1", createdAt: "2026-09-19T03:00:00Z", value: v, tagihan: v, status: "PROCESSING", penjualanKaryawanId: null, paymentStatus: st, paidAt: paid, paidAtDikunciOwner: pa });
  return {
    customers: [cust],
    orders: [ord("o1", 4_500_000, "LUNAS", "2026-09-30T02:19:00Z", true), ord("o2", 1_000_000, "LUNAS", "2026-09-25T03:00:00Z", false), ord("o3", 1_000_000, "LUNAS", "2026-09-26T03:00:00Z", false)],
    kontribusi: [{ id: "p1", orderId: "o1", amount: 2_250_000, createdAt: "2026-09-23T17:38:00Z" }, { id: "p2", orderId: "o2", amount: 1_000_000, createdAt: "2026-09-25T03:00:00Z" }],
    refunds: [],
  };
};

async function jalankanSmoke({ tambahKunciTerlarang = false } = {}) {
  const secret = "rahasia-uji-smoke";
  const hasil = buildCohort(fixtureKonflik());
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) { res.statusCode = 401; return res.end("{}"); }
    let p; try { p = jwt.verify(auth.slice(7), secret); } catch { res.statusCode = 401; return res.end("{}"); }
    if (!(p.roles || []).includes("ADMIN")) { res.statusCode = 403; return res.end("{}"); }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(u.searchParams.get("dari") || "")) { res.statusCode = 400; return res.end("{}"); }
    const lap = susunLaporan({ meta: {}, ...hasil }, { dari: "2026-07", sampai: "2026-10", bulanBerjalan: "2026-10" });
    if (tambahKunciTerlarang) lap.perBulanLead["2026-09"].campaignId = "123";
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(lap));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atrk-smoke-"));
  fs.mkdirSync(path.join(tmp, "node_modules/@prisma/client"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "node_modules/@prisma/client/index.js"),
    "exports.PrismaClient = class { constructor(){ this.user = { findFirst: async () => ({ id: 'admin-uji' }) }; } async $disconnect(){} };\n");
  try {
    // spawn ASINKRON: server tiruan hidup di proses ini; spawnSync akan memblokir event loop-nya dan child menunggu selamanya.
    const r = await new Promise((resolve) => {
      const c = spawn(process.execPath, ["-"], {
        cwd: tmp,
        env: { PATH: process.env.PATH, PORT: String(server.address().port), JWT_SECRET: secret, NODE_PATH: path.join(root, "backend/node_modules") },
      });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => c.kill(), 60_000);
      c.stdout.on("data", (d) => (stdout += d)); c.stderr.on("data", (d) => (stderr += d));
      c.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
      c.stdin.end(ambilSmoke());
    });
    const v = Object.fromEntries(r.stdout.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    return { r, v, hasil };
  } finally {
    await new Promise((x) => server.close(x));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test("smoke JS rilis: 401 tanpa token, 403 SALES, 400 parameter salah, 200 ADMIN; rekonsiliasi OK; partisi bukti; SNAP; respons bersih; token tak tercetak", async () => {
  const { r, v, hasil } = await jalankanSmoke();
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-800));
  assert.equal(v.STATUS_NOAUTH, "401"); assert.equal(v.STATUS_SALES, "403"); assert.equal(v.STATUS_PARAM_SALAH, "400"); assert.equal(v.STATUS_ADMIN, "200");
  assert.equal(v.CACHE, "no-store");
  assert.equal(v.REKON_OK, "true"); assert.equal(v.PARTISI_OK, "true");
  assert.equal(v.FORBIDDEN, "none"); assert.equal(v.ROAS_CPA_KATA, "false");
  const t = hasil.total, b = t.buktiPelunasan;
  assert.equal(v.SNAP, [t.leads, t.orders, t.nilaiOrder, t.lunasMenurutCrm.jumlah, t.orderBerLedger, t.lunasTerbuktiLedger.jumlah, b.lunasTanpaLedger, b.konflikLunasTersimpanLedgerTidakCukup, b.kekuranganRupiahKonflik, t.uangLedger].join("|"));
  assert.equal(b.konflikLunasTersimpanLedgerTidakCukup, 1);   // fixture: o1 LUNAS tersimpan, ledger 50%
  assert.equal(v.KONFLIK, "1"); assert.equal(v.KEKURANGAN, "2250000"); assert.equal(v.BELUM_LUNAS_LEDGER_CUKUP, "0");
  assert.equal(v.CRM, "3"); assert.equal(v.TERBUKTI_LEDGER, "1"); assert.equal(v.TANPA_LEDGER, "1");
  assert.ok(!/eyJ/.test(r.stdout + r.stderr), "token JWT tidak boleh tercetak");
});

test("smoke JS rilis: respons yang memuat kunci campaignId terdeteksi (FORBIDDEN), agar bash berhenti", async () => {
  const { r, v } = await jalankanSmoke({ tambahKunciTerlarang: true });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-800));
  assert.equal(v.FORBIDDEN, "campaignId");
});

// ── MODE --rollback dieksekusi NYATA terhadap shim docker/curl/flock (tanpa produksi): gerbang dan urutan perintah ───────────────────────
const posix = (p) => p.split(path.sep).join("/");
function siapkanSandboxRollback({ rilisAktif }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atrk-rb-"));
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
  fs.writeFileSync(state, rilisAktif === "dep" ? `releases/klinik-matras/${DEP.slice(0, 8)}` : "releases/klinik-matras/ffffffff");   // relatif terhadap $HOME (bentuk path msys vs Windows berbeda)
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
    # 'docker compose' dijalankan di dalam 'cd <dir>': direktori kerja = release yang dipakai
    if [[ "$*" == *"up -d --no-deps --force-recreate backend"* ]]; then echo "cwd=$PWD" >> "$LOG"; REL="$PWD"; REL="\${REL#$HOME/}"; echo "$REL" > "$STATE"; fi ;;
esac
exit 0`);
  return { tmp, bin, home, DEP, BASE, log, state, dirBase, dirDep };
}
function jalankanRollback(sb) {
  return spawnSync("bash", [scriptPath, sb.DEP, sb.BASE, "--rollback"], {
    encoding: "utf8", timeout: 60_000,
    env: { PATH: `${sb.bin}${path.delimiter}${process.env.PATH}`, HOME: posix(sb.home) },
  });
}

test("--rollback (shim): rilis aktif = kandidat → menandai ulang image rollback, recreate dari release SEBELUMNYA, env tidak diubah, exit 0", { skip: !punyaBash }, () => {
  const sb = siapkanSandboxRollback({ rilisAktif: "dep" });
  try {
    const r = jalankanRollback(sb);
    assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1500));
    const log = fs.readFileSync(sb.log, "utf8");
    assert.match(log, /docker tag klinik-matras-backend:rollback-pre-atrk-eeeeeeee klinik-matras-backend:latest/);
    assert.match(log, /up -d --no-deps --force-recreate backend/);
    assert.match(log, /cwd=.*releases[\\/]klinik-matras[\\/]bbbbbbbb/, "recreate harus dijalankan dari direktori release SEBELUMNYA");
    assert.ok(!log.includes("build"), "rollback tidak boleh membangun image");
    assert.match(r.stdout, /rollback selesai: release bbbbbbbb/);
    assert.equal(fs.readFileSync(path.join(sb.home, "klinik-matras/backend/.env"), "utf8"), "JWT_SECRET=x\nCTWA_CAPTURE_HASH_SALT=y\n");
  } finally { fs.rmSync(sb.tmp, { recursive: true, force: true }); }
});

test("--rollback (shim): rilis aktif BUKAN kandidat (rilis lain sudah menggantikan) → berhenti, tidak ada tag/recreate", { skip: !punyaBash }, () => {
  const sb = siapkanSandboxRollback({ rilisAktif: "lain" });
  try {
    const r = jalankanRollback(sb);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /BUKAN eeeeeeee; rollback ini tidak berlaku/);
    const log = fs.existsSync(sb.log) ? fs.readFileSync(sb.log, "utf8") : "";
    assert.ok(!/docker tag /.test(log) && !/force-recreate/.test(log), "tidak boleh mengubah apa pun");
  } finally { fs.rmSync(sb.tmp, { recursive: true, force: true }); }
});
