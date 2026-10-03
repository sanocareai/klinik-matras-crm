// P12B — keselamatan STAGING LATIHAN: isolasi jaringan/DB/kredensial (pindai konfigurasi), akun hanya QA-PV2, kredensial sekali-tampil,
// tujuh skenario wajib. Tanpa DB / tanpa jaringan. Cek RUNTIME (docker inspect, egress nyata) ada di scripts/staging/audit-isolation.sh.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { EMAIL_PREFIX, PREFIX } from "../scripts/staging/qaPv2Safety.js";
import { ACCOUNTS, STAGE_ORDER, accountEmail } from "../scripts/staging/qaPv2Seed.js";
import { ISSUED_MARK, SCENARIOS, TRAINING_ROLES, issueCredentials } from "../scripts/staging/qaPv2Training.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const noComments = (s) => s.replace(/^\s*#.*$/gm, "").replace(/\s#\s.*$/gm, "");
const COMPOSE = noComments(read("docker-compose.staging.yml"));
const NGINX = read("deploy", "staging", "nginx.conf");

// Potong blok service tertentu dari compose (indentasi 2 spasi).
const service = (name) => { const m = COMPOSE.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|\\nnetworks:|\\nvolumes:|$)`)); assert.ok(m, `service ${name}`); return m[1]; };

test("compose staging: project terpisah, jaringan internal tanpa rute keluar, hanya edge yang publish port (loopback)", () => {
  assert.match(COMPOSE, /^name: sanss-staging$/m, "project name BEDA dari production (klinik-matras)");
  assert.match(COMPOSE, /staging_internal:\n\s+internal: true/, "jaringan internal: tanpa rute keluar (WhatsApp/email/webhook mustahil)");
  const ports = [...COMPOSE.matchAll(/^\s+ports:\n((?:\s+- .*\n)+)/gm)].map((m) => m[1]);
  assert.equal(ports.length, 1, "hanya SATU service yang publish port");
  assert.ok(/127\.0\.0\.1:/.test(ports[0]) && !/0\.0\.0\.0|"\d+:\d+"/.test(ports[0]), "port hanya di loopback 127.0.0.1 (bukan LAN/internet)");
  assert.match(service("edge-staging"), /ports:/); assert.ok(!/ports:/.test(service("backend-staging")) && !/ports:/.test(service("postgres-staging")), "backend & DB tanpa port ke host");
  assert.ok(!/staging_edge/.test(service("backend-staging")) && !/staging_edge/.test(service("postgres-staging")), "backend/DB tidak di jaringan edge");
});

test("compose staging: tidak menyentuh production (network/volume/DB/docker socket/host network)", () => {
  assert.ok(!/external:\s*true/.test(COMPOSE), "tidak ada network/volume eksternal (tidak bisa bergabung ke network production)");
  assert.ok(!/klinik[-_]matras|klinik_matras|waha|sanohub/i.test(COMPOSE.replace(/qa_pv2|sanss_staging/g, "")), "tidak menyebut resource production");
  assert.ok(!/network_mode|docker\.sock|privileged|pid:\s*host|cap_add/.test(COMPOSE), "tanpa host network / docker.sock / privileged");
  assert.ok(!/\.\.\/|~\/|\/home\/|\/var\/lib\/docker/.test(COMPOSE.replace("./frontend/dist", "").replace("./backend", "").replace("./deploy/staging", "")), "tidak memasang direktori di luar repo");
  const be = service("backend-staging");
  assert.match(be, /DATABASE_URL: postgresql:\/\/qa_pv2:\$\{STAGING_DB_PASSWORD\}@postgres-staging:5432\/sanss_staging/, "DB = postgres-staging sendiri");
  assert.match(be, /APP_ENV: staging/); assert.match(be, /DISABLE_BACKGROUND_JOBS: "1"/);
  assert.ok(!/WAHA|SMTP|SENDGRID|FIREBASE|FCM|OPENAI|ANTHROPIC|GOOGLE_MAPS|WEBHOOK/i.test(be), "tidak ada kredensial/endpoint layanan luar di environment container");
  assert.match(be, /env_file: \.\/backend\/\.env\.staging/, "satu-satunya env_file = .env.staging (bukan .env production)");
  for (const v of ["pgdata_staging", "uploads_staging", "data_staging"]) assert.ok(COMPOSE.includes(v), `volume ${v} terpisah`);
});

test("nginx staging: log akses aktif, noindex, hanya meneruskan ke backend-staging", () => {
  assert.match(NGINX, /^\s*access_log \/var\/log\/nginx\/access\.log;/m, "access log AKTIF");
  assert.match(NGINX, /X-Robots-Tag "noindex, nofollow"/); assert.match(NGINX, /X-Environment "staging/);
  const targets = [...NGINX.matchAll(/proxy_pass\s+([^;]+);/g)].map((m) => m[1]);
  assert.deepEqual(targets, ["http://backend-staging:4000"], "satu-satunya upstream");
});

test("rahasia: .env.staging & kredensial di-gitignore; template env hanya placeholder", () => {
  const ig = read(".gitignore");
  assert.ok(ig.includes("backend/.env.staging") && ig.includes("backend/data/qa-pv2-credentials.json"));
  const ex = read("backend", ".env.staging.example");
  assert.ok(!/(sk-[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{12,}|postgresql:\/\/[^\s]*klinik)/.test(ex), "template tanpa rahasia nyata/URL production");
});

test("akun latihan: hanya akun QA-PV2 @staging.invalid; peran peserta sesuai ACCOUNTS; ada 7 modul peran", () => {
  const byKey = new Map(ACCOUNTS.map((a) => [a.key, a]));
  for (const r of TRAINING_ROLES) {
    const a = byKey.get(r.key); assert.ok(a, `akun ${r.key} ada di ACCOUNTS`);
    assert.ok(accountEmail(r.key).startsWith(EMAIL_PREFIX) && accountEmail(r.key).endsWith("@staging.invalid"));
    assert.ok(a.name.startsWith(PREFIX), "nama akun ber-prefix QA-PV2");
  }
  assert.deepEqual([...new Set(TRAINING_ROLES.map((r) => r.modul))].sort(), ["Admin/Production Lead", "Dokumenter", "Gudang", "Operator Meja", "PIC Corner", "QC"].sort());
  for (const k of ["owner", "admin", "lead", "meja1", "corner1", "qc", "gudang", "dokumentasi"]) assert.ok(TRAINING_ROLES.some((r) => r.key === k), `peran ${k}`);
});

test("tujuh skenario wajib: Normal, Ganti Kain, Prioritas(3 unit), Bahan kurang, QC gagal, Dokumentasi offline, Retur sisa — unit di namespace QA-PV2", () => {
  const ids = SCENARIOS.map((s) => s.id);
  assert.deepEqual(ids, ["S1", "S2", "S3a", "S3b", "S3c", "S4", "S5", "S6", "S7"]);
  assert.equal(new Set(SCENARIOS.map((s) => s.n)).size, SCENARIOS.length, "nomor unit unik");
  assert.ok(SCENARIOS.every((s) => s.n >= 21), "tidak bentrok dengan matriks demo U01–U12");
  for (const s of SCENARIOS) {
    assert.ok(STAGE_ORDER.includes(s.stage), `${s.id}: tahap ${s.stage} valid`);
    assert.ok(s.cust.startsWith("Latihan"), "nama pelanggan dummy"); assert.ok(s.mulai && s.mulai.length > 20, `${s.id}: ada deskripsi titik mulai`);
    if (s.stage !== "perjalanan" && s.stage !== "tiba") assert.ok(["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"].includes(s.station), `${s.id}: butuh meja`);
  }
  const by = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
  assert.equal(by.S1.stage, "perjalanan"); assert.equal(by.S2.svc, "Ganti Kain"); assert.match(by.S2.note, /kain/i);
  assert.deepEqual([by.S3a.prio, by.S3b.prio, by.S3c.prio], [0, 1, 2], "Normal, Tinggi, Mendesak");
  assert.equal(by.S4.stage, "diagnosa"); assert.equal(by.S5.stage, "menunggu_qc"); assert.equal(by.S6.stage, "siap_kirim"); assert.equal(by.S6.docs, "kurang"); assert.equal(by.S7.stage, "menunggu_retur");
  assert.equal(new Set(SCENARIOS.filter((s) => s.station).map((s) => s.station)).size, SCENARIOS.filter((s) => s.station).length, "satu unit per meja (kapasitas 3/meja tidak tercapai)");
});

test("kredensial sekali-tampil: password dirotasi (bcrypt), dikembalikan ke pemanggil, TIDAK ditulis ke berkas/log; ulang = password lama batal", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-pv2-cred-"));
  const file = path.join(dir, "qa-pv2-credentials.json");
  fs.writeFileSync(file, JSON.stringify({ [accountEmail("lead")]: "PASSWORD-LAMA-PLAINTEXT", [accountEmail("qc")]: "QC-LAMA" }), { mode: 0o600 });
  const users = new Map(); let seq = 0;
  for (const r of TRAINING_ROLES) users.set(accountEmail(r.key), { id: `u${++seq}`, passwordHash: "x" });
  const writes = [];
  const prisma = { user: { findUnique: async ({ where }) => users.get(where.email) || null, update: async ({ where, data }) => { writes.push(data); const u = [...users.values()].find((x) => x.id === where.id); Object.assign(u, data); return u; } } };
  const ctx = { prisma, dataDir: dir };
  const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(" "));
  let first; try { first = await issueCredentials(ctx, ["lead", "qc"]); } finally { console.log = orig; }
  assert.equal(lines.length, 0, "library tidak mencetak apa pun");
  assert.equal(first.length, 2); for (const c of first) assert.ok(c.password.length >= 12 && c.email.endsWith("@staging.invalid"));
  const lead = first.find((c) => c.key === "lead");
  assert.ok(await bcrypt.compare(lead.password, users.get(accountEmail("lead")).passwordHash), "hash di DB cocok dengan password yang diterbitkan");
  const saved = fs.readFileSync(file, "utf8");
  assert.ok(!saved.includes(lead.password) && !saved.includes("PASSWORD-LAMA-PLAINTEXT") && !saved.includes("QC-LAMA"), "tidak ada plaintext (baru maupun lama) di berkas");
  assert.equal(JSON.parse(saved)[accountEmail("lead")], ISSUED_MARK, "penanda mencegah ensureMaster merotasi ulang");
  const second = await issueCredentials(ctx, ["lead"]);
  assert.notEqual(second[0].password, lead.password); assert.ok(!(await bcrypt.compare(lead.password, users.get(accountEmail("lead")).passwordHash)), "password lama batal");
  await assert.rejects(() => issueCredentials(ctx, ["tidak-ada"]), /tidak ada peran/);
  assert.ok(!fs.readFileSync(path.join(root, "backend", "scripts", "staging", "qaPv2Training.js"), "utf8").match(/console\.(log|error|warn)|logger/), "modul tidak punya jalur log");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: 'credentials' hanya mencetak ke terminal (tanpa tulis berkas); 'training' lolos pagar assertQaPv2Safe lebih dulu", () => {
  const cli = read("backend", "scripts", "staging", "qa-pv2.js");
  const branch = cli.slice(cli.indexOf('cmd === "credentials"'), cli.indexOf('cmd === "status"'));
  assert.ok(!/writeFileSync|appendFile|createWriteStream/.test(branch), "perintah credentials tidak menulis berkas");
  assert.ok(cli.indexOf("assertQaPv2Safe()") < cli.indexOf("await import(\"../../src/db.js\")"), "pagar keselamatan SEBELUM db diimpor");
  assert.match(cli, /cmd === "training"/); assert.match(cli, /TAMPIL SEKALI/);
});
