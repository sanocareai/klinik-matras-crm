// Tes integrasi LAPORAN META ADS via MCP — PostgreSQL sekali pakai + endpoint ASLI /api/atribusi/iklan + router MCP ASLI (/mcp, HTTP JSON-RPC).
// Membuktikan: endpoint = service = tool MCP pada snapshot/cutoff yang sama; campaign = Σ ad set = Σ ad; customer unik (ber-order / pernah membayar / lunas
// ledger) dengan multi-order, retry touch, reaktivasi, UNMAPPED, order dibatalkan/PENDING, payment dibatalkan+pengganti, ledger parsial, spend parsial,
// batas hari WIB; RBAC; READ-ONLY (tak ada baris berubah); tanpa PII; tool legacy tetap berfungsi; penjaga bersama tidak membuat panggilan gagal.
import os from "os";
import path from "path";

process.env.WAHA_BASE_URL = "http://127.0.0.1:9";
process.env.CTWA_CAPTURE_DIR = path.join(os.tmpdir(), "mcp-meta-int-cap");
delete process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED;
delete process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED;
process.env.JWT_SECRET ||= "rahasia-uji-mcp-laporan-meta";
const TOKEN_MCP = "token-uji-mcp-laporan-meta";
process.env.MCP_API_TOKEN = TOKEN_MCP;
process.env.MCP_OAUTH_JWT_SECRET = "";

await import("./setup/env.js");
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { default: jwt } = await import("jsonwebtoken");
const { testPrisma, truncateAll } = await import("./setup/testDb.js");
const { startTestServer } = await import("./setup/testApp.js");
const { prisma } = await import("../../src/db.js");
const { attributionAdsRouter } = await import("../../src/routes/attributionAds.js");
const { mcpRouter } = await import("../../src/mcp/index.js");
const { laporanPerforma, rekapHarian, kesehatanAtribusi } = await import("../../src/services/attribution/laporanMeta.js");
const { nowPartsWIB } = await import("../../src/utils/wib.js");

const M = (n) => n * 1_000_000;
const T = (s) => new Date(s);
const AKUN = "1234567890123";
const AD1 = "52694481763484", AD2 = "52689767293284", AD3 = "52696131903684", AD9 = "52699999999999";
const CAMP1 = "52694481763084", CAMP2 = "52696131903884";
const SET1 = "52694481763284", SET2 = "52689767293084", SET3 = "52696131903484";
const DARI = "2026-10-01", SAMPAI = "2026-10-10";

let server, admin, sales, tokenAdmin, tokenSales, mcpUrl;
let urutanTouch = 0;

test.before(async () => {
  await truncateAll();
  for (const m of ["metaAdSpendRevision", "metaAdDailySpend", "metaSpendImport", "attributionKpiTarget", "attributionAlertState", "attributionTouch", "metaAdReference"]) await testPrisma[m].deleteMany({}).catch(() => {});
  admin = await testPrisma.user.create({ data: { name: "Admin MCP", email: `adm-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  sales = await testPrisma.user.create({ data: { name: "Sales MCP", email: `sls-${Date.now()}@example.test`, passwordHash: "x", role: "SALES" } });
  const tok = (u, roles) => jwt.sign({ id: u.id, name: u.name, role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: "1h" });
  tokenAdmin = tok(admin, ["ADMIN"]); tokenSales = tok(sales, ["SALES"]);
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/atribusi/iklan", attributionAdsRouter);
  app.use("/mcp", mcpRouter);
  server = await startTestServer(app);
  mcpUrl = `${server.baseUrl}/mcp`;
  await benih();
});
test.after(async () => {
  for (const m of ["metaAdSpendRevision", "metaAdDailySpend", "metaSpendImport", "attributionKpiTarget", "attributionAlertState"]) await testPrisma[m].deleteMany({}).catch(() => {});
  await server?.close?.();
  await testPrisma.$disconnect();
});

// ── seed ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function benih() {
  for (const [ad, set, camp, nama] of [[AD1, SET1, CAMP1, "Jabo IG Oktober"], [AD2, SET2, CAMP1, "Jabo IG Oktober"], [AD3, SET3, CAMP2, "FB broad test"]]) {
    await testPrisma.metaAdReference.create({ data: { adId: ad, adSetId: set, campaignId: camp, campaignName: nama, adSetName: `Set ${set.slice(-2)}`, adName: `Ad ${ad.slice(-2)}`, source: "MANUAL", syncedAt: new Date() } });
  }
  const cust = (phone, createdAt, o = {}) => testPrisma.customer.create({ data: { name: "Pelanggan Uji", phone, createdAt: T(createdAt), leadSource: "META_ADS", ...o } });
  const order = (customerId, createdAt, value, o = {}) => testPrisma.order.create({ data: { customerId, createdAt: T(createdAt), value, status: "PROCESSING", ...o } });
  const bayar = (orderId, createdAt, amount, o = {}) => testPrisma.payment.create({ data: { orderId, amount, method: "TRANSFER", recordedById: admin.id, createdAt: T(createdAt), ...o } });
  const sentuh = (customerId, adId, touchAt, o = {}) => {
    const at = T(touchAt);
    return testPrisma.attributionTouch.create({ data: {
      customerId, adId, touchAt: at, touchDateWib: T(new Date(at.getTime() + 7 * 3600e3).toISOString().slice(0, 10) + "T00:00:00Z"),
      mappingStatusAtTouch: "UNMAPPED", evidenceSource: "CTWA_AD", sourceType: "ad", customerStatusAtTouch: "NEW", customerBasisAtTouch: "WEBHOOK_MEMBUAT", dedupeKey: `mcp:${++urutanTouch}`, ...o,
    } });
  };
  const LAMA = { customerStatusAtTouch: "EXISTING", customerBasisAtTouch: "RIWAYAT_PESAN" };

  // C0: touch paling awal (29 Sep) → atribusi sebanding untuk periode uji; di luar periode
  const c0 = await cust("6285301000000", "2026-09-29T03:00:00Z"); await sentuh(c0.id, AD1, "2026-09-29T03:01:00Z");
  // C1: DP 1jt (2 Okt) + pelunasan 3jt (5 Okt) → lunas ledger
  const c1 = await cust("6285301000001", "2026-10-01T03:00:00Z", { pipelineStage: "PROSPECT" });
  const o1 = await order(c1.id, "2026-10-02T03:00:00Z", M(4), { paymentStatus: "LUNAS", paidAt: T("2026-10-05T03:00:00Z") });
  await bayar(o1.id, "2026-10-02T04:00:00Z", M(1)); await bayar(o1.id, "2026-10-05T03:00:00Z", M(3));
  await sentuh(c1.id, AD1, "2026-10-01T03:01:00Z");
  // C2: DUA order (satu customer). O2 lunas 2jt; O3 DP: payment 500rb DIBATALKAN lalu diganti 750rb
  const c2 = await cust("6285301000002", "2026-10-01T04:00:00Z");
  const o2 = await order(c2.id, "2026-10-03T03:00:00Z", M(2), { paymentStatus: "LUNAS", paidAt: T("2026-10-03T05:00:00Z") });
  await bayar(o2.id, "2026-10-03T05:00:00Z", M(2));
  const o3 = await order(c2.id, "2026-10-04T03:00:00Z", 1_500_000, { paymentStatus: "DP" });
  const batal = await bayar(o3.id, "2026-10-04T04:00:00Z", 500_000, { cancelledAt: T("2026-10-04T06:00:00Z"), cancelledById: admin.id, cancelReason: "salah input" });
  await bayar(o3.id, "2026-10-04T06:30:00Z", 750_000, { replacesPaymentId: batal.id });
  await sentuh(c2.id, AD1, "2026-10-01T04:01:00Z");
  // C3: LUNAS di CRM tetapi TANPA ledger (ledger parsial) — bukan pernah membayar, bukan lunas ledger
  const c3 = await cust("6285301000003", "2026-10-02T03:00:00Z");
  await order(c3.id, "2026-10-04T03:00:00Z", M(3), { paymentStatus: "LUNAS", paidAt: T("2026-10-04T08:00:00Z") });
  await sentuh(c3.id, AD2, "2026-10-02T03:01:00Z");
  // C4: Ad ID belum terpetakan (UNMAPPED)
  const c4 = await cust("6285301000004", "2026-10-02T05:00:00Z"); await sentuh(c4.id, AD9, "2026-10-02T05:01:00Z");
  // C5: SPAM dengan order berbayar → keluar dari metrik
  const c5 = await cust("6285301000005", "2026-10-03T03:00:00Z", { pipelineStage: "SPAM" });
  const o5 = await order(c5.id, "2026-10-04T03:00:00Z", M(5), { paymentStatus: "LUNAS", paidAt: T("2026-10-04T05:00:00Z") });
  await bayar(o5.id, "2026-10-04T05:00:00Z", M(5)); await sentuh(c5.id, AD1, "2026-10-03T03:01:00Z");
  // C6: organik (tanpa touch)
  await cust("6285301000006", "2026-10-04T03:00:00Z");
  // C7: customer LAMA (Agustus) klik iklan lagi → reaktivasi, bukan lead
  const c7 = await cust("6285301000007", "2026-08-15T03:00:00Z"); await sentuh(c7.id, AD1, "2026-10-05T03:00:00Z", LAMA);
  // C8: campaign lain; status LUNAS tetapi ledger 2jt dari tagihan 2,2jt (value + ongkir) → DP menurut ledger
  const c8 = await cust("6285301000008", "2026-10-05T03:00:00Z");
  const o8 = await order(c8.id, "2026-10-06T03:00:00Z", M(2), { ongkir: 200_000, paymentStatus: "LUNAS", paidAt: T("2026-10-06T05:00:00Z") });
  await bayar(o8.id, "2026-10-06T05:00:00Z", M(2)); await sentuh(c8.id, AD3, "2026-10-05T03:01:00Z");
  // C9: retry/multi-touch — akuisisi AD2 lebih dulu; touch AD1 berikutnya (customer sudah ada) hanya reaktivasi/berikutnya
  const c9 = await cust("6285301000009", "2026-10-07T03:00:00Z");
  await sentuh(c9.id, AD2, "2026-10-07T03:01:00Z"); await sentuh(c9.id, AD1, "2026-10-08T03:00:00Z", LAMA);
  // C10: order DIBATALKAN; C11: order PENDING → bukan order eligible
  const c10 = await cust("6285301000010", "2026-10-08T03:00:00Z");
  await order(c10.id, "2026-10-08T05:00:00Z", M(1), { status: "CANCELLED" }); await sentuh(c10.id, AD1, "2026-10-08T03:01:00Z");
  const c11 = await cust("6285301000011", "2026-10-08T04:00:00Z");
  await order(c11.id, "2026-10-08T06:00:00Z", M(2), { status: "PENDING" }); await sentuh(c11.id, AD1, "2026-10-08T04:01:00Z");
  // BATAS HARI WIB: CB1 dibuat 8 Okt 23:59:59 WIB (lunas 1jt); CB2 dibuat 9 Okt 00:00:00 WIB
  const cb1 = await cust("6285301000012", "2026-10-08T16:59:59Z");
  const ob1 = await order(cb1.id, "2026-10-09T03:00:00Z", M(1), { paymentStatus: "LUNAS", paidAt: T("2026-10-09T04:00:00Z") });
  await bayar(ob1.id, "2026-10-09T04:00:00Z", M(1)); await sentuh(cb1.id, AD1, "2026-10-08T16:59:59Z");
  const cb2 = await cust("6285301000013", "2026-10-08T17:00:00Z"); await sentuh(cb2.id, AD2, "2026-10-08T17:00:00Z");

  // spend: lengkap 1–10 Okt untuk AD1 100rb, AD2 50rb, AD3 20rb per hari; AD9 (UNMAPPED) 5rb di 2 Okt. 11–12 Okt SENGAJA kosong (spend parsial).
  const imp = await testPrisma.metaSpendImport.create({ data: { source: "ADS_MANAGER_CSV", accountId: AKUN, contentSha256: "a".repeat(64), rowsTotal: 0, rowsAccepted: 0, rowsRejected: 0, rowsNew: 0, rowsUpdated: 0, rowsUnchanged: 0, spendTotal: 0, accountTimezone: "Asia/Jakarta" } });
  let n = 0;
  const hier = { [AD1]: [CAMP1, SET1, 100_000], [AD2]: [CAMP1, SET2, 50_000], [AD3]: [CAMP2, SET3, 20_000] };
  for (let t = Date.parse(`${DARI}T00:00:00Z`); t <= Date.parse(`${SAMPAI}T00:00:00Z`); t += 86_400_000) {
    for (const [ad, [camp, set, spend]] of Object.entries(hier)) {
      await testPrisma.metaAdDailySpend.create({ data: { dateWib: new Date(t), accountId: AKUN, campaignId: camp, adSetId: set, adId: ad, currency: "IDR", spend, source: "ADS_MANAGER_CSV", accountTimezone: "Asia/Jakarta", importedAt: new Date(), importId: imp.id, rowChecksum: String(++n).padStart(64, "0") } });
    }
  }
  await testPrisma.metaAdDailySpend.create({ data: { dateWib: T("2026-10-02T00:00:00Z"), accountId: AKUN, campaignId: "52699999999001", adSetId: "52699999999002", adId: AD9, currency: "IDR", spend: 5_000, source: "ADS_MANAGER_CSV", accountTimezone: "Asia/Jakarta", importedAt: new Date(), importId: imp.id, rowChecksum: String(++n).padStart(64, "0") } });
}

// ── klien ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const api = async (p, { token = tokenAdmin } = {}) => {
  const res = await fetch(`${server.baseUrl}/api/atribusi/iklan${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const teks = await res.text(); let json = null; try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  return { status: res.status, json, teks };
};
let idRpc = 0;
async function rpc(method, params = {}, token = TOKEN_MCP) {
  const res = await fetch(mcpUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++idRpc, method, params }) });
  const teks = await res.text();
  const baris = teks.split("\n").find((l) => l.startsWith("data:")) ?? teks;
  let json = null; try { json = JSON.parse(baris.replace(/^data:\s*/, "")); } catch { /* bukan JSON */ }
  return { status: res.status, json };
}
async function tool(name, args = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  assert.equal(r.status, 200, `${name} status ${r.status}`);
  const hasil = r.json.result;
  const teks = hasil.content[0].text;
  return { isError: !!hasil.isError, teks, json: JSON.parse(teks) };
}
const jumlahBaris = async () => ({
  customer: await testPrisma.customer.count(), order: await testPrisma.order.count(), payment: await testPrisma.payment.count(), touch: await testPrisma.attributionTouch.count(),
  spend: await testPrisma.metaAdDailySpend.count(), imp: await testPrisma.metaSpendImport.count(), ref: await testPrisma.metaAdReference.count(), rev: await testPrisma.metaAdSpendRevision.count(),
});
const baris = (p, kunci) => p.baris.find((b) => b.kunci === kunci);
const Q = `dari=${DARI}&sampai=${SAMPAI}`;

// ── 1. endpoint = service = MCP ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("angka dasar (dihitung tangan): customer unik ber-order / pernah membayar / lunas ledger; PENDING-CANCELLED-spam keluar; reaktivasi & UNMAPPED terpisah", async () => {
  const mc = await tool("performa_campaign_meta", { dari: DARI, sampai: SAMPAI, level: "campaign", batas: 100 });
  assert.equal(mc.isError, false);
  const c1 = baris(mc.json, CAMP1);
  // CAMP1 = AD1 + AD2: C1, C2, C3, C5(spam), C9, C10, C11, CB1, CB2
  assert.equal(c1.akuisisi.leadTerbukti, 9);
  assert.equal(c1.akuisisi.spam, 1);
  assert.equal(c1.order.customerBerOrder, 4, "C1, C2 (2 order = 1 customer), C3, CB1; C10 dibatalkan, C11 PENDING, C5 spam");
  assert.equal(c1.order.jumlahOrderEligible, 5, "O1, O2, O3, O4(C3), OB1");
  assert.equal(c1.order.nilaiOrder, M(4) + M(2) + 1_500_000 + M(3) + M(1));
  assert.equal(c1.order.customerPernahMembayar, 3, "C1, C2, CB1; C3 lunas-CRM tanpa ledger BUKAN pernah membayar");
  assert.equal(c1.order.customerLunasTerbuktiLedger, 3, "C1 (DP→lunas), C2 (O2), CB1");
  assert.equal(c1.order.customerLunasMenurutCrm, 4, "C1, C2, C3, CB1 — metrik terpisah dari bukti ledger");
  assert.equal(c1.uang.uangLedgerBersih, M(4) + M(2) + 750_000 + M(1), "payment dibatalkan 500rb tidak dihitung; pengganti 750rb dihitung");
  assert.equal(c1.reaktivasi.touch, 2, "C7 (customer lama) + touch berikutnya C9");
  assert.equal(c1.biaya.spend, 1_500_000);
  assert.equal(c1.biaya.cpaLunas, 500_000, "1,5jt / 3 customer unik lunas ledger");
  assert.equal(c1.biaya.nilaiOrderSetelahBiayaIklan, c1.order.nilaiOrder - 1_500_000);
  const c2 = baris(mc.json, CAMP2);
  assert.deepEqual([c2.akuisisi.leadTerbukti, c2.order.customerBerOrder, c2.order.customerPernahMembayar, c2.order.customerLunasTerbuktiLedger], [1, 1, 1, 0], "C8: ledger 2jt dari tagihan 2,2jt = DP, bukan lunas");
  assert.equal(c2.biaya.cpaLunas, null); assert.equal(c2.biaya.alasanNull.cpaLunas, "BELUM_ADA_KONVERSI");
  assert.equal(mc.json.tidakTerpetakan.length, 1);
  assert.equal(mc.json.tidakTerpetakan[0].status, "UNMAPPED");
  assert.equal(mc.json.tidakTerpetakan[0].biaya.spend, 5_000);
  assert.equal(mc.json.total.akuisisi.leadTerbukti, 11);
  assert.equal(mc.json.rekonsiliasi.ok, true, JSON.stringify(mc.json.rekonsiliasi));
});

test("endpoint = service = tool MCP pada data yang sama (campaign, ad set, ad): setiap angka identik", async () => {
  for (const level of ["campaign", "adset", "ad"]) {
    const ep = await api(`/?${Q}&level=${level}`);
    assert.equal(ep.status, 200);
    const sv = await laporanPerforma(prisma, { dari: DARI, sampai: SAMPAI, level, batas: 100 });
    const mc = await tool("performa_campaign_meta", { dari: DARI, sampai: SAMPAI, level, batas: 100 });
    // tool MCP = service (JSON yang sama, selain jam hitung)
    const norm = (x) => JSON.parse(JSON.stringify({ ...x, snapshot: undefined }));
    assert.deepEqual(norm(mc.json), norm(sv), `${level}: tool MCP ≠ service`);
    // service = endpoint, kunci demi kunci
    const semua = [...mc.json.baris, ...mc.json.tidakTerpetakan, ...(mc.json.unknown ? [mc.json.unknown] : [])];
    assert.equal(semua.length, ep.json.grup.length, `${level}: jumlah baris`);
    for (const g of ep.json.grup) {
      const b = semua.find((x) => x.kunci === g.kunci);
      assert.ok(b, `${level}: baris ${g.kunci} hilang di MCP`);
      assert.deepEqual(
        [b.status, b.akuisisi.leadTerbukti, b.akuisisi.spam, b.order.customerBerOrder, b.order.jumlahOrderEligible, b.order.nilaiOrder, b.order.customerPernahMembayar, b.order.customerLunasTerbuktiLedger, b.order.customerLunasMenurutCrm, b.uang.uangLedger, b.uang.refundDisetujui, b.uang.uangLedgerBersih, b.biaya.spend, b.biaya.cpaLunas, b.biaya.bookedRoas, b.biaya.cashRoas, b.biaya.cpl],
        [g.status, g.lead.unik, g.lead.spam, g.customerDenganOrder, g.orderEligible, g.bookedValue, g.customerPernahMembayar, g.closingUtama.customerLunasTerbuktiLedger, g.customerLunasMenurutCrm, g.uangLedger, g.refundDisetujui, g.uangBersihLedger, g.biaya.spend, g.biaya.cpa, g.biaya.bookedRoas, g.biaya.cashRoas, g.biaya.cpl],
        `${level}/${g.kunci}`,
      );
    }
    const t = ep.json.jumlahTeratribusi;
    assert.deepEqual(
      [mc.json.total.akuisisi.leadTerbukti, mc.json.total.order.customerBerOrder, mc.json.total.order.customerPernahMembayar, mc.json.total.order.customerLunasTerbuktiLedger, mc.json.total.order.nilaiOrder, mc.json.total.uang.uangLedgerBersih, mc.json.total.biaya.spend],
      [t.leadUnik, t.customerDenganOrder, t.customerPernahMembayar, t.closingUtama.customerLunasTerbuktiLedger, t.bookedValue, t.uangBersihLedger, ep.json.biaya.spendTotal],
      `${level}: total`,
    );
  }
});

test("rekonsiliasi lintas level: campaign = Σ ad set = Σ ad (metrik aditif + spend) via tool kesehatan_atribusi_meta; cakupan & spend terbaca", async () => {
  const k = await tool("kesehatan_atribusi_meta", { dari: DARI, sampai: SAMPAI, periksaLintasLevel: true });
  assert.equal(k.isError, false);
  assert.equal(k.json.rekonsiliasiLintasLevel.ok, true, JSON.stringify(k.json.rekonsiliasiLintasLevel.gagal));
  assert.deepEqual(k.json.rekonsiliasiLintasLevel.level, ["campaign", "adset", "ad"]);
  const c = k.json.cakupanAtribusi;
  assert.equal(c.leadBaruDalamRentang, 12, "C1-C6, C8-C11, CB1, CB2 dibuat 1–10 Okt (C0 dan C7 di luar)");
  assert.equal(c.denganTouchAkuisisi, 11);
  assert.equal(c.tidakTerpetakan, 1);
  assert.equal(c.tanpaTouch, 1, "C6 organik");
  assert.equal(k.json.spend.spendTotal, 1_705_000);
  assert.equal(k.json.spend.spendTidakTerpetakan, 5_000);
  assert.equal(k.json.spend.hariHilang.length, 0);
  assert.equal(k.json.spend.harian.length, 10);
  assert.equal(k.json.kesiapanKpi.atribusiSebanding, true);
  assert.equal(k.json.kesiapanKpi.spendLengkap, true);
  assert.equal(k.json.kesiapanKpi.pemetaanLengkap, false, "ada Ad UNMAPPED");
  assert.equal(k.json.capture.touchTotal, await testPrisma.attributionTouch.count());
  assert.ok(k.json.capture.pendingPemetaan.touch >= 1);
  assert.equal(k.json.ledger.orderEligible, 6);
  assert.equal(k.json.ledger.orderBerLedger, 5, "O4 (C3) tanpa ledger");
});

// ── 2. rekap harian + batas WIB ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("rekap harian: kohort per tanggal lead WIB (23:59:59 vs 00:00:00), Σ harian = akumulasi dihitung ulang, spend per hari, umur kohort", async () => {
  const r = await tool("rekap_harian_meta", { dari: DARI, sampai: SAMPAI });
  assert.equal(r.isError, false);
  const lead = Object.fromEntries(r.json.harian.map((h) => [h.tanggal, h.akuisisi.leadTerbukti]));
  assert.deepEqual(lead, { "2026-10-01": 2, "2026-10-02": 2, "2026-10-03": 1, "2026-10-04": 0, "2026-10-05": 1, "2026-10-06": 0, "2026-10-07": 1, "2026-10-08": 3, "2026-10-09": 1, "2026-10-10": 0 },
    "CB1 (8 Okt 23:59:59 WIB) di 8 Okt; CB2 (9 Okt 00:00:00 WIB) di 9 Okt");
  assert.equal(r.json.akumulasi.akuisisi.leadTerbukti, 11);
  assert.ok(r.json.pemeriksaanAditif.cek.every((c) => c.ok !== false), JSON.stringify(r.json.pemeriksaanAditif.cek.filter((c) => c.ok === false)));
  const hari = (d) => r.json.harian.find((h) => h.tanggal === d);
  assert.equal(hari("2026-10-08").order.customerLunasTerbuktiLedger, 1, "CB1");
  assert.equal(hari("2026-10-08").leadUnmapped, 0);
  assert.equal(hari("2026-10-02").leadUnmapped, 1, "C4 UNMAPPED");
  assert.equal(hari("2026-10-02").biaya.spend, 175_000);
  assert.equal(hari("2026-10-03").biaya.spend, 170_000);
  assert.equal(r.json.akumulasi.biaya.spend, 1_705_000, "akumulasi spend dari data sumber");
  assert.ok(r.json.harian.every((h) => h.statusHari === "PENUH" && h.umurKohortHari >= 19));
  assert.equal(r.json.tampilan, "KOHORT_AKUISISI");
  // KPI akumulasi dihitung dari penyebut periode, bukan dari rata-rata harian
  assert.equal(r.json.akumulasi.biaya.cpaLunas, Math.round((r.json.akumulasi.biaya.spend / r.json.akumulasi.order.customerLunasTerbuktiLedger) * 100) / 100);
  // rekap = service = endpoint untuk satu hari
  const ep = await api(`/?dari=2026-10-08&sampai=2026-10-08&level=campaign`);
  assert.equal(hari("2026-10-08").akuisisi.leadTerbukti, ep.json.jumlahTeratribusi.leadUnik);
  assert.equal(hari("2026-10-08").order.customerBerOrder, ep.json.jumlahTeratribusi.customerDenganOrder);
  const sv = await rekapHarian(prisma, { dari: DARI, sampai: SAMPAI });
  assert.deepEqual(sv.harian.map((h) => h.akuisisi.leadTerbukti), r.json.harian.map((h) => h.akuisisi.leadTerbukti));
  // filter campaign
  const rc = await tool("rekap_harian_meta", { dari: DARI, sampai: SAMPAI, campaignId: CAMP2 });
  assert.equal(rc.json.akumulasi.akuisisi.leadTerbukti, 1);
  assert.equal(rc.json.akumulasi.biaya.spend, 200_000);
});

// ── 3. pengaman spend & hari berjalan ────────────────────────────────────────────────────────────────────────────────────────────────────────
test("spend parsial (11–12 Okt kosong) → spend tampil, CPA/ROAS/nilai-setelah-biaya null SPEND_TIDAK_LENGKAP (bukan 0); peringatan eksplisit", async () => {
  const p = await tool("performa_campaign_meta", { dari: DARI, sampai: "2026-10-12", level: "campaign", batas: 100 });
  const c1 = baris(p.json, CAMP1);
  assert.equal(c1.biaya.spend, 1_500_000);
  assert.equal(c1.biaya.cpaLunas, null); assert.equal(c1.biaya.bookedRoas, null); assert.equal(c1.biaya.cashRoas, null); assert.equal(c1.biaya.nilaiOrderSetelahBiayaIklan, null);
  assert.equal(c1.biaya.alasanNull.cpaLunas, "SPEND_TIDAK_LENGKAP");
  assert.deepEqual(p.json.spend.hariHilang, ["2026-10-11", "2026-10-12"]);
  assert.ok(p.json.peringatan.some((w) => w.kode === "SPEND_TIDAK_LENGKAP"));
  const urut = await tool("performa_campaign_meta", { dari: DARI, sampai: "2026-10-12", urutkan: "cpa_lunas", batas: 100 });
  assert.ok(urut.json.baris.every((b) => b.peringkat === null), "KPI null tidak diperingkat");
  const k = await tool("kesehatan_atribusi_meta", { dari: DARI, sampai: "2026-10-12" });
  assert.equal(k.json.kesiapanKpi.spendLengkap, false);
});

test("hari berjalan: periode memuat hari ini ditandai; tidak error; KPI CRM tidak dihitung dari spend parsial", async () => {
  const { year, month, day } = nowPartsWIB(new Date());
  const hariIni = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const p = await tool("performa_campaign_meta", { dari: hariIni, sampai: hariIni });
  assert.equal(p.isError, false);
  assert.equal(p.json.periodeLead.termasukHariBerjalan, true);
  assert.equal(p.json.total.biaya.cpaLunas, null);
});

test("sebelum atribusi: periode yang dimulai sebelum touch pertama → peringatan & KPI null SEBELUM_ATRIBUSI, 0 lead bukan 'performa nol'", async () => {
  const p = await tool("performa_campaign_meta", { dari: "2026-09-20", sampai: "2026-09-28" });
  assert.equal(p.json.total.akuisisi.leadTerbukti, 0);
  assert.ok(p.json.peringatan.some((w) => w.kode === "RENTANG_SEBELUM_ATRIBUSI"));
  assert.equal(p.json.total.biaya.alasanNull.cpaLunas, "SEBELUM_ATRIBUSI");
});

// ── 4. RBAC, read-only, PII, kompatibilitas, konkurensi ─────────────────────────────────────────────────────────────────────────────────────
test("RBAC: MCP tanpa/dengan token salah 401; endpoint laporan: tanpa token 401, SALES 403, ADMIN 200", async () => {
  assert.equal((await rpc("tools/list", {}, null)).status, 401);
  assert.equal((await rpc("tools/list", {}, "salah")).status, 401);
  assert.equal((await api(`/?${Q}`, { token: null })).status, 401);
  assert.equal((await api(`/?${Q}`, { token: tokenSales })).status, 403);
  assert.equal((await api(`/?${Q}`)).status, 200);
});

test("READ-ONLY: memanggil ketiga tool (semua level, rekap, kesehatan) tidak mengubah satu baris pun", async () => {
  const sebelum = await jumlahBaris();
  for (const level of ["campaign", "adset", "ad"]) await tool("performa_campaign_meta", { dari: DARI, sampai: SAMPAI, level });
  await tool("rekap_harian_meta", { dari: DARI, sampai: SAMPAI });
  await tool("kesehatan_atribusi_meta", { dari: DARI, sampai: SAMPAI, periksaLintasLevel: true });
  assert.deepEqual(await jumlahBaris(), sebelum);
  const tools = (await rpc("tools/list")).json.result.tools;
  assert.ok(tools.every((x) => x.annotations.readOnlyHint === true));
});

test("tanpa PII: respons tool tidak memuat nama/telepon/ID customer atau order", async () => {
  const kumpul = [
    (await tool("performa_campaign_meta", { dari: DARI, sampai: SAMPAI, level: "ad", batas: 100 })).teks,
    (await tool("rekap_harian_meta", { dari: DARI, sampai: SAMPAI })).teks,
    (await tool("kesehatan_atribusi_meta", { dari: DARI, sampai: SAMPAI, periksaLintasLevel: true })).teks,
  ].join("\n");
  const ids = [...(await testPrisma.customer.findMany({ select: { id: true } })).map((c) => c.id), ...(await testPrisma.order.findMany({ select: { id: true, orderNumber: true } })).flatMap((o) => [o.id, o.orderNumber].filter(Boolean))];
  assert.ok(ids.length > 10);
  for (const id of ids) assert.ok(!kumpul.includes(String(id)), `ID bocor: ${id}`);
  for (const pola of ["6285301", "Pelanggan Uji", "Admin MCP", "Sales MCP", "@example.test", "ctwaClid", "customerId"]) assert.ok(!kumpul.includes(pola), `bocor: ${pola}`);
});

test("tool legacy performa_iklan tetap berfungsi dengan bentuk lama (kompatibel)", async () => {
  const lama = await tool("performa_iklan", { dari: DARI, sampai: SAMPAI });
  assert.equal(lama.isError, false);
  for (const kunci of ["periode", "totalLead", "perSumberLead", "perKreatifIklanMeta", "cakupanCtwa", "catatan"]) assert.ok(kunci in lama.json, kunci);
  assert.equal(lama.json.totalLead, 12, "legacy menghitung semua customer dibuat di rentang (termasuk organik)");
});

test("penjaga bersama: panggilan MCP dan endpoint bersamaan tidak membuat MCP gagal (MCP antre; endpoint boleh 429)", async () => {
  const [a, b, c] = await Promise.all([
    tool("performa_campaign_meta", { dari: DARI, sampai: SAMPAI, level: "ad" }),
    api(`/?${Q}&level=ad`),
    tool("rekap_harian_meta", { dari: DARI, sampai: "2026-10-05" }),
  ]);
  assert.equal(a.isError, false); assert.equal(c.isError, false);
  assert.ok([200, 429].includes(b.status), `endpoint ${b.status}`);
  if (b.status === 429) assert.equal(b.json.code, "SEDANG_DIHITUNG");
  assert.equal((await api(`/?${Q}&level=ad`)).status, 200, "setelah selesai, endpoint normal lagi");
});

test("parameter salah → isError dengan kode, bukan crash; filter drilldown campaignId → ad set", async () => {
  const salah = await tool("performa_campaign_meta", { dari: DARI });
  assert.equal(salah.isError, true); assert.equal(salah.json.kode, "PARAMETER_TIDAK_VALID");
  const dd = await tool("performa_campaign_meta", { dari: DARI, sampai: SAMPAI, level: "adset", campaignId: CAMP1, batas: 100 });
  assert.equal(dd.isError, false);
  assert.deepEqual(dd.json.baris.map((b) => b.kunci).sort(), [SET1, SET2].sort());
  assert.equal(dd.json.total.akuisisi.leadTerbukti, 9, "total drilldown = campaign");
  assert.equal(dd.json.tidakTerpetakan.length, 0, "drilldown tidak memuat UNMAPPED lintas campaign");
  const kecil = await kesehatanAtribusi(prisma, { dari: DARI, sampai: SAMPAI });
  assert.equal(kecil.rekonsiliasiLintasLevel, null, "lintas level hanya bila diminta");
});
