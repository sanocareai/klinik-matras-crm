// Smoke rilis Koreksi Penerimaan + Retur Supplier (scripts/release-koreksi-retur.sh, blok node tahap 8b).
// Dijalankan APA ADANYA terhadap server HTTP tiruan + Prisma tiruan (tanpa DB, tanpa production). Yang dibuktikan:
//  - ketiadaan akun WAREHOUSE murni -> pemeriksaan Gudang dilaporkan SKIP dengan alasan (bukan PASS, bukan exit gagal, tidak ada akun/token rekaan);
//  - akun multi-peran (ADMIN+WAREHOUSE) TIDAK dipakai sebagai pengganti Gudang;
//  - bila akun WAREHOUSE murni ada, semua pemeriksaan Gudang dijalankan dan bug izin tetap TERDETEKSI (FAIL);
//  - ketiadaan SALES murni tetap fail-closed;
//  - asersi izin Gudang di tes integrasi masih ada (penjaga agar tidak dihapus diam-diam).
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
const SCRIPT = fs.readFileSync(path.resolve(backendDir, "../scripts/release-koreksi-retur.sh"), "utf8").replace(/\r\n/g, "\n");
const SECRET = "smoke-test-secret";

function smokeBody() {
  const a = SCRIPT.indexOf("<<'NODE'");
  assert.ok(a > 0, "heredoc NODE tidak ditemukan");
  const from = SCRIPT.indexOf("\n", a) + 1;
  const to = SCRIPT.indexOf("\nNODE\n", from);
  assert.ok(to > from, "penutup NODE tidak ditemukan");
  return SCRIPT.slice(from, to);
}

const STUB_PRISMA = `
const __S = JSON.parse(process.env.STUB_USERS);
class PrismaClient {
  user = { findMany: async () => __S.map(({ roles, ...u }) => u) };
  userRole = { findMany: async ({ where }) => (__S.find((u) => u.id === where.userId)?.roles || []).map((role) => ({ role })) };
  async $queryRawUnsafe() { return [{ n: 0 }]; }
  async $disconnect() {}
}`;

function makeServer({ bugWarehouseFinance = false } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const reply = (s, j = {}) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
      let roles = null; let uid = null;
      const h = req.headers.authorization;
      if (h) { try { const p = jwt.verify(h.slice(7), SECRET); roles = p.roles; uid = p.id; } catch { /* anon */ } }
      seen.push({ method: req.method, url: req.url, uid });
      const has = (r) => roles?.includes(r);
      const fin = has("ADMIN") || has("OWNER") || has("FINANCE");
      const gud = has("WAREHOUSE") || fin;
      const nil = req.url.includes("00000000-0000-4000-8000-000000000000");
      if (!roles) return reply(401);
      if (req.method === "GET") {
        if (req.url === "/api/inventory/retur-supplier") return gud ? reply(200, { retur: [] }) : reply(403);
        if (req.url.startsWith("/api/inventory/retur-supplier/")) return gud ? reply(404) : reply(403);
        if (req.url === "/api/finance/retur-supplier") return fin || (bugWarehouseFinance && has("WAREHOUSE")) ? reply(200, { retur: [] }) : reply(403);
        if (req.url.endsWith("/debit-note/daftar")) return fin ? reply(200, { debitNote: [] }) : reply(403);
        if (req.url.endsWith("/kredit/daftar")) return fin ? reply(200, { kredit: [] }) : reply(403);
        if (req.url.endsWith("/pratinjau") && nil) return fin ? reply(404) : reply(403);
        if (req.url === "/api/inventory/barang-akan-datang") return gud ? reply(200, { purchaseOrders: [] }) : reply(403);
        return reply(404);
      }
      let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { /* kosong */ }
      const butuhFinance = req.url.startsWith("/api/finance/");
      const boleh = butuhFinance ? fin : gud;
      if (!boleh) return reply(403);
      if (body.pratinjau) return reply(200, { pratinjau: true, boleh: false });
      if (!req.headers["idempotency-key"]) return reply(428);
      return reply(400);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

async function runSmoke({ users, bugWarehouseFinance = false }) {
  const { server, seen, base } = await makeServer({ bugWarehouseFinance });
  const code = smokeBody().replace("http://127.0.0.1:4000", base).replace('const { PrismaClient } = require("@prisma/client");', STUB_PRISMA);
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
  // Hasil ditentukan dari baris SMOKE_HASIL yang dicetak skrip. Kode keluar proses tidak dipakai karena di Windows `process.exit` dengan koneksi fetch terbuka memicu
  // assertion libuv (UV_HANDLE_CLOSING) — artefak platform uji, tidak terjadi di container Linux production. Bila SMOKE_HASIL tidak ada (keluar dini), kode keluar dipakai.
  const m = /SMOKE_HASIL fail=(\d+) skip=(\d+)/.exec(out.stdout);
  const exit = m ? (Number(m[1]) === 0 ? 0 : 1) : out.rc;
  return { ...out, seen, exit };
}

const U = (id, role, roles = [role]) => ({ id, name: id, role, roles, active: true });
const ADMIN = U("u-admin", "ADMIN");
const SALES = U("u-sales", "SALES");
const GUDANG_MURNI = U("u-gudang", "WAREHOUSE");
const MULTI = U("u-multi", "ADMIN", ["ADMIN", "PRODUCTION_WORKER", "WAREHOUSE"]); // meniru akun production: ADMIN + WAREHOUSE

test("TANPA akun WAREHOUSE murni: pemeriksaan Gudang = SKIP berbukti; rilis tidak gagal; tidak ada PASS atas izin Gudang; akun multi-peran tidak dipakai sebagai Gudang", async () => {
  const r = await runSmoke({ users: [MULTI, SALES] }); // satu-satunya pemilik WAREHOUSE juga ADMIN (keadaan production)
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /INFO\s+izin Gudang tidak dapat diverifikasi di production: tidak ada akun WAREHOUSE murni/);
  const skips = r.stdout.split("\n").filter((l) => /^\s*SKIP\s/.test(l));
  assert.ok(skips.length >= 8, `SKIP kurang: ${skips.length}\n${r.stdout}`);
  for (const l of skips) assert.match(l, /DILEWATI: tidak ada akun WAREHOUSE murni/, "tiap SKIP wajib berisi alasan");
  assert.match(r.stdout, /SMOKE_HASIL fail=0 skip=\d+/);
  // tidak ada baris PASS yang mengklaim izin/tampilan Gudang
  // (SALES/anonim ditolak di endpoint Gudang adalah pemeriksaan SAH tanpa akun Gudang; yang dilarang PASS = klaim perilaku AKTOR Gudang)
  const passGudang = r.stdout.split("\n").filter((l) => /^\s*PASS\s/.test(l) && /(WAREHOUSE|tampilan Gudang|pratinjau koreksi \(Gudang\)|detail retur \(Gudang\))/.test(l));
  assert.deepEqual(passGudang, [], "izin Gudang tidak boleh PASS tanpa akun Gudang murni");
  // pengganti admin untuk struktur progres harus diberi label jujur
  assert.match(r.stdout, /Barang Akan Datang -> 200 \(aktor: admin \(pengganti: BUKAN pemeriksaan izin Gudang\)\)/);
  // jumlah penulisan: 11 (4 oleh aktor Gudang tidak dilakukan), semuanya ditolak sebelum menyentuh data
  assert.match(r.stdout, /PASS\s+semua 11 pemanggilan tulis ditolak/);
  // tidak ada permintaan dengan token akun multi-peran yang diperlakukan sebagai Gudang: token Gudang tidak pernah dibuat
  const warehouseOnly = r.seen.filter((s) => s.uid === "u-gudang");
  assert.equal(warehouseOnly.length, 0);
});

test("DENGAN akun WAREHOUSE murni: semua pemeriksaan Gudang dijalankan (0 SKIP) dan 15 penulisan ditolak", async () => {
  const r = await runSmoke({ users: [ADMIN, SALES, GUDANG_MURNI] });
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SMOKE_HASIL fail=0 skip=0/);
  assert.doesNotMatch(r.stdout, /^\s*SKIP\s/m);
  for (const frag of ["Retur Supplier (Gudang): WAREHOUSE -> 200", "tampilan Gudang TIDAK memuat nilai", "Retur Supplier (Finance): WAREHOUSE murni -> 403", "Debit Note: WAREHOUSE murni -> 403", "Saldo kredit: WAREHOUSE murni -> 403", "pratinjau koreksi (Gudang)"]) {
    assert.match(r.stdout, new RegExp(`PASS\\s+${frag.replace(/[()]/g, "\\$&")}`), frag);
  }
  assert.match(r.stdout, /PASS\s+semua 15 pemanggilan tulis ditolak/);
  assert.ok(r.seen.some((s) => s.uid === "u-gudang"), "akun Gudang murni harus benar-benar dipakai");
});

test("DENGAN akun WAREHOUSE murni dan bug izin (Gudang bisa membaca Finance): smoke GAGAL — asersi izin Gudang nyata, bukan formalitas", async () => {
  const r = await runSmoke({ users: [ADMIN, SALES, GUDANG_MURNI], bugWarehouseFinance: true });
  assert.equal(r.exit, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+Retur Supplier \(Finance\): WAREHOUSE murni -> 403/);
});

test("SALES murni tidak ada: tetap fail-closed (bukan SKIP)", async () => {
  const r = await runSmoke({ users: [ADMIN, GUDANG_MURNI] });
  assert.equal(r.exit, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+akun ADMIN dan SALES murni/);
});

test("skrip bash: lulus-dengan-SKIP dilaporkan sebagai PERHATIAN (bukan ok/PASS) dan ringkasan wajib ada", () => {
  assert.match(SCRIPT, /\| tee "\$BK_DIR\/smoke\.log" \|\| die "smoke test GAGAL"/);
  assert.match(SCRIPT, /\[ -n "\$SMOKE_SKIP" \] \|\| die "smoke test tidak mencetak ringkasan SMOKE_HASIL/);
  assert.match(SCRIPT, /warn "smoke test lulus dengan \$\{SMOKE_SKIP\} pemeriksaan DILEWATI \(SKIP\): izin Gudang TIDAK terverifikasi di production/);
  // tidak ada pembuatan akun/token pengganti di blok smoke
  const body = smokeBody();
  assert.doesNotMatch(body, /\.(create|createMany|upsert|update|delete)\(/, "smoke tidak boleh menulis lewat Prisma");
  assert.doesNotMatch(body, /tG\s*=\s*[^;\n]*\btA\b/, "token Gudang tidak boleh diganti token admin");
});

test("tes INTEGRASI tetap memuat asersi izin Gudang (penjaga: tidak boleh dihapus diam-diam)", () => {
  const read = (f) => fs.readFileSync(path.join(here, "integration", f), "utf8");
  const rs = read("returSupplier.integration.test.js");
  const g403 = rs.match(/w\.g\.(get|post)\([^\n]*\)\)\.status, 403/g) || [];
  assert.ok(g403.length >= 3, `asersi Gudang->403 di returSupplier.integration: ${g403.length}`);
  assert.match(rs, /Gudang tidak punya finance:read/);
  assert.match(rs, /w\.g\.post\("\/api\/inventory\/retur-supplier"[^\n]*\)\)\.status, 428/);
  assert.match(read("returSupplierFinal.integration.test.js"), /w\.g\.post\([^\n]*kredit-pemakaian[^\n]*\)\)\.status, 403, "Gudang tidak boleh"/);
  assert.match(read("koreksiPenerimaan.integration.test.js"), /w\.g\.post\(path, body\)\)\.status, 428/);
});
