// UKUR PERFORMA laporan atribusi iklan pada volume setara produksi (MANUAL — tidak masuk glob default).
// Jalankan: node tests/integration/setup/runDisposable.js tests/integration/perf/atribusiIklan.perf.manual.test.js
// PERF_SCALE (default "1,10"): kelipatan volume produksi 12 Okt 2026 (9.657 customer, 693 order, 299 payment). Data sintetis, tanpa identitas nyata.
process.env.WAHA_BASE_URL = "http://127.0.0.1:9";
await import("../setup/env.js");
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { testPrisma, truncateAll } = await import("../setup/testDb.js");
const { hitungLaporanIklan, parseParameterIklan } = await import("../../../src/services/attribution/iklanReport.js");

const PROD = { customers: 9657, orders: 693, payments: 299 };
const SKALA = (process.env.PERF_SCALE || "1,10").split(",").map(Number);
const NOW = new Date("2026-10-12T05:00:00Z");
const HARI = 86_400_000;
const potong = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const rata = (a) => a.reduce((x, y) => x + y, 0) / a.length;

async function semai(k) {
  await truncateAll();
  await testPrisma.metaAdReference.deleteMany({});
  const admin = await testPrisma.user.create({ data: { name: "Perf Admin", email: `perf-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  const nCust = PROD.customers * k, nOrd = PROD.orders * k, nPay = PROD.payments * k;
  const custs = Array.from({ length: nCust }, (_, i) => ({
    id: `perfc${String(i).padStart(7, "0")}`, name: "Perf", phone: `62899${String(i).padStart(8, "0")}`,
    createdAt: new Date(NOW.getTime() - (i % 90) * HARI - (i % 1440) * 60_000), leadSource: i % 3 === 0 ? "META_ADS" : "WHATSAPP_DIRECT",
    pipelineStage: i % 25 === 0 ? "SPAM" : i % 7 === 0 ? "PROSPECT" : "NEW",
  }));
  for (const b of potong(custs, 5000)) await testPrisma.customer.createMany({ data: b });
  const ords = Array.from({ length: nOrd }, (_, i) => ({
    id: `perfo${String(i).padStart(7, "0")}`, customerId: custs[(i * 13) % nCust].id, createdAt: new Date(NOW.getTime() - (i % 80) * HARI), value: 1_000_000 + (i % 9) * 500_000,
    status: "PROCESSING", paymentStatus: i % 3 === 0 ? "LUNAS" : i % 3 === 1 ? "DP" : "BELUM_BAYAR",
    paidAt: i % 3 === 0 ? new Date(NOW.getTime() - (i % 70) * HARI) : null,
  }));
  for (const b of potong(ords, 5000)) await testPrisma.order.createMany({ data: b });
  const pays = Array.from({ length: nPay }, (_, i) => ({
    orderId: ords[i % nOrd].id, amount: 500_000 + (i % 5) * 250_000, method: "TRANSFER", recordedById: admin.id, createdAt: new Date(NOW.getTime() - (i % 70) * HARI),
  }));
  for (const b of potong(pays, 5000)) await testPrisma.payment.createMany({ data: b });
  // 20 Ad ID (17 terpetakan, 3 tidak) ; ±35% customer punya touch akuisisi; ±5% punya touch kedua
  const adIds = Array.from({ length: 20 }, (_, i) => String(52690000000000 + i * 200 + 84));
  await testPrisma.metaAdReference.createMany({ data: adIds.slice(0, 17).map((a, i) => ({
    adId: a, adSetId: String(52691000000000 + Math.floor(i / 2) * 200 + 84), campaignId: String(52692000000000 + Math.floor(i / 5) * 200 + 84), source: "MANUAL", syncedAt: NOW,
  })) });
  const touches = []; let n = 0;
  const wib = (d) => new Date(new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10) + "T00:00:00Z");
  custs.forEach((c, i) => {
    if (i % 20 < 7) touches.push({ customerId: c.id, adId: adIds[i % 20], touchAt: new Date(c.createdAt.getTime() + 60_000), touchDateWib: wib(new Date(c.createdAt.getTime() + 60_000)), mappingStatusAtTouch: "UNMAPPED", evidenceSource: "CTWA_AD", sourceType: "ad", customerNewAtTouch: true, dedupeKey: `perf:${n++}` });
    if (i % 20 === 3) touches.push({ customerId: c.id, adId: adIds[(i + 5) % 20], touchAt: new Date(c.createdAt.getTime() + 3 * HARI), touchDateWib: wib(new Date(c.createdAt.getTime() + 3 * HARI)), mappingStatusAtTouch: "UNMAPPED", evidenceSource: "CTWA_AD", sourceType: "ad", customerNewAtTouch: false, dedupeKey: `perf:${n++}` });
  });
  for (const b of potong(touches, 5000)) await testPrisma.attributionTouch.createMany({ data: b });
  await testPrisma.$executeRawUnsafe("ANALYZE");
  return { nCust, nOrd, nPay, nTouch: touches.length };
}

for (const k of SKALA) {
  test(`performa laporan iklan pada ${k}× volume produksi`, { timeout: 600_000 }, async () => {
    const seed = await semai(k);
    const out = { skala: `${k}x`, ...seed, hasil: [] };
    for (const level of ["campaign", "ad"]) {
      for (const rentang of [["2026-10-01", "2026-10-11"], ["2026-07-14", "2026-10-11"]]) {
        const p = parseParameterIklan({ dari: rentang[0], sampai: rentang[1], level, rincian: "1" }, NOW);
        const waktu = [];
        let j;
        for (let r = 0; r < 3; r++) { const t = process.hrtime.bigint(); j = await hitungLaporanIklan(testPrisma, p, { now: NOW, timeoutMs: 60_000 }); waktu.push(Number(process.hrtime.bigint() - t) / 1e6); }
        assert.equal(j.rekonsiliasi.ok, true, JSON.stringify(j.rekonsiliasi.cek.filter((c) => !c.ok)));
        out.hasil.push({ level, rentang: rentang.join("..."), grup: j.jumlahGrup, leadUnik: j.jumlahTeratribusi.leadUnik, ms_rata: Math.round(rata(waktu)), ms_maks: Math.round(Math.max(...waktu)) });
      }
    }
    // rencana kueri dua kueri touch utama (tanpa data pribadi)
    const plan = async (sql) => (await testPrisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`)).map((r) => r["QUERY PLAN"]);
    const rencana1 = await plan(`SELECT t.id FROM attribution_touches t JOIN "Customer" c ON c.id = t.customer_id WHERE c."createdAt" >= '2026-07-14' AND c."createdAt" < '2026-10-11' AND t.evidence_source = 'CTWA_AD' AND t.customer_new_at_touch`);
    const rencana2 = await plan(`SELECT t.id FROM attribution_touches t WHERE t.touch_date_wib >= '2026-07-14' AND t.touch_date_wib <= '2026-10-11' AND t.evidence_source = 'CTWA_AD'`);
    out.rencana = { touchAkuisisi: rencana1.filter((l) => /Execution Time|Scan|Join/.test(l)).slice(0, 6), touchLain: rencana2.filter((l) => /Execution Time|Scan/.test(l)).slice(0, 4) };
    console.log("PERF " + JSON.stringify(out, null, 1));
    // batas longgar: laporan harus tetap interaktif pada 10× produksi
    for (const h of out.hasil) assert.ok(h.ms_maks < 15_000, `lambat: ${JSON.stringify(h)}`);
  });
}
test.after(async () => { await testPrisma.$disconnect(); });
