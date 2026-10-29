// Matriks akses tiga tool laporan Meta Ads di SEMUA jalur MCP/Actions: /mcp, /gpt-actions, /mcp-chatgpt — PostgreSQL sekali pakai + router ASLI.
// Diizinkan: token statis (kredensial mesin), OAuth ADMIN aktif. Ditolak: tanpa/palsu token, audience salah, OAuth user SALES, OAuth ADMIN yang sudah
// diturunkan/dinonaktifkan/dihapus (token masih berlaku 1 jam), kegagalan memuat user (fail-closed). Tool lain tidak terpengaruh. Tanpa PII.
import os from "os";
import path from "path";

process.env.WAHA_BASE_URL = "http://127.0.0.1:9";
process.env.CTWA_CAPTURE_DIR = path.join(os.tmpdir(), "mcp-meta-akses-cap");
delete process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED;
delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED;
process.env.JWT_SECRET ||= "rahasia-uji-mcp-laporan-meta-akses";
const TOKEN_MCP = "token-uji-mcp-laporan-meta-akses";
process.env.MCP_API_TOKEN = TOKEN_MCP;
process.env.MCP_OAUTH_JWT_SECRET = "rahasia-oauth-uji-akses-laporan-meta-1234567890";
process.env.MCP_PUBLIC_URL = "https://uji.sanss.test";
process.env.MCP_RATE_LIMIT_PER_MIN = "100000";

await import("./setup/env.js");
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { default: jwt } = await import("jsonwebtoken");
const { testPrisma, truncateAll } = await import("./setup/testDb.js");
const { startTestServer } = await import("./setup/testApp.js");
const { mcpRouter } = await import("../../src/mcp/index.js");
const { gptActionsRouter } = await import("../../src/mcp/gptActions.js");
const { chatGptMcpRouter } = await import("../../src/mcp/chatgptPlugin.js");
const { signAccessToken, publicUrl } = await import("../../src/mcp/oauthCrypto.js");
const { buatPenjagaAksesLaporan, namaToolDiminta, TOOL_LAPORAN_META } = await import("../../src/mcp/penjagaAksesLaporan.js");
const { benihMetaAds, DARI, SAMPAI } = await import("./setup/metaAdsSeed.js");

let server, admin, sales, adminTurun, adminNonaktif, adminDihapus, base;
const oauth = (u, resource) => signAccessToken({ userId: u.id, clientId: "klien-uji", resource });
const PARAM = { dari: DARI, sampai: SAMPAI };
const BODY_TOOL = { performa_campaign_meta: { ...PARAM, level: "campaign" }, rekap_harian_meta: PARAM, kesehatan_atribusi_meta: PARAM };

test.before(async () => {
  await truncateAll();
  for (const m of ["metaAdSpendRevision", "metaAdDailySpend", "metaSpendImport", "attributionKpiTarget", "attributionAlertState", "attributionTouch", "metaAdReference"]) await testPrisma[m].deleteMany({}).catch(() => {});
  const mk = (nama, role, extra = {}) => testPrisma.user.create({ data: { name: nama, email: `${nama}-${Date.now()}@example.test`, passwordHash: "x", role, ...extra } });
  admin = await mk("AdminAkses", "ADMIN");
  sales = await mk("SalesAkses", "SALES");
  adminTurun = await mk("AdminTurun", "ADMIN");
  adminNonaktif = await mk("AdminNonaktif", "ADMIN");
  adminDihapus = await mk("AdminDihapus", "ADMIN");
  for (const u of [admin, adminTurun, adminNonaktif]) await testPrisma.userRole.create({ data: { userId: u.id, role: "ADMIN" } });
  await testPrisma.userRole.create({ data: { userId: sales.id, role: "SALES" } });
  await benihMetaAds({ testPrisma, admin });
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/mcp", mcpRouter);
  app.use("/gpt-actions", gptActionsRouter);
  app.use("/mcp-chatgpt", chatGptMcpRouter);
  server = await startTestServer(app);
  base = server.baseUrl;
  // diturunkan / dinonaktifkan / dihapus SETELAH token diterbitkan (token di bawah dibuat sebelum perubahan ini)
  tokenTurun = oauth(adminTurun); tokenNonaktif = oauth(adminNonaktif); tokenDihapus = oauth(adminDihapus);
  await testPrisma.userRole.deleteMany({ where: { userId: adminTurun.id } });
  await testPrisma.userRole.create({ data: { userId: adminTurun.id, role: "SALES" } });
  await testPrisma.user.update({ where: { id: adminTurun.id }, data: { role: "SALES" } });
  await testPrisma.user.update({ where: { id: adminNonaktif.id }, data: { active: false } });
  await testPrisma.userRole.deleteMany({ where: { userId: adminDihapus.id } });
  await testPrisma.user.delete({ where: { id: adminDihapus.id } });
});
let tokenTurun, tokenNonaktif, tokenDihapus;
test.after(async () => {
  for (const m of ["metaAdSpendRevision", "metaAdDailySpend", "metaSpendImport", "attributionKpiTarget", "attributionAlertState"]) await testPrisma[m].deleteMany({}).catch(() => {});
  await server?.close?.();
  await testPrisma.$disconnect();
});

// ── klien ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let idRpc = 0;
async function rpc(jalur, method, params, token) {
  const res = await fetch(`${base}${jalur}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++idRpc, method, params }) });
  const teks = await res.text();
  const baris = teks.split("\n").find((l) => l.startsWith("data:")) ?? teks;
  let json = null; try { json = JSON.parse(baris.replace(/^data:\s*/, "")); } catch { /* bukan JSON */ }
  return { status: res.status, json, teks };
}
const panggilMcp = (token, nama, jalur = "/mcp") => rpc(jalur, "tools/call", { name: nama, arguments: BODY_TOOL[nama] ?? {} }, token);
async function panggilActions(token, nama, body = BODY_TOOL[nama] ?? {}) {
  const res = await fetch(`${base}/gpt-actions/tools/${nama}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const teks = await res.text(); let json = null; try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  return { status: res.status, json, teks };
}
const TOOL_BARU = TOOL_LAPORAN_META;
const adaIsi = (r) => r.status === 200 && !r.json?.result?.isError;

// ── DIIZINKAN ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DIIZINKAN /mcp: token statis dan OAuth ADMIN aktif memanggil ketiga tool", async () => {
  for (const t of TOOL_BARU) {
    assert.ok(adaIsi(await panggilMcp(TOKEN_MCP, t)), `statis ${t}`);
    assert.ok(adaIsi(await panggilMcp(oauth(admin), t)), `oauth admin ${t}`);
  }
});

test("DIIZINKAN /gpt-actions: token statis dan OAuth ADMIN aktif memanggil ketiga tool; openapi memuatnya tanpa parameter unmask", async () => {
  for (const t of TOOL_BARU) {
    const a = await panggilActions(TOKEN_MCP, t); assert.equal(a.status, 200, `statis ${t}: ${a.teks.slice(0, 120)}`);
    const b = await panggilActions(oauth(admin), t); assert.equal(b.status, 200, `oauth admin ${t}`);
    assert.deepEqual(a.json.kriteria ?? a.json.periode, b.json.kriteria ?? b.json.periode);
  }
  const res = await fetch(`${base}/gpt-actions/openapi.json`, { headers: { Authorization: `Bearer ${TOKEN_MCP}` } });
  const spec = await res.json();
  for (const t of TOOL_BARU) {
    const op = spec.paths[`/gpt-actions/tools/${t}`]?.post; assert.ok(op, `openapi memuat ${t}`);
    assert.equal(op.requestBody.content["application/json"].schema.properties.unmask, undefined);
  }
});

test("DIIZINKAN /mcp-chatgpt: OAuth ADMIN (audience /mcp-chatgpt) — tools/list memuat sembilan tool dan tiga tool Meta bisa dipanggil", async () => {
  const token = oauth(admin, `${publicUrl()}/mcp-chatgpt`);
  const lst = await rpc("/mcp-chatgpt", "tools/list", {}, token);
  assert.equal(lst.status, 200);
  const nama = lst.json.result.tools.map((x) => x.name).sort();
  assert.equal(nama.length, 9, `tool: ${nama.join(",")}`);
  for (const n of ["sales_performa_campaign_meta", "sales_rekap_harian_meta", "sales_kesehatan_atribusi_meta"]) assert.ok(nama.includes(n), n);
  assert.ok(lst.json.result.tools.every((x) => x.annotations?.readOnlyHint === true));
  for (const t of TOOL_BARU) {
    const r = await rpc("/mcp-chatgpt", "tools/call", { name: `sales_${t}`, arguments: BODY_TOOL[t] }, token);
    assert.ok(adaIsi(r), `sales_${t}: ${r.teks.slice(0, 160)}`);
  }
});

// ── DITOLAK ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DITOLAK /gpt-actions: tanpa token, token salah, JWT dengan secret lain, audience /mcp-chatgpt → 401", async () => {
  const palsu = jwt.sign({ clientId: "x", scope: "mcp" }, "secret-lain", { subject: admin.id, issuer: publicUrl(), audience: `${publicUrl()}/mcp`, expiresIn: 600 });
  for (const t of TOOL_BARU) {
    for (const token of [null, "salah", palsu, oauth(admin, `${publicUrl()}/mcp-chatgpt`)]) assert.equal((await panggilActions(token, t)).status, 401, `${t}`);
  }
});

test("DITOLAK /mcp: tanpa/palsu token 401; audience /mcp-chatgpt dipakai di /mcp → 401", async () => {
  for (const t of TOOL_BARU) {
    assert.equal((await panggilMcp(null, t)).status, 401);
    assert.equal((await panggilMcp("salah", t)).status, 401);
    assert.equal((await panggilMcp(oauth(admin, `${publicUrl()}/mcp-chatgpt`), t)).status, 401);
  }
});

test("DITOLAK /mcp dan /gpt-actions: OAuth user SALES, admin yang kemudian diturunkan, dinonaktifkan, atau dihapus (token masih berlaku) → 403 untuk tiga tool", async () => {
  const tokenSales = oauth(sales);
  for (const t of TOOL_BARU) {
    for (const [nama, token] of [["sales", tokenSales], ["diturunkan", tokenTurun], ["dinonaktifkan", tokenNonaktif], ["dihapus", tokenDihapus]]) {
      const m = await panggilMcp(token, t); assert.equal(m.status, 403, `/mcp ${nama} ${t}`);
      const a = await panggilActions(token, t); assert.equal(a.status, 403, `/gpt-actions ${nama} ${t}`);
      assert.ok(!/Realisasi|campaignId|performa/i.test(m.teks + a.teks), "penolakan tidak memuat data");
    }
  }
});

test("DITOLAK batch JSON-RPC: tools/call laporan Meta di dalam array tetap dijaga untuk OAuth non-ADMIN", async () => {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${oauth(sales)}` },
    body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "rekap_harian_meta", arguments: PARAM } }]) });
  assert.equal(res.status, 403);
});

test("DITOLAK /mcp-chatgpt: OAuth SALES, admin diturunkan/nonaktif → 403; token audience /mcp → 401", async () => {
  for (const u of [sales, adminTurun, adminNonaktif]) {
    const token = oauth(u, `${publicUrl()}/mcp-chatgpt`);
    const r = await rpc("/mcp-chatgpt", "tools/call", { name: "sales_performa_campaign_meta", arguments: BODY_TOOL.performa_campaign_meta }, token);
    assert.equal(r.status, 403, `user ${u.name}`);
  }
  assert.equal((await rpc("/mcp-chatgpt", "tools/list", {}, oauth(admin))).status, 401);
  assert.equal((await rpc("/mcp-chatgpt", "tools/list", {}, TOKEN_MCP)).status, 401);
});

test("FAIL-CLOSED: kegagalan memuat user (DB error) menolak OAuth, token statis tetap lolos; request lain tidak diperiksa", async () => {
  const jaga = buatPenjagaAksesLaporan({ pemuat: async () => { throw new Error("db mati"); } });
  const jalankan = async (req) => { let status = null, lanjut = false; await jaga(req, { status(s) { status = s; return { json() {} }; } }, () => { lanjut = true; }); return { status, lanjut }; };
  const body = { method: "tools/call", params: { name: "performa_campaign_meta" } };
  assert.deepEqual(await jalankan({ body, path: "/", mcpAuth: { type: "oauth", userId: admin.id } }), { status: 403, lanjut: false });
  assert.deepEqual(await jalankan({ body, path: "/", mcpAuth: { type: "static" } }), { status: null, lanjut: true });
  assert.deepEqual(await jalankan({ body, path: "/", mcpAuth: undefined }), { status: 403, lanjut: false });
  assert.deepEqual(await jalankan({ body: { method: "tools/call", params: { name: "cari_order" } }, path: "/", mcpAuth: { type: "oauth", userId: admin.id } }), { status: null, lanjut: true });
  assert.deepEqual(namaToolDiminta({ body: null, path: "/tools/rekap_harian_meta" }), ["rekap_harian_meta"]);
});

test("TIDAK MELUAS: tool lain di /mcp tetap berperilaku lama untuk OAuth non-ADMIN (penjaga hanya untuk tiga tool Meta)", async () => {
  const r = await rpc("/mcp", "tools/call", { name: "statistik_crm", arguments: {} }, oauth(sales));
  assert.equal(r.status, 200, "perilaku lama tidak diubah oleh penjaga baru");
});

// ── TANPA PII di semua jalur ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("TANPA PII: respons tiga tool lewat /mcp, /gpt-actions, /mcp-chatgpt tidak memuat nama/telepon/email/ID customer atau order", async () => {
  const kumpul = [];
  for (const t of TOOL_BARU) {
    kumpul.push((await panggilMcp(TOKEN_MCP, t)).teks, (await panggilActions(TOKEN_MCP, t)).teks);
    kumpul.push((await rpc("/mcp-chatgpt", "tools/call", { name: `sales_${t}`, arguments: BODY_TOOL[t] }, oauth(admin, `${publicUrl()}/mcp-chatgpt`))).teks);
  }
  const semua = kumpul.join("\n");
  const ids = [...(await testPrisma.customer.findMany({ select: { id: true } })).map((c) => c.id), ...(await testPrisma.order.findMany({ select: { id: true, orderNumber: true } })).flatMap((o) => [o.id, o.orderNumber].filter(Boolean))];
  assert.ok(ids.length > 10);
  for (const id of ids) assert.ok(!semua.includes(String(id)), `ID bocor: ${id}`);
  for (const pola of ["6285301", "Pelanggan Uji", "AdminAkses", "SalesAkses", "@example.test", "ctwaClid", "customerId"]) assert.ok(!semua.includes(pola), `bocor: ${pola}`);
});
