// P12A — isolasi staging: gerbang database, egress guard (dibuktikan di proses terpisah), seed/reset menolak production, dan audit statis
// bahwa staging tidak punya jalur outbound (compose, job latar, daftar modul outbound).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { databaseUrlProblem, isAllowedEgressHost, neutralizeExternalEnv, assertStagingDatabaseUrl } from "../src/lib/stagingGuard.js";
import { assertQaPv2Safe, QaPv2SafetyError, BASELINE_TABLES } from "../scripts/staging/qaPv2Safety.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const root = path.resolve(backend, "..");
const read = (p) => fs.readFileSync(p, "utf8");

test("gerbang database: production dan nama tanpa penanda DITOLAK; staging/qa/test diterima; host production terdaftar ditolak", () => {
  const url = (db, host = "postgres-staging") => `postgresql://u:p@${host}:5432/${db}`;
  for (const bad of ["klinik_matras", "postgres", "klinik", "app", "prod_main"]) assert.ok(databaseUrlProblem(url(bad)), bad);
  for (const good of ["sanss_staging", "km_qa_pv2", "klinik_matras_test", "qa-pv2", "staging"]) assert.equal(databaseUrlProblem(url(good)), null, good);
  assert.match(databaseUrlProblem("bukan url"), /tidak valid/); assert.match(databaseUrlProblem("postgresql://u:p@h:5432/"), /tanpa nama/);
  assert.match(databaseUrlProblem(url("sanss_staging", "db.prod.example"), { productionHosts: ["db.prod.example"] }), /host production/);
  assert.throws(() => assertStagingDatabaseUrl(url("klinik_matras")), /STAGING DITOLAK/);
  assert.equal(databaseUrlProblem("postgresql://klinik:x@localhost:5432/klinik_matras?schema=public"), 'database "klinik_matras" adalah database production');
});

test("host egress: loopback/privat/nama satu-label (DNS Docker) boleh; internet publik (nama & IP) diblokir", () => {
  for (const ok of ["localhost", "127.0.0.1", "::1", "10.1.2.3", "172.18.0.5", "192.168.1.9", "postgres-staging", "backend-staging", "fd00::1", "", undefined]) assert.equal(isAllowedEgressHost(ok), true, String(ok));
  for (const bad of ["example.com", "api.openai.com", "8.8.8.8", "1.1.1.1", "172.32.0.1", "waha.sanomatrassehat.com", "smtp.gmail.com", "169.255.1.1", "2001:db8::1"]) assert.equal(isAllowedEgressHost(bad), false, bad);
});

test("netralisasi env: kredensial WhatsApp/email/webhook/push/AI/Maps dibuang; variabel lain utuh", () => {
  const env = { WAHA_BASE_URL: "x", WAHA_API_KEY: "y", AUTOMATION_WEBHOOK_URL: "z", SMTP_HOST: "h", OPENAI_API_KEY: "k", VAPID_PRIVATE_KEY: "v", GOOGLE_MAPS_API_KEY: "g", JWT_SECRET: "s", PORT: "4000" };
  const removed = neutralizeExternalEnv(env);
  assert.deepEqual(env, { JWT_SECRET: "s", PORT: "4000" }); assert.ok(removed.includes("WAHA_BASE_URL") && removed.includes("SMTP_HOST") && removed.includes("OPENAI_API_KEY"));
});

const guardUrl = pathToFileURL(path.join(backend, "src/lib/stagingGuard.js")).href;
const runNode = (script, env = {}) => spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { PATH: process.env.PATH, ...env }, timeout: 30_000 });

test("egress guard (proses terpisah): fetch, http(s).request, dan koneksi TCP ke host publik DIBLOKIR; loopback tetap lewat; non-staging = no-op", () => {
  const script = `
    import { bootstrapStaging } from ${JSON.stringify(guardUrl)};
    import http from "node:http"; import https from "node:https"; import net from "node:net";
    const r = bootstrapStaging({ log: () => {} });
    const out = { staging: r.staging };
    out.fetch = await fetch("https://example.com/").then(() => "LOLOS", (e) => e.code || e.name);
    out.httpsGet = (() => { try { https.get("https://api.openai.com/v1"); return "LOLOS"; } catch (e) { return e.code; } })();
    out.httpReq = (() => { try { http.request({ host: "8.8.8.8", port: 80 }); return "LOLOS"; } catch (e) { return e.code; } })();
    out.tcp = await new Promise((res) => { const s = net.connect({ host: "1.1.1.1", port: 80 }); s.on("error", (e) => res(e.code || e.name)); s.on("connect", () => res("TERHUBUNG")); });
    out.smtp = await new Promise((res) => { const s = net.connect(587, "smtp.gmail.com"); s.on("error", (e) => res(e.code || e.name)); s.on("connect", () => res("TERHUBUNG")); });
    out.loopback = await fetch("http://127.0.0.1:9/").then(() => "OK", (e) => (e.code === "EGRESS_BLOCKED" ? "DIBLOKIR" : "TIDAK-DIBLOKIR(" + (e.cause?.code || e.name) + ")"));
    console.log(JSON.stringify(out));`;
  const staging = runNode(script, { APP_ENV: "staging", DATABASE_URL: "postgresql://u:p@postgres-staging:5432/sanss_staging", WAHA_BASE_URL: "http://waha:3000", AUTOMATION_WEBHOOK_URL: "https://hooks.example.com/x" });
  assert.equal(staging.status, 0, staging.stderr);
  const o = JSON.parse(staging.stdout.trim().split("\n").at(-1));
  assert.deepEqual({ staging: o.staging, fetch: o.fetch, httpsGet: o.httpsGet, httpReq: o.httpReq, tcp: o.tcp, smtp: o.smtp }, { staging: true, fetch: "EGRESS_BLOCKED", httpsGet: "EGRESS_BLOCKED", httpReq: "EGRESS_BLOCKED", tcp: "EGRESS_BLOCKED", smtp: "EGRESS_BLOCKED" });
  assert.match(o.loopback, /^TIDAK-DIBLOKIR/, "loopback tidak diblokir guard (hanya gagal koneksi biasa)");
  // Tanpa APP_ENV (production-like): modul TIDAK memasang guard — diperiksa tanpa membuka koneksi nyata apa pun.
  const prodScript = `
    import { bootstrapStaging } from ${JSON.stringify(guardUrl)};
    import http from "node:http"; import net from "node:net";
    const r = bootstrapStaging({ log: () => {} });
    const native = (f) => Function.prototype.toString.call(f).includes("[native code]");
    console.log(JSON.stringify({ staging: r.staging, fetchNative: fetch.name === "fetch", httpRequestPatched: http.request.name === "guarded", connectPatched: net.Socket.prototype.connect.name === "guardedConnect" }));`;
  const prod = runNode(prodScript, { DATABASE_URL: "postgresql://u:p@db:5432/klinik_matras" });
  assert.equal(prod.status, 0, prod.stderr);
  assert.deepEqual(JSON.parse(prod.stdout.trim().split("\n").at(-1)), { staging: false, fetchNative: true, httpRequestPatched: false, connectPatched: false }, "production TIDAK diubah oleh modul ini");
});

test("bootstrap staging menolak DATABASE_URL production sebelum apa pun jalan; netralkan env; matikan job latar", () => {
  const bad = runNode(`import { bootstrapStaging } from ${JSON.stringify(guardUrl)}; try { bootstrapStaging({ log: () => {} }); console.log("LOLOS"); } catch (e) { console.log(e.message); }`, { APP_ENV: "staging", DATABASE_URL: "postgresql://klinik:x@postgres:5432/klinik_matras" });
  assert.match(bad.stdout, /STAGING DITOLAK.*production/);
  const good = runNode(`import { bootstrapStaging, backgroundJobsEnabled } from ${JSON.stringify(guardUrl)}; const r = bootstrapStaging({ log: () => {} }); console.log(JSON.stringify({ jobs: backgroundJobsEnabled(), waha: process.env.WAHA_BASE_URL ?? null, removed: r.removed }));`, { APP_ENV: "staging", DATABASE_URL: "postgresql://u:p@postgres-staging:5432/sanss_staging", WAHA_BASE_URL: "http://waha:3000" });
  const g = JSON.parse(good.stdout.trim()); assert.equal(g.jobs, false); assert.equal(g.waha, null); assert.ok(g.removed.includes("WAHA_BASE_URL"));
});

test("seed/reset: assertQaPv2Safe menolak production/APP_ENV salah; CLI keluar kode 2 SEBELUM menyentuh database", () => {
  const dbOk = "postgresql://u:p@postgres-staging:5432/sanss_staging";
  assert.deepEqual(assertQaPv2Safe({ env: { APP_ENV: "staging" }, databaseUrl: dbOk }), { appEnv: "staging", database: "sanss_staging" });
  assert.equal(assertQaPv2Safe({ env: { APP_ENV: "test" }, databaseUrl: "postgresql://u:p@localhost:5432/km_it_x_test" }).appEnv, "test");
  for (const [env, url, re] of [
    [{}, dbOk, /APP_ENV/], [{ APP_ENV: "production" }, dbOk, /APP_ENV/], [{ APP_ENV: "staging" }, "postgresql://klinik:x@postgres:5432/klinik_matras", /production/],
    [{ APP_ENV: "staging" }, "postgresql://u:p@h:5432/appdb", /tidak bertanda/], [{ APP_ENV: "staging" }, "", /DATABASE_URL kosong/],
  ]) assert.throws(() => assertQaPv2Safe({ env, databaseUrl: url }), (e) => e instanceof QaPv2SafetyError && re.test(e.message));
  const cli = path.join(backend, "scripts/staging/qa-pv2.js");
  for (const env of [{}, { APP_ENV: "staging", DATABASE_URL: "postgresql://klinik:x@db-unreachable.invalid:5432/klinik_matras" }, { APP_ENV: "production", DATABASE_URL: "postgresql://u:p@h:5432/sanss_staging" }]) {
    for (const cmd of [["seed"], ["reset", "--yes"], ["status"]]) {
      const r = spawnSync(process.execPath, [cli, ...cmd], { encoding: "utf8", env: { PATH: process.env.PATH, ...env }, timeout: 20_000 });
      assert.equal(r.status, 2, `${JSON.stringify(env)} ${cmd}: ${r.stdout}${r.stderr}`); assert.match(r.stderr, /QA-PV2 DITOLAK/);
    }
  }
});

test("BASELINE_TABLES: tabel yang tidak boleh dikosongkan reset (data baseline migration) terdaftar dan tidak memuat tabel transaksi", () => {
  for (const t of ["_prisma_migrations", "routing_stages", "service_catalog", "service_catalog_modules", "warehouses", "storage_locations"]) assert.ok(BASELINE_TABLES.includes(t), t);
  for (const t of ["User", "Order", "units", "production_runs_v2", "production_step_evidence_v2", "stock_movements", "v2_feature_flags"]) assert.equal(BASELINE_TABLES.includes(t), false, t);
});

test("audit statis staging: compose terisolasi (project/DB/volume/jaringan sendiri), jaringan internal tanpa egress, tanpa WAHA, tanpa port DB/backend ke host", () => {
  const y = read(path.join(root, "docker-compose.staging.yml")).split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n"); // tanpa komentar
  assert.match(y, /^name: sanss-staging$/m);
  assert.match(y, /staging_internal:\s*\n\s+internal: true/); assert.doesNotMatch(y, /waha/i, "tidak ada layanan WAHA");
  const backendBlock = y.slice(y.indexOf("  backend-staging:"), y.indexOf("  edge-staging:"));
  assert.match(backendBlock, /networks: \[staging_internal\]/); assert.doesNotMatch(backendBlock, /staging_edge/); assert.doesNotMatch(backendBlock, /ports:/);
  assert.match(backendBlock, /APP_ENV: staging/); assert.match(backendBlock, /DISABLE_BACKGROUND_JOBS: "1"/);
  assert.match(backendBlock, /postgres-staging:5432\/sanss_staging/); assert.match(backendBlock, /env_file: \.\/backend\/\.env\.staging/);
  const pgBlock = y.slice(y.indexOf("  postgres-staging:"), y.indexOf("  backend-staging:"));
  assert.doesNotMatch(pgBlock, /ports:/); assert.match(pgBlock, /POSTGRES_DB: sanss_staging/);
  const edge = y.slice(y.indexOf("  edge-staging:"), y.indexOf("networks:\n  staging_internal"));
  assert.match(edge, /127\.0\.0\.1:\$\{STAGING_PORT:-18080\}:80/);
  // tidak memakai artefak production
  for (const forbidden of ["klinik_matras", "klinik-matras_pgdata", "SANSS_PERSIST_ROOT", "./backend/.env\n", "external: true", "KlinikMatras2026Aman", "klinikmatras-rahasia"]) assert.equal(y.includes(forbidden), false, forbidden);
  assert.match(y, /pgdata_staging:/); assert.match(y, /uploads_staging:/); assert.match(y, /data_staging:/);
  const gi = read(path.join(root, ".gitignore")); assert.match(gi, /^backend\/\.env\.staging$/m);
  const example = read(path.join(backend, ".env.staging.example")).split("\n").filter((l) => l.trim() && !l.startsWith("#")).join("\n"); // hanya isi, tanpa komentar
  assert.doesNotMatch(example, /WAHA|SMTP|API_KEY|WEBHOOK|VAPID|TOKEN/i, "contoh env staging tanpa kredensial eksternal");
  const nginx = read(path.join(root, "deploy/staging/nginx.conf")); assert.match(nginx, /proxy_pass http:\/\/backend-staging:4000/); assert.match(nginx, /X-Environment "staging/);
});

test("audit statis outbound: job latar & worker pengirim hanya jalan lewat backgroundJobsEnabled(); modul pengirim eksternal terdaftar (modul baru wajib ditinjau)", () => {
  const idx = read(path.join(backend, "src/index.js"));
  assert.match(idx, /import \{ bootstrapStaging, backgroundJobsEnabled \} from "\.\/lib\/stagingGuard\.js";\nbootstrapStaging\(\);/);
  assert.ok(idx.indexOf("backgroundJobsEnabled()") < idx.indexOf("startReconciliationJob();"), "gerbang sebelum job pertama");
  const after = idx.slice(idx.indexOf("if (!backgroundJobsEnabled())"));
  for (const job of ["startReconciliationJob", "startSlaAlertJob", "startSalesReminderDigestJob", "startLeaderRecapJob", "startFinanceReminderJob", "mulaiWorkerBroadcast", "startStaffBroadcastWorker"]) assert.ok(after.indexOf(`${job}(`) > 0, job);
  assert.equal((idx.match(/\bstart[A-Za-z]*(Job|Worker)\(\);/g) || []).filter((_, i, a) => i < 0).length, 0);
  // semua file src yang bisa menjangkau jaringan luar — daftar tertutup; menambah modul baru memaksa tinjau jalur egress/staging.
  const OUTBOUND_PATTERN = /\bfetch\(|axios|https?\.request|https?\.get\(|nodemailer|web-push|firebase-admin|googleapis|net\.connect|tls\.connect/;
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".js") && OUTBOUND_PATTERN.test(read(p))) found.push(path.relative(backend, p).replaceAll("\\", "/")); } };
  walk(path.join(backend, "src"));
  const KNOWN = ["src/lib/stagingGuard.js", "src/routes/ai.js", "src/routes/mobileAuth.js", "src/services/automationWebhook.js", "src/services/emailAlert.js", "src/services/expoPush.js", "src/services/fcmTransport.js",
    "src/services/financeNotifications.js", "src/services/handoverDetector.js", "src/services/instagramClient.js", "src/services/maps.js", "src/services/providers/anthropicProvider.js", "src/services/providers/geminiProvider.js",
    "src/services/pushNotifications.js", "src/services/routeTracking.js", "src/services/wahaClient.js"];
  const unknown = found.filter((f) => !KNOWN.includes(f));
  assert.deepEqual(unknown, [], `modul outbound baru perlu ditinjau untuk staging: ${unknown.join(", ")}`);
});

test("audit rilis: export snapshot ikut ditolak di production; compose production tidak memuat/menyalakan staging; tidak ada berkas rahasia staging yang tracked", () => {
  const exp = path.join(backend, "scripts/staging/export-demo-snapshot.js");
  for (const env of [{}, { APP_ENV: "production", DATABASE_URL: "postgresql://klinik:x@postgres:5432/klinik_matras" }, { APP_ENV: "staging", DATABASE_URL: "postgresql://klinik:x@unreachable.invalid:5432/klinik_matras" }]) {
    const r = spawnSync(process.execPath, [exp], { encoding: "utf8", env: { PATH: process.env.PATH, ...env }, timeout: 20_000 });
    assert.equal(r.status, 2, `${JSON.stringify(env)}: ${r.stdout}${r.stderr}`); assert.match(r.stderr, /QA-PV2 DITOLAK/); assert.equal(r.stdout, "", "tidak ada keluaran data");
  }
  for (const f of ["docker-compose.yml", "docker-compose.release.yml"]) { const y = read(path.join(root, f)); assert.doesNotMatch(y, /staging|qa_pv2|QA-PV2/i, f); assert.doesNotMatch(y, /^include:/m, f); }
  const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).stdout.split("\n");
  assert.equal(tracked.some((f) => f === "backend/.env.staging" || /qa-pv2-credentials/.test(f)), false);
  assert.ok(tracked.includes("backend/.env.staging.example"));
  const gi = read(path.join(root, ".gitignore")); assert.match(gi, /^backend\/data\/qa-pv2-credentials\.json$/m);
  const pass = read(path.join(backend, "scripts/staging/qaPv2Seed.js")).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(pass, /console\.log\([^)]*(pw|password)/i, "seeder tidak mencetak password");
});
