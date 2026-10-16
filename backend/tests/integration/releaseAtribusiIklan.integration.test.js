// SMOKE_JS dari scripts/release-atribusi-iklan.sh dijalankan NYATA (proses terpisah, `node -` seperti `docker exec -i ... node -`) terhadap router ASLI + PostgreSQL
// sekali-pakai. Membuktikan: kunci keluaran yang dibaca skrip bash ada dan benar, RBAC/rentang wajib/sinyal ditolak, rekonsiliasi OK, CPA/ROAS null,
// respons bersih dari pengenal pribadi (walau data berisi nama/telepon), flag capture terbaca di /kesehatan, dan smoke tidak menulis apa pun.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.JWT_SECRET ||= "rahasia-uji-smoke-rilis";
delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED;
await import("./setup/env.js");
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { testPrisma, truncateAll } = await import("./setup/testDb.js");
const { startTestServer } = await import("./setup/testApp.js");
const { attributionAdsRouter } = await import("../../src/routes/attributionAds.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const skrip = fs.readFileSync(path.join(backendRoot, "../scripts/release-atribusi-iklan.sh"), "utf8").replace(/\r\n/g, "\n");
const SMOKE_JS = /read -r -d '' SMOKE_JS <<'JS' \|\| true\n([\s\S]*?)\nJS\n/.exec(skrip)[1];

let server;
test.before(async () => {
  await truncateAll();
  await testPrisma.metaAdReference.deleteMany({});
  await testPrisma.user.create({ data: { name: "Admin Smoke", email: `smoke-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN", active: true } });
  const app = express();
  app.use(express.json());
  app.use("/api/atribusi/iklan", attributionAdsRouter);
  server = await startTestServer(app);
});
test.after(async () => { await server?.close?.(); await testPrisma.$disconnect(); });

function jalankanSmoke() {
  return new Promise((resolve) => {
    const port = new URL(server.baseUrl).port;
    const c = spawn(process.execPath, ["-"], { cwd: backendRoot, env: { ...process.env, PORT: port } });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => c.kill(), 90_000);
    c.stdout.on("data", (d) => (stdout += d)); c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (status) => {
      clearTimeout(timer);
      const v = Object.fromEntries(stdout.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
      resolve({ status, stdout, stderr, v });
    });
    c.stdin.end(SMOKE_JS);
  });
}
const hitungTabel = async () => ({
  touch: await testPrisma.attributionTouch.count(), ref: await testPrisma.metaAdReference.count(),
  imp: await testPrisma.metaAdReferenceImport.count(), cust: await testPrisma.customer.count(), msg: await testPrisma.message.count(),
});

test("smoke rilis pada keadaan KOSONG (tepat setelah rilis, flag MATI): kunci benar, rekonsiliasi OK, 0 touch, tidak menulis", async () => {
  const sebelum = await hitungTabel();
  const { v, status, stdout, stderr } = await jalankanSmoke();
  assert.equal(status, 0, (stdout + stderr).slice(-800));
  assert.deepEqual([v.STATUS_NOAUTH, v.STATUS_SALES, v.STATUS_TANPA_RENTANG, v.STATUS_PARAM_SALAH, v.STATUS_SINYAL_SEMUA, v.STATUS_ADMIN], ["401", "403", "200", "400", "400", "200"]);
  assert.equal(v.STATUS_SEBELAH_SAJA, "400");
  assert.equal(v.CACHE, "no-store");
  assert.equal(v.REKON_OK, "true");
  assert.equal(v.CPA_ROAS_NULL, "true");
  assert.equal(v.SINYAL, "CTWA_AD");
  assert.equal(v.AUDIT_MASUK_ATRIBUSI, "false");
  assert.equal(v.FORBIDDEN, "none"); assert.equal(v.KES_FORBIDDEN, "none"); assert.equal(v.REF_FORBIDDEN, "none");
  assert.deepEqual([v.KES_STATUS, v.KES_CAPTURE_AKTIF, v.KES_TOUCH_TOTAL], ["200", "false", "0"]);
  assert.deepEqual([v.REF_STATUS_ADMIN, v.REF_STATUS_SALES, v.EKSPOR_STATUS], ["200", "403", "200"]);
  assert.match(v.PERINGATAN, /ATRIBUSI_BELUM_MULAI/);
  assert.ok(!/eyJ/.test(stdout + stderr), "token JWT tidak boleh tercetak");
  assert.deepEqual(await hitungTabel(), sebelum, "smoke tidak boleh menulis apa pun");
});

test("smoke rilis dengan DATA (nama/telepon/touch/order/pembayaran): respons tetap bersih; angka sinkron; flag menyala terbaca; tetap tidak menulis", async () => {
  const hariIni = new Date(Date.now() + 7 * 3600e3);
  const c = await testPrisma.customer.create({ data: { name: "Pelanggan Smoke Rahasia", phone: "6285311122233", leadSource: "META_ADS" } });
  const o = await testPrisma.order.create({ data: { customerId: c.id, value: 2_000_000, status: "PROCESSING", paymentStatus: "LUNAS", paidAt: new Date() } });
  const admin = await testPrisma.user.findFirst({ where: { role: "ADMIN" } });
  await testPrisma.payment.create({ data: { orderId: o.id, amount: 2_000_000, method: "TRANSFER", recordedById: admin.id } });
  const at = new Date();
  await testPrisma.attributionTouch.create({ data: {
    customerId: c.id, adId: "52694481763484", touchAt: at, touchDateWib: new Date(new Date(at.getTime() + 7 * 3600e3).toISOString().slice(0, 10) + "T00:00:00Z"),
    mappingStatusAtTouch: "UNMAPPED", evidenceSource: "CTWA_AD", sourceType: "ad", customerStatusAtTouch: "NEW", customerBasisAtTouch: "WEBHOOK_MEMBUAT", dedupeKey: "smoke:1",
  } });
  process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
  try {
    const sebelum = await hitungTabel();
    const { v, status, stdout, stderr } = await jalankanSmoke();
    assert.equal(status, 0, (stdout + stderr).slice(-800));
    assert.equal(v.STATUS_ADMIN, "200");
    assert.equal(v.REKON_OK, "true");
    assert.equal(v.LEAD_UNIK, "1");
    assert.equal(v.CLOSING_UTAMA, "1");
    assert.equal(v.JUMLAH_GRUP, "1");
    assert.match(v.PERINGATAN, /AD_ID_TIDAK_TERPETAKAN/);
    assert.equal(v.FORBIDDEN, "none"); assert.equal(v.KES_FORBIDDEN, "none"); assert.equal(v.REF_FORBIDDEN, "none");
    assert.equal(v.KES_CAPTURE_AKTIF, "true");
    assert.equal(v.KES_TOUCH_TOTAL, "1");
    assert.equal(v.KES_PENDING_PEMETAAN, "1", "satu touch dengan Ad ID belum terpetakan");
    for (const rahasia of ["Pelanggan Smoke", "6285311122233"]) assert.ok(!(stdout + stderr).includes(rahasia));
    assert.deepEqual(await hitungTabel(), sebelum, "smoke tidak boleh menulis apa pun");
  } finally { delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED; void hariIni; }
});

// ── SQL yang dipakai fase rehearsal/verifikasi skrip: dijalankan NYATA pada DB yang dimigrasi dari nol (bukti SQL valid dan perilaku constraint) ──
const heredoc = (nama) => {
  const m = new RegExp(`read -r -d '' ${nama} <<'([A-Z0-9_]+)' \\|\\| true\\n([\\s\\S]*?)\\n\\1\\n`).exec(skrip);
  if (!m) throw new Error(`${nama} tidak ditemukan`);
  return m[2];
};
const stringBash = (nama) => {
  const m = new RegExp(`\\n${nama}="([\\s\\S]*?)"\\n`).exec(skrip);
  if (!m) throw new Error(`${nama} tidak ditemukan`);
  return m[1].replace(/\\"/g, '"');
};

test("UJI_SQL rehearsal: pada DB hasil migrasi menghasilkan ROLLBACK_UJI dengan >= 17 penolakan dan >= 4 baris sah, tanpa TIDAK_DITOLAK; semuanya dibatalkan", async () => {
  await testPrisma.customer.create({ data: { name: "Contoh Rehearsal", phone: "6285399900011" } });
  const sebelum = await hitungTabel();
  let pesan = "";
  try { await testPrisma.$executeRawUnsafe(heredoc("UJI_SQL")); } catch (e) { pesan = String(e.message); }
  assert.match(pesan, /ROLLBACK_UJI tolak=(\d+) lolos=(\d+)/, pesan.slice(0, 400));
  assert.ok(!/TIDAK_DITOLAK/.test(pesan), pesan.slice(0, 400));
  const [, tolak, lolos] = /ROLLBACK_UJI tolak=(\d+) lolos=(\d+)/.exec(pesan);
  assert.ok(Number(tolak) >= 17, `tolak=${tolak}`);
  assert.ok(Number(lolos) >= 4, `lolos=${lolos}`);
  assert.deepEqual(await hitungTabel(), sebelum, "uji perilaku seluruhnya dibatalkan");
});

test("SQL sidik jari rehearsal (FP_SQL, SKEMA_SQL) dan hitungan inbox valid dan menghasilkan bentuk yang dibaca skrip", async () => {
  const fp = await testPrisma.$queryRawUnsafe(stringBash("FP_SQL"));
  assert.equal(fp.length, 5);
  const skema = await testPrisma.$queryRawUnsafe(stringBash("SKEMA_SQL").replace(/^SKEMA_SQL=/, ""));
  assert.equal(skema.length, 5, "5 tabel lama terukur skemanya");
  const m = /psql_live -At -c "(select count\(\*\) from \\"Message\\" where direction::text='INBOUND' and \\"createdAt\\" >= '\$\{since_utc\}'::timestamptz)"/.exec(skrip);
  assert.ok(m, "query inbox tidak ditemukan");
  const q = m[1].replace(/\\"/g, '"').replace("${since_utc}", "2026-01-01T00:00:00Z");
  const r = await testPrisma.$queryRawUnsafe(q);
  assert.ok(Number(r[0].count) >= 0);
});
