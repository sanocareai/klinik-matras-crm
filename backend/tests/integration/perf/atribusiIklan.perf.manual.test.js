// UKUR PERFORMA laporan atribusi iklan pada volume setara produksi (MANUAL — tidak masuk glob default).
// Jalankan: node tests/integration/setup/runDisposable.js tests/integration/perf/atribusiIklan.perf.manual.test.js
// PERF_SCALE (default "1,3,10"): kelipatan volume produksi 12 Okt 2026 (9.657 customer, 693 order, 299 payment). PERF_RUNS (default 15) pengulangan per konfigurasi.
// Data SINTETIS (tanpa identitas nyata) pada satu instance PostgreSQL lokal; angka mewakili beban DB + Node, bukan latensi jaringan produksi.
// Keluaran: p50/p95/maks per konfigurasi, rincian durasi per kueri (dari log kueri Prisma), dan EXPLAIN ANALYZE kueri berat.
process.env.WAHA_BASE_URL = "http://127.0.0.1:9";
await import("../setup/env.js");
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { PrismaClient } = await import("@prisma/client");
const { testPrisma, truncateAll } = await import("../setup/testDb.js");
const { hitungLaporanIklan, parseParameterIklan, MAKS_HARI } = await import("../../../src/services/attribution/iklanReport.js");

const PROD = { customers: 9657, orders: 693, payments: 299 };
const SKALA = (process.env.PERF_SCALE || "1,3,10").split(",").map(Number);
const RUNS = Number(process.env.PERF_RUNS || 15);
const NOW = new Date("2026-10-12T05:00:00Z");
const HARI = 86_400_000;
const potong = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const persen = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const bulat = (x) => Math.round(x);

async function semai(k) {
  await truncateAll();
  await testPrisma.metaAdReference.deleteMany({});
  const admin = await testPrisma.user.create({ data: { name: "Perf Admin", email: `perf-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  const nCust = PROD.customers * k, nOrd = PROD.orders * k, nPay = PROD.payments * k;
  // customer tersebar 93 hari terakhir (produksi: 9.144 dari 9.657 dibuat dalam 90 hari)
  const custs = Array.from({ length: nCust }, (_, i) => ({
    id: `perfc${String(i).padStart(7, "0")}`, name: "Perf", phone: `62899${String(i).padStart(8, "0")}`,
    createdAt: new Date(NOW.getTime() - (i % 93) * HARI - (i % 1440) * 60_000), leadSource: i % 3 === 0 ? "META_ADS" : "WHATSAPP_DIRECT",
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
  // 24 Ad ID (20 terpetakan); ±35% customer punya touch akuisisi, ±5% touch kedua, ±1% audit tanpa penanda
  const adIds = Array.from({ length: 24 }, (_, i) => String(52690000000000 + i * 200 + 84));
  await testPrisma.metaAdReference.createMany({ data: adIds.slice(0, 20).map((a, i) => ({
    adId: a, adSetId: String(52691000000000 + Math.floor(i / 2) * 200 + 84), campaignId: String(52692000000000 + Math.floor(i / 5) * 200 + 84), source: "MANUAL", syncedAt: NOW,
  })) });
  const touches = []; let n = 0;
  const wib = (d) => new Date(new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10) + "T00:00:00Z");
  const t = (c, ms, o) => { const at = new Date(c.createdAt.getTime() + ms); return { customerId: c.id, touchAt: at, touchDateWib: wib(at), mappingStatusAtTouch: "UNMAPPED", sourceType: "ad", dedupeKey: `perf:${n++}`, ...o }; };
  custs.forEach((c, i) => {
    if (i % 20 < 7) touches.push(t(c, 60_000, { adId: adIds[i % 24], evidenceSource: "CTWA_AD", customerStatusAtTouch: "NEW", customerBasisAtTouch: "WEBHOOK_MEMBUAT" }));
    if (i % 20 === 3) touches.push(t(c, 3 * HARI, { adId: adIds[(i + 5) % 24], evidenceSource: "CTWA_AD", customerStatusAtTouch: "EXISTING", customerBasisAtTouch: "RIWAYAT_PESAN" }));
    if (i % 100 === 9) touches.push(t(c, 120_000, { adId: adIds[(i + 1) % 24], evidenceSource: "AD_REPLY_UNMARKED", customerStatusAtTouch: "NEW", customerBasisAtTouch: "WEBHOOK_MEMBUAT" }));
  });
  for (const b of potong(touches, 5000)) await testPrisma.attributionTouch.createMany({ data: b });
  await testPrisma.$executeRawUnsafe("ANALYZE");
  return { nCust, nOrd, nPay, nTouch: touches.length };
}

const literal = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" || typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
function isiParam(sql, params) {
  let s = sql;
  for (let i = params.length; i >= 1; i--) s = s.split(`$${i}`).join(literal(params[i - 1]));
  return s;
}

for (const k of SKALA) {
  test(`performa laporan iklan pada ${k}× volume produksi (${RUNS} pengulangan)`, { timeout: 1_800_000 }, async () => {
    const seed = await semai(k);
    const klien = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    const kueri = [];
    klien.$on("query", (e) => kueri.push({ sql: e.query, params: e.params, ms: e.duration }));
    const out = { skala: `${k}x`, ...seed, runs: RUNS, hasil: [] };
    try {
      const konfig = [];
      for (const hari of [7, 30, MAKS_HARI]) for (const level of ["campaign", "ad"]) konfig.push({ hari, level, rincian: false });
      konfig.push({ hari: MAKS_HARI, level: "ad", rincian: true });
      for (const c of konfig) {
        const dari = new Date(Date.parse("2026-10-11T00:00:00Z") - (c.hari - 1) * HARI).toISOString().slice(0, 10);
        const p = parseParameterIklan({ dari, sampai: "2026-10-11", level: c.level, rincian: c.rincian ? "1" : "0" }, NOW);
        await hitungLaporanIklan(klien, p, { now: NOW, timeoutMs: 60_000 });           // pemanasan (cache Postgres + JIT)
        const waktu = []; let j;
        for (let r = 0; r < RUNS; r++) { const t0 = process.hrtime.bigint(); j = await hitungLaporanIklan(klien, p, { now: NOW, timeoutMs: 60_000 }); waktu.push(Number(process.hrtime.bigint() - t0) / 1e6); }
        assert.equal(j.rekonsiliasi.ok, true, JSON.stringify(j.rekonsiliasi.cek.filter((x) => !x.ok)));
        console.error(`[perf] ${k}x hari=${c.hari} level=${c.level} rincian=${c.rincian} p50=${bulat(persen(waktu, 50))}ms`);
        out.hasil.push({ hari: c.hari, level: c.level, rincian: c.rincian, leadUnik: j.jumlahTeratribusi.leadUnik, grup: j.jumlahGrup, p50_ms: bulat(persen(waktu, 50)), p95_ms: bulat(persen(waktu, 95)), maks_ms: bulat(Math.max(...waktu)) });
      }
      // rincian per kueri untuk satu eksekusi rentang terpanjang / level ad
      kueri.length = 0;
      const pBerat = parseParameterIklan({ dari: new Date(Date.parse("2026-10-11T00:00:00Z") - (MAKS_HARI - 1) * HARI).toISOString().slice(0, 10), sampai: "2026-10-11", level: "ad" }, NOW);
      await hitungLaporanIklan(klien, pBerat, { now: NOW, timeoutMs: 60_000 });
      const selects = kueri.filter((q) => /^\s*SELECT/i.test(q.sql));
      out.kueri = {
        jumlah: kueri.length, totalMs: bulat(kueri.reduce((s, q) => s + q.ms, 0)),
        teratas: [...kueri].sort((a, b) => b.ms - a.ms).slice(0, 6).map((q) => ({ ms: bulat(q.ms), sql: q.sql.replace(/\s+/g, " ").slice(0, 110) })),
      };
      // EXPLAIN ANALYZE tiga SELECT terberat (parameter diisi literal dari log; data sintetis)
      out.rencana = [];
      for (const q of [...selects].sort((a, b) => b.ms - a.ms).slice(0, 3)) {
        let params = []; try { params = JSON.parse(q.params); } catch { /* tanpa param */ }
        let baris;
        try { baris = (await testPrisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${isiParam(q.sql, params)}`)).map((r) => r["QUERY PLAN"]); }
        catch (e) { out.rencana.push({ sql: q.sql.replace(/\s+/g, " ").slice(0, 90), galat: String(e.code || e.name) }); continue; }
        out.rencana.push({
          sql: q.sql.replace(/\s+/g, " ").slice(0, 90),
          simpul: baris.filter((l) => /(Seq Scan|Index Scan|Index Only Scan|Bitmap (Heap|Index) Scan|Hash Join|Nested Loop|Merge Join)/.test(l)).map((l) => l.trim().replace(/\(cost=[^)]*\)\s*/, "")).slice(0, 5),
          waktuEksekusi: (baris.find((l) => /Execution Time/.test(l)) || "").trim(),
        });
      }
      out.indeks = (await testPrisma.$queryRawUnsafe(
        `SELECT tablename, indexname FROM pg_indexes WHERE tablename IN ('attribution_touches','meta_ad_references') ORDER BY 1,2`)).map((r) => `${r.tablename}.${r.indexname}`);
    } finally { await klien.$disconnect(); }
    console.log("PERF " + JSON.stringify(out, null, 1));
    // batas: pada 10× volume produksi laporan rentang maksimum tetap interaktif
    if (k >= 10) for (const h of out.hasil) assert.ok(h.p95_ms < 10_000, `p95 terlalu lambat: ${JSON.stringify(h)}`);
    else for (const h of out.hasil) assert.ok(h.p95_ms < 5_000, `p95 terlalu lambat: ${JSON.stringify(h)}`);
  });
}
test.after(async () => { await testPrisma.$disconnect(); });
