// Smoke rilis tahap 8b pada skrip rilis yang SEBELUMNYA salah menangani ketiadaan akun peran-murni (lihat releaseKoreksiReturSmoke.test.js untuk skrip Koreksi+Retur):
//   scripts/release-retur-supplier.sh, release-po-terintegrasi.sh, release-po-sku-baru.sh, release-penjualan-karyawan-order-crm.sh.
// Blok node smoke dijalankan APA ADANYA terhadap server HTTP tiruan + Prisma tiruan (tanpa DB, tanpa production). Yang dibuktikan, per skrip:
//  - tanpa akun peran-murni (WAREHOUSE / PRODUCTION_LEAD / FINANCE biasa): pemeriksaan peran itu dilaporkan SKIP + alasan — bukan PASS, bukan exit gagal, bukan dilewati diam-diam,
//    tidak ada akun/token rekaan, dan akun multi-peran (ADMIN+WAREHOUSE) TIDAK dipakai sebagai pengganti;
//  - dengan akun peran-murni: semua pemeriksaan dijalankan (0 SKIP) dan bug izin tetap TERDETEKSI (FAIL);
//  - ketiadaan ADMIN/SALES tetap fail-closed;
//  - bash: lulus-tanpa-SKIP = ok, lulus-dengan-SKIP = warn (bukan klaim "lulus penuh"), warn() terdefinisi, smoke.log + SMOKE_HASIL diwajibkan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "..");
const SECRET = "smoke-test-secret";
const NOL = "00000000-0000-4000-8000-000000000000";
const scriptText = (nama) => fs.readFileSync(path.resolve(backendDir, `../scripts/${nama}`), "utf8").replace(/\r\n/g, "\n");

function smokeBody(script) {
  const a = script.indexOf("<<'NODE'");
  assert.ok(a > 0, "heredoc NODE tidak ditemukan");
  const from = script.indexOf("\n", a) + 1;
  const to = script.indexOf("\nNODE\n", from);
  assert.ok(to > from, "penutup NODE tidak ditemukan");
  return script.slice(from, to);
}

// Prisma tiruan: pengguna/peran dari STUB_USERS; model lain: count=0, findFirst=null, findMany=[]; $queryRawUnsafe -> n=0 (invarian basis data kosong).
const STUB_PRISMA = `
const __S = JSON.parse(process.env.STUB_USERS);
const __model = new Proxy({}, { get: (_, k) => k === "count" ? async () => 0 : k === "findFirst" ? async () => null : async () => [] });
class PrismaClient {
  constructor() {
    const self = this;
    return new Proxy(this, { get: (t, k) => (k in t ? t[k] : __model) });
  }
  user = {
    findMany: async () => __S.map(({ roles, ...u }) => u),
    findFirst: async ({ where }) => { const u = __S.find((x) => x.role === where.role && x.active); return u ? (({ roles, ...r }) => r)(u) : null; },
  };
  userRole = { findMany: async ({ where }) => (__S.find((u) => u.id === where.userId)?.roles || []).map((role) => ({ role })) };
  async $queryRawUnsafe() { return [{ n: 0 }]; }
  async $disconnect() {}
}`;

function identitas(req) {
  const h = req.headers.authorization;
  if (!h) return { roles: null, uid: null };
  try { const p = jwt.verify(h.slice(7), SECRET); return { roles: p.roles, uid: p.id }; } catch { return { roles: null, uid: null }; }
}

// Server tiruan per skrip. `bug` memicu satu kelalaian izin yang HARUS ditangkap smoke.
const SERVERS = {
  "release-retur-supplier.sh": (bug) => (req, reply, { has, fin, gud, nil }) => {
    if (req.method === "GET") {
      if (req.url === "/api/inventory/retur-supplier") return gud ? reply(200, { retur: [] }) : reply(403);
      if (req.url.startsWith("/api/inventory/retur-supplier/")) return gud ? reply(404) : reply(403);
      if (req.url === "/api/finance/retur-supplier") return fin || (bug && has("WAREHOUSE")) ? reply(200, { retur: [] }) : reply(403);
      if (req.url.endsWith("/debit-note/daftar")) return fin ? reply(200, { debitNote: [] }) : reply(403);
      if (req.url.endsWith("/kredit/daftar")) return fin ? reply(200, { kredit: [] }) : reply(403);
      if (req.url.endsWith("/pratinjau") && nil) return fin ? reply(404) : reply(403);
      if (req.url === "/api/inventory/barang-akan-datang") return gud ? reply(200, { purchaseOrders: [] }) : reply(403);
      return reply(404);
    }
    return null;
  },
  "release-po-terintegrasi.sh": (bug) => (req, reply, { fin, gud }) => {
    if (req.method === "GET") {
      if (req.url === "/api/inventory/barang-akan-datang") return gud ? reply(200, { purchaseOrders: [], hitungan: {}, ...(bug ? { hargaSatuan: 1 } : {}) }) : reply(403);
      if (req.url.startsWith("/api/inventory/barang-akan-datang/")) return gud ? reply(404) : reply(403);
      if (req.url === "/api/finance/purchase-orders/kedatangan") return fin ? reply(200, { purchaseOrders: [] }) : reply(403);
      if (req.url === "/api/finance/utang/aging") return fin ? reply(200, { ringkasan: { kartu: { totalUtangAktif: 0 } }, baris: [] }) : reply(403);
      if (req.url === "/api/finance/reports/payables") return fin ? reply(200, { total: 0 }) : reply(403);
      return reply(404);
    }
    return null;
  },
  "release-po-sku-baru.sh": (bug) => (req, reply, { has, fin, nil }, body) => {
    const finRead = fin || has("FINANCE");
    const adminOnly = has("ADMIN") || has("OWNER");
    if (req.method === "POST" && req.url === "/api/finance/purchase-orders/sku/cek-duplikat") {
      const boleh = adminOnly || (bug && has("WAREHOUSE"));
      if (!boleh) return reply(403);
      if (body?.materialBaru?.jenis === "JASA") return reply(400, { error: "Jasa/non-stok: gunakan Pengeluaran, Pengajuan Biaya, atau Tagihan Supplier" });
      return reply(200, { bolehLanjut: true, pasti: [], prefixKode: "ZZ" });
    }
    if (req.method === "GET" && req.url === "/api/finance/purchase-orders/katalog-supplier") return finRead ? reply(200, { katalog: [] }) : reply(403);
    if (req.method === "GET" && req.url.startsWith("/api/finance/purchase-orders/sku/")) return adminOnly && nil ? reply(404) : reply(403);
    if (req.method === "PATCH" && req.url.startsWith("/api/finance/purchase-orders/sku/")) return adminOnly ? reply(400) : reply(403);
    if (req.method === "GET" && req.url.startsWith("/api/inventory/materials")) return adminOnly ? reply(200, []) : reply(403);
    if (req.method === "GET" && req.url === "/api/inventory/stock") return adminOnly ? reply(200, [{ kind: null, createdVia: null }]) : reply(403);
    return null;
  },
  "release-penjualan-karyawan-order-crm.sh": (bug) => (req, reply, { has, fin }) => {
    const U = "/api/finance/penjualan-karyawan";
    const adminOnly = has("ADMIN") || has("OWNER");
    if (req.url.startsWith(U)) {
      if (req.url.endsWith("/order-crm/dry-run")) return adminOnly || (bug && has("PRODUCTION_LEAD")) ? reply(200, { jumlah: 0 }) : reply(403);
      if (req.url.endsWith("/order-crm")) return adminOnly ? reply(404) : reply(403);
      if (req.url === U) return adminOnly ? reply(200, { penjualan: [] }) : reply(403);
    }
    if (req.url.startsWith("/api/production-v2/backlog")) return has("PRODUCTION_LEAD") || fin ? reply(200, { items: [] }) : reply(403);
    if (req.url.startsWith("/api/production/work-orders")) return has("PRODUCTION_LEAD") || fin ? reply(200, { units: [] }) : reply(403);
    if (req.url.startsWith("/api/orders")) return adminOnly ? reply(200, { items: [] }) : reply(403);
    return null;
  },
};

function makeServer(skrip, bug) {
  const seen = [];
  const rutekan = SERVERS[skrip](bug);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const reply = (s, j = {}) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
      const { roles, uid } = identitas(req);
      seen.push({ method: req.method, url: req.url, uid });
      const has = (r) => !!roles?.includes(r);
      const fin = has("ADMIN") || has("OWNER") || has("FINANCE");
      const gud = has("WAREHOUSE") || fin;
      const nil = req.url.includes(NOL);
      if (!roles) return reply(401);
      let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { /* kosong */ }
      rutekan(req, reply, { has, fin, gud, nil }, body);
      if (res.headersSent) return;
      if (req.method === "GET") return reply(404);
      // penulisan generik: izin dulu, lalu Idempotency-Key, lalu validasi — tidak pernah 2xx
      const butuhFinance = req.url.startsWith("/api/finance/");
      if (!(butuhFinance ? fin : gud)) return reply(403);
      if (!req.headers["idempotency-key"]) return reply(428);
      return reply(400);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

async function runSmoke(skrip, { users, bug = false }) {
  const { server, seen, base } = await makeServer(skrip, bug);
  const code = smokeBody(scriptText(skrip)).replace("http://127.0.0.1:4000", base).replace('const { PrismaClient } = require("@prisma/client");', STUB_PRISMA);
  assert.ok(code.includes(base) && code.includes("class PrismaClient"), "penggantian BASE/Prisma tidak terjadi");
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-"], { cwd: backendDir, env: { ...process.env, JWT_SECRET: SECRET, STUB_USERS: JSON.stringify(users), LEGACY_PO_FINAL: "" } });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (rc) => resolve({ rc, stdout, stderr }));
    child.stdin.end(code);
  });
  server.close();
  // Hasil dari baris SMOKE_HASIL (di Windows `process.exit` dengan koneksi fetch terbuka memicu assertion libuv — artefak platform uji, bukan production Linux).
  const m = /SMOKE_HASIL fail=(\d+) skip=(\d+)/.exec(out.stdout);
  const exit = m ? (Number(m[1]) === 0 ? 0 : 1) : out.rc;
  return { ...out, seen, exit, skip: m ? Number(m[2]) : null };
}

const U = (id, role, roles = [role]) => ({ id, name: id, role, roles, active: true });
const ADMIN = U("u-admin", "ADMIN");
const SALES = U("u-sales", "SALES");
const GUDANG = U("u-gudang", "WAREHOUSE");
const PRODLEAD = U("u-prod", "PRODUCTION_LEAD");
const FINANCE = U("u-fin", "FINANCE");
const MULTI = U("u-multi", "WAREHOUSE", ["WAREHOUSE", "ADMIN"]); // meniru akun production: satu-satunya pemilik WAREHOUSE juga ADMIN
const MULTI_PROD = U("u-multi-prod", "PRODUCTION_LEAD", ["PRODUCTION_LEAD", "ACCOUNTANT"]);

const SKIP_RE = /^\s*SKIP\s/;
const skipLines = (out) => out.split("\n").filter((l) => SKIP_RE.test(l));
const passLines = (out, re) => out.split("\n").filter((l) => /^\s*PASS\s/.test(l) && re.test(l));

// ───────────────────────── release-retur-supplier.sh ─────────────────────────
const RS = "release-retur-supplier.sh";
test(`${RS}: TANPA WAREHOUSE murni -> SKIP berbukti, tidak exit gagal, tidak ada PASS izin Gudang, akun multi-peran tidak dipakai`, async () => {
  const r = await runSmoke(RS, { users: [ADMIN, MULTI, SALES] });
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /INFO\s+izin Gudang tidak dapat diverifikasi di production: tidak ada akun WAREHOUSE murni/);
  const skips = skipLines(r.stdout);
  assert.ok(skips.length >= 8, `SKIP kurang: ${skips.length}\n${r.stdout}`);
  for (const l of skips) assert.match(l, /DILEWATI: tidak ada akun WAREHOUSE murni/);
  assert.deepEqual(passLines(r.stdout, /(WAREHOUSE|tampilan Gudang|detail retur \(Gudang\))/), [], "izin Gudang tidak boleh PASS tanpa akun Gudang murni");
  assert.match(r.stdout, /Barang Akan Datang -> 200 \(aktor: admin \(pengganti: BUKAN pemeriksaan izin Gudang\)\)/);
  assert.match(r.stdout, /PASS\s+semua 6 pemanggilan tulis ditolak/);
  assert.equal(r.seen.filter((s) => s.uid === "u-multi").length, 0, "akun multi-peran tidak boleh dipakai sebagai Gudang");
});
test(`${RS}: DENGAN WAREHOUSE murni -> 0 SKIP, 9 penulisan ditolak`, async () => {
  const r = await runSmoke(RS, { users: [ADMIN, SALES, GUDANG] });
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.equal(r.skip, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /^\s*SKIP\s/m);
  assert.match(r.stdout, /PASS\s+Retur Supplier \(Gudang\): WAREHOUSE -> 200/);
  assert.match(r.stdout, /PASS\s+Debit Note: WAREHOUSE murni -> 403/);
  assert.match(r.stdout, /PASS\s+semua 9 pemanggilan tulis ditolak/);
  assert.ok(r.seen.some((s) => s.uid === "u-gudang"));
});
test(`${RS}: bug izin (Gudang boleh membaca Finance) -> FAIL`, async () => {
  const r = await runSmoke(RS, { users: [ADMIN, SALES, GUDANG], bug: true });
  assert.equal(r.exit, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+Retur Supplier \(Finance\): WAREHOUSE murni -> 403/);
});
test(`${RS}: tanpa SALES murni tetap fail-closed`, async () => {
  const r = await runSmoke(RS, { users: [ADMIN, GUDANG] });
  assert.equal(r.exit, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+akun ADMIN dan SALES murni/);
});

// ───────────────────────── release-po-terintegrasi.sh ─────────────────────────
const PT = "release-po-terintegrasi.sh";
test(`${PT}: TANPA WAREHOUSE murni -> SKIP berbukti; akun multi-peran (ADMIN+WAREHOUSE) TIDAK lagi dipakai sebagai Gudang`, async () => {
  const r = await runSmoke(PT, { users: [ADMIN, MULTI, SALES] });
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  const skips = skipLines(r.stdout);
  assert.equal(skips.length, 2, r.stdout);
  for (const l of skips) assert.match(l, /DILEWATI: tidak ada akun WAREHOUSE murni/);
  assert.deepEqual(passLines(r.stdout, /(tampilan Gudang|\(Gudang\) -> 404)/), []);
  assert.match(r.stdout, /Barang Akan Datang -> 200 berisi daftar PO \(aktor: admin \(pengganti: BUKAN pemeriksaan izin Gudang\)\)/);
  assert.match(r.stdout, /PASS\s+semua 8 pemanggilan tulis ditolak/);
  assert.equal(r.seen.filter((s) => s.uid === "u-multi").length, 0, "akun multi-peran tidak boleh dipakai sebagai Gudang (PASS palsu)");
});
test(`${PT}: DENGAN WAREHOUSE murni -> 0 SKIP`, async () => {
  const r = await runSmoke(PT, { users: [ADMIN, SALES, GUDANG] });
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.equal(r.skip, 0, r.stdout);
  assert.match(r.stdout, /PASS\s+tampilan Gudang TIDAK memuat harga/);
  assert.match(r.stdout, /PASS\s+detail PO id tak dikenal \(Gudang\) -> 404/);
  assert.ok(r.seen.some((s) => s.uid === "u-gudang"));
});
test(`${PT}: bug (Gudang melihat harga) -> FAIL`, async () => {
  const r = await runSmoke(PT, { users: [ADMIN, SALES, GUDANG], bug: true });
  assert.equal(r.exit, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+tampilan Gudang TIDAK memuat harga/);
});
test(`${PT}: tanpa SALES murni tetap fail-closed`, async () => {
  const r = await runSmoke(PT, { users: [ADMIN, GUDANG] });
  assert.equal(r.exit, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+akun ADMIN dan SALES murni/);
});

// ───────────────────────── release-po-sku-baru.sh ─────────────────────────
const SK = "release-po-sku-baru.sh";
test(`${SK}: TANPA PRODUCTION_LEAD/WAREHOUSE/FINANCE murni -> 7 SKIP berbukti (tidak lagi dilewati diam-diam)`, async () => {
  const r = await runSmoke(SK, { users: [ADMIN, MULTI, MULTI_PROD, SALES] });
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.equal(r.skip, 7, r.stdout);
  const skips = skipLines(r.stdout);
  assert.equal(skips.filter((l) => /PRODUCTION_LEAD/.test(l)).length, 2);
  assert.equal(skips.filter((l) => /WAREHOUSE/.test(l)).length, 2);
  assert.equal(skips.filter((l) => /FINANCE biasa/.test(l)).length, 3);
  for (const l of skips) assert.match(l, /DILEWATI: tidak ada akun .* (murni|biasa)/);
  assert.deepEqual(passLines(r.stdout, /(PRODUCTION_LEAD|WAREHOUSE|FINANCE biasa)/), []);
  assert.equal(r.seen.filter((s) => s.uid === "u-multi" || s.uid === "u-multi-prod").length, 0, "akun multi-peran tidak boleh dipakai");
});
test(`${SK}: DENGAN semua akun peran-murni -> 0 SKIP`, async () => {
  const r = await runSmoke(SK, { users: [ADMIN, SALES, PRODLEAD, GUDANG, FINANCE] });
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.equal(r.skip, 0, r.stdout);
  for (const frag of ["cek-duplikat SKU: PRODUCTION_LEAD -> 403", "cek-duplikat SKU: WAREHOUSE -> 403", "katalog supplier: WAREHOUSE -> 403", "katalog supplier: FINANCE biasa -> 200"]) {
    assert.match(r.stdout, new RegExp(`PASS\\s+${frag.replace(/[()]/g, "\\$&")}`), frag);
  }
});
test(`${SK}: bug izin (Gudang boleh cek-duplikat) -> FAIL`, async () => {
  const r = await runSmoke(SK, { users: [ADMIN, SALES, PRODLEAD, GUDANG, FINANCE], bug: true });
  assert.equal(r.exit, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+cek-duplikat SKU: WAREHOUSE -> 403/);
});
test(`${SK}: tanpa SALES murni tetap fail-closed`, async () => {
  const r = await runSmoke(SK, { users: [ADMIN, PRODLEAD] });
  assert.equal(r.exit, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+akun ADMIN & SALES murni/);
});

// ───────────────────────── release-penjualan-karyawan-order-crm.sh ─────────────────────────
const PK = "release-penjualan-karyawan-order-crm.sh";
test(`${PK}: TANPA PRODUCTION_LEAD murni -> 5 SKIP berbukti`, async () => {
  const r = await runSmoke(PK, { users: [ADMIN, MULTI_PROD, SALES] });
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.equal(r.skip, 5, r.stdout);
  for (const l of skipLines(r.stdout)) assert.match(l, /DILEWATI: tidak ada akun PRODUCTION_LEAD murni/);
  assert.deepEqual(passLines(r.stdout, /(PRODUCTION_LEAD|backlog Rencana Produksi|daftar Work Order)/), []);
  assert.equal(r.seen.filter((s) => s.uid === "u-multi-prod").length, 0);
});
test(`${PK}: DENGAN PRODUCTION_LEAD murni -> 0 SKIP; bug izin -> FAIL`, async () => {
  const ok = await runSmoke(PK, { users: [ADMIN, SALES, PRODLEAD] });
  assert.equal(ok.exit, 0, ok.stdout + ok.stderr);
  assert.equal(ok.skip, 0, ok.stdout);
  assert.match(ok.stdout, /PASS\s+backlog Rencana Produksi -> 200/);
  const bug = await runSmoke(PK, { users: [ADMIN, SALES, PRODLEAD], bug: true });
  assert.equal(bug.exit, 1, bug.stdout);
  assert.match(bug.stdout, /FAIL\s+dry-run order CRM: PRODUCTION_LEAD -> 403/);
});

// ───────────────────────── penjaga bash (statis) ─────────────────────────
for (const nama of [RS, PT, SK, PK, "release-koreksi-retur.sh"]) {
  test(`${nama}: bash membedakan lulus penuh (ok) dari lulus-dengan-SKIP (warn); warn() terdefinisi; smoke.log + SMOKE_HASIL diwajibkan`, () => {
    const s = scriptText(nama);
    assert.match(s, /^warn\(\) \{ printf /m, "warn() harus terdefinisi (jalur lulus-dengan-SKIP tidak boleh exit 127)");
    assert.match(s, /<<'NODE' \| tee "\$BK_DIR\/smoke\.log" \|\| die "smoke test GAGAL"/);
    assert.match(s, /console\.log\(`SMOKE_HASIL fail=\$\{fail\} skip=\$\{dilewati\}`\);/);
    assert.match(s, /\[ -n "\$SMOKE_SKIP" \] \|\| die "smoke test tidak mencetak ringkasan SMOKE_HASIL/);
    assert.match(s, /if \[ "\$SMOKE_SKIP" = "0" \]; then\n\s+ok "smoke test lulus/);
    assert.match(s, /else\n\s+warn "smoke test lulus dengan \$\{SMOKE_SKIP\} pemeriksaan DILEWATI \(SKIP\)[^\n]*BUKAN PASS\."\nfi/);
    // tidak ada lagi klaim 'smoke test lulus' tanpa syarat SKIP=0
    const klaim = s.split("\n").filter((l) => /^ok "smoke test lulus/.test(l));
    assert.deepEqual(klaim, [], "klaim 'smoke test lulus' tanpa syarat SKIP=0 tidak boleh ada di kolom pertama");
  });
  test(`${nama}: blok smoke tidak memilih akun WAREHOUSE/PRODUCTION_LEAD/SALES tanpa mengecualikan peran Finance, dan tidak ada exit(1) karena akun peran-murni absen`, () => {
    const body = smokeBody(scriptText(nama));
    for (const m of body.matchAll(/userDengan\("(WAREHOUSE|PRODUCTION_LEAD|SALES)", ([^)]*\)?)\)/g)) {
      assert.equal(m[2].trim(), "FIN", `${m[1]} harus dipilih dengan FIN (tanpa peran Finance); ditemukan: ${m[0]}`);
    }
    for (const l of body.split("\n").filter((x) => /process\.exit\(1\)/.test(x))) {
      assert.doesNotMatch(l, /gudang|WAREHOUSE|prod\b|PRODUCTION_LEAD/, `exit(1) karena peran-murni absen tidak boleh: ${l.slice(0, 120)}`);
    }
  });
}
