// Simplifikasi Production slice 1 — HTTP nyata di DB uji terisolasi: (1) audit sumber Komplain (ComplaintCase resmi, bukan teks/bendera), (2) backlog Rencana default
// Diproses + order nyata, tanpa Siap Kirim/Terkirim, urutan Komplain dulu, (3) paginasi tanpa batas 500, (4) filter status tampilan work-orders, (5) izin tidak melebar.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server; let lead; let driver; let sales;
let n = 0;
test.before(async () => {
  await truncateAll(); server = await startTestServer(buildTestApp());
  for (const [k, roles] of [["lead", ["PRODUCTION_LEAD"]], ["driver", ["DRIVER"]], ["sales", ["SALES"]]]) { const u = await createTestUser({ roles }); const c = makeClient(server.baseUrl, u.token); if (k === "lead") lead = c; else if (k === "driver") driver = c; else sales = c; }
});
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function mkOrder({ status = "PROCESSING", stage = "NEW", staff = false, notes = null, hasComplaint = false, complaintCategory = [] } = {}) {
  n += 1;
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan S1-${n}`, pipelineStage: stage, isInternalStaff: staff } });
  return testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-S1-${n}`, value: 1_000_000, category: "LAYANAN", status, notes, hasComplaint, complaintCategory } });
}
let seq = 0;
const mkUnit = (order, unitStatus = "IN_PRODUCTION", extra = {}) => testPrisma.unit.create({ data: { unitCode: `S1-${++seq}`, orderId: order.id, seq: seq, status: unitStatus, merk: "Serta", ukuran: "160x200", ...extra } });
const mkCase = (order, unit, status = "BARU") => testPrisma.complaintCase.create({ data: { caseNumber: `CMP-S1-${++seq}`, orderId: order.id, unitId: unit?.id ?? null, category: "KUALITAS_PRODUK", description: "uji", status } });
const wo = async (qs = "") => (await lead.get(`/api/production/work-orders${qs}`)).body;
const backlog = async (qs = "") => (await lead.get(`/api/production-v2/backlog${qs}`));
const byCode = (units) => Object.fromEntries(units.map((u) => [u.unitCode, u]));

test("AUDIT Komplain: hanya ComplaintCase resmi yang masih terbuka; teks catatan, Order.hasComplaint, keluhan kesehatan, kasus SELESAI/DIBATALKAN TIDAK membuat Komplain", async () => {
  const oA = await mkOrder(); const A = await mkUnit(oA); await mkCase(oA, A, "INVESTIGASI");                    // kasus terbuka menyebut unit
  const oB = await mkOrder(); const B = await mkUnit(oB); await mkCase(oB, B, "SELESAI");                         // kasus selesai
  const oB2 = await mkOrder(); const B2 = await mkUnit(oB2); await mkCase(oB2, B2, "DIBATALKAN");                 // kasus dibatalkan
  const oC = await mkOrder(); const C1 = await mkUnit(oC); const C2 = await mkUnit(oC); await mkCase(oC, null, "BARU"); // kasus tingkat order -> semua unit order itu
  const oD = await mkOrder({ notes: "KOMPLAIN keras dari customer, kasur ambles", hasComplaint: true }); const D = await mkUnit(oD); // teks + bendera historis, TANPA kasus resmi
  const oE = await mkOrder({ complaintCategory: ["SAKIT_PINGGANG", "LAINNYA"] }); const E = await mkUnit(oE);  // keluhan kesehatan (diisi Sales)
  const oF = await mkOrder(); const F = await mkUnit(oF); const otherUnit = await mkUnit(oF); await mkCase(oF, otherUnit, "BARU"); // kasus menyebut unit LAIN di order yang sama
  const d = byCode((await wo("?pageSize=200")).units);
  const label = (u) => d[u.unitCode].priorityDisplay.label;
  assert.equal(label(A), "Komplain"); assert.deepEqual(d[A.unitCode].priorityDisplay.complaintCases.length, 1);
  assert.equal(label(B), "Normal", "kasus SELESAI"); assert.equal(label(B2), "Normal", "kasus DIBATALKAN");
  assert.equal(label(C1), "Komplain"); assert.equal(label(C2), "Komplain");
  assert.equal(label(D), "Normal", "teks 'komplain' di catatan & Order.hasComplaint bukan sumber"); assert.equal(label(E), "Normal", "keluhan kesehatan bukan komplain");
  assert.equal(label(F), "Normal", "kasus unit lain di order yang sama tidak menular ke unit ini"); assert.equal(label(otherUnit), "Komplain");
  // kasus ditutup -> kembali Normal (turunan hidup, tidak tersimpan)
  await testPrisma.complaintCase.updateMany({ where: { orderId: oA.id }, data: { status: "SELESAI" } });
  assert.equal(byCode((await wo("?pageSize=200")).units)[A.unitCode].priorityDisplay.label, "Normal");
  await testPrisma.complaintCase.updateMany({ where: { orderId: oA.id }, data: { status: "VERIFIKASI" } });
  assert.equal(byCode((await wo("?pageSize=200")).units)[A.unitCode].priorityDisplay.label, "Komplain", "dibuka lagi -> Komplain lagi");
});

test("prioritas lama: Mendesak/Kritis tampil Tinggi (nilai tersimpan tidak diubah); pilihan pengguna hanya Normal/Tinggi", async () => {
  const o = await mkOrder(); const U = await mkUnit(o, "IN_PRODUCTION", { priority: "URGENT" }); const K = await mkUnit(o, "IN_PRODUCTION", { priority: "CRITICAL" }); const T = await mkUnit(o, "IN_PRODUCTION", { priority: "HIGH" });
  const d = byCode((await wo("?pageSize=200")).units);
  for (const u of [U, K, T]) assert.equal(d[u.unitCode].priorityDisplay.label, "Tinggi");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: U.id } })).priority, "URGENT", "data tersimpan utuh");
  assert.equal(d[U.unitCode].priority, "URGENT", "enum mentah tetap tersedia");
});

test("backlog default: order nyata Diproses + unit Diproses; Siap Kirim/Terkirim/Pengambilan/SPAM/staf internal/dibatalkan tidak masuk; Komplain di urutan pertama; Tinggi sebelum Normal", async () => {
  await truncateAll();
  const ok = await mkOrder(); const normal = await mkUnit(ok, "RECEIVED"); const tinggi = await mkUnit(ok, "IN_PRODUCTION", { priority: "HIGH" });
  const oK = await mkOrder(); const komplain = await mkUnit(oK, "IN_PRODUCTION"); await mkCase(oK, komplain, "BARU");
  const oMulti = await mkOrder(); const multiReady = await mkUnit(oMulti, "READY_FOR_DELIVERY"); const multiWip = await mkUnit(oMulti, "IN_PRODUCTION"); // order Diproses (weakest link), satu unit sudah Siap Kirim
  const oReady = await mkOrder({ status: "READY" }); const ready = await mkUnit(oReady, "READY_FOR_DELIVERY");
  const oDone = await mkOrder({ status: "DELIVERED" }); const done = await mkUnit(oDone, "DELIVERED");
  const oPick = await mkOrder({ status: "PICKUP" }); const pick = await mkUnit(oPick, "IN_TRANSIT_IN");
  const oSpam = await mkOrder({ stage: "SPAM" }); const spam = await mkUnit(oSpam, "IN_PRODUCTION");
  const oStaff = await mkOrder({ staff: true }); const staff = await mkUnit(oStaff, "IN_PRODUCTION");
  const oCancel = await mkOrder({ status: "CANCELLED" }); const cancelled = await mkUnit(oCancel, "IN_PRODUCTION");
  const r = await backlog(); assert.equal(r.status, 200, JSON.stringify(r.body));
  const codes = r.body.items.map((i) => i.card.unit.unitCode);
  assert.deepEqual(new Set(codes), new Set([komplain.unitCode, tinggi.unitCode, normal.unitCode, multiWip.unitCode]));
  for (const x of [multiReady, ready, done, pick, spam, staff, cancelled]) assert.ok(!codes.includes(x.unitCode), `${x.unitCode} tidak boleh ada`);
  assert.equal(codes[0], komplain.unitCode, "Komplain pertama"); assert.equal(codes[1], tinggi.unitCode, "Tinggi sebelum Normal");
  assert.equal(r.body.items[0].card.priority.label, "Komplain"); assert.equal(r.body.items[0].card.priority.complaintCases.length, 1);
  assert.equal(r.body.total, 4); assert.equal(r.body.hasMore, false); assert.equal(r.body.truncated, false);
  assert.equal(r.body.items[0].schedulable, false, "reader OFF -> kartu ringkas tanpa tombol jadwal");
  for (const i of r.body.items) { assert.equal(i.card.orderStatus.label, "Diproses"); assert.equal(i.card.unitStatus.label, "Diproses"); assert.equal(i.card.presence.confirmed, false, "tanpa bukti tiba: tidak dipalsukan"); }
  // filter Pengambilan eksplisit: unit Pengambilan muncul, backlog Diproses tidak
  const p = await backlog("?status=PENGAMBILAN"); assert.deepEqual(p.body.items.map((i) => i.card.unit.unitCode), [pick.unitCode]);
  assert.equal(p.body.items[0].card.unitStatus.label, "Pengambilan"); assert.equal(p.body.items[0].card.presence.key, "NOT_ARRIVED");
  assert.deepEqual(p.body.counts, { DIPROSES: 4, PENGAMBILAN: 1 });
  // status tak dikenal (Siap Kirim/Terkirim bukan backlog) jatuh ke default Diproses — tidak pernah memuat unit selesai
  for (const s of ["SIAP_KIRIM", "TERKIRIM", "ngawur"]) { const x = await backlog(`?status=${s}`); assert.equal(x.body.status, "DIPROSES"); assert.ok(!x.body.items.some((i) => [ready, done].some((u) => u.unitCode === i.card.unit.unitCode))); }
  // pencarian
  assert.deepEqual((await backlog(`?q=${normal.unitCode}`)).body.items.map((i) => i.card.unit.unitCode), [normal.unitCode]);
  // Siap Kirim/Terkirim tetap ada (histori utuh) di work-orders
  const dk = await wo("?displayStatus=SIAP_KIRIM"); assert.ok(dk.units.some((u) => u.unitCode === ready.unitCode)); assert.ok(dk.units.some((u) => u.unitCode === multiReady.unitCode));
  assert.ok((await wo("?displayStatus=TERKIRIM")).units.some((u) => u.unitCode === done.unitCode));
});

test("paginasi TANPA batas 500: 620 unit Diproses dibaca habis lewat halaman; tidak ada duplikat/hilang; backlog & work-orders konsisten", async () => {
  await truncateAll();
  const o = await mkOrder();
  const TOTAL = 620;
  await testPrisma.unit.createMany({ data: Array.from({ length: TOTAL }, (_, i) => ({ unitCode: `BIG-${String(i).padStart(4, "0")}`, orderId: o.id, seq: i + 1, status: i % 2 ? "RECEIVED" : "IN_PRODUCTION", merk: "Serta", ukuran: "160x200", createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) })) });
  const first = await backlog("?pageSize=100"); assert.equal(first.body.total, TOTAL); assert.equal(first.body.hasMore, true); assert.equal(first.body.items.length, 100);
  const seen = new Set(); let page = 1; let guard = 0;
  for (;;) {
    const r = await backlog(`?pageSize=100&page=${page}`); assert.equal(r.status, 200);
    for (const i of r.body.items) { assert.ok(!seen.has(i.card.unit.unitCode), "duplikat " + i.card.unit.unitCode); seen.add(i.card.unit.unitCode); }
    if (!r.body.hasMore) break; page += 1; assert.ok(++guard < 20);
  }
  assert.equal(seen.size, TOTAL, "semua 620 terbaca (bukan berhenti di 500)"); assert.equal(page, 7);
  assert.deepEqual([...seen].sort()[0], "BIG-0000"); assert.equal([...seen].sort().at(-1), "BIG-0619");
  // FIFO di dalam peringkat sama
  assert.deepEqual((await backlog("?pageSize=3")).body.items.map((i) => i.card.unit.unitCode), ["BIG-0000", "BIG-0001", "BIG-0002"]);
  // pageSize dibatasi 100 di backlog; work-orders 200
  assert.equal((await backlog("?pageSize=9999")).body.items.length, 100);
  const w1 = await wo("?displayStatus=DIPROSES&pageSize=200&page=1"); assert.equal(w1.total, TOTAL); assert.equal(w1.units.length, 200); assert.equal(w1.hasMore, true); assert.equal(w1.displayStatusCounts.DIPROSES, TOTAL);
  const wSeen = new Set(); let wp = 1;
  for (;;) { const r = await wo(`?displayStatus=DIPROSES&pageSize=200&page=${wp}`); for (const u of r.units) { assert.ok(!wSeen.has(u.id)); wSeen.add(u.id); } if (!r.hasMore) break; wp += 1; assert.ok(wp < 20); }
  assert.equal(wSeen.size, TOTAL);
  const noParam = await wo(); assert.equal(noParam.units.length, 100, "tanpa parameter: halaman 1 berukuran 100 + total/hasMore (bukan seluruh daftar, bukan 500)"); assert.equal(noParam.total, TOTAL); assert.equal(noParam.hasMore, true);
});

test("work-orders: filter displayStatus di server; real=1 menyaring SPAM/staf; status mentah tetap bekerja; label tampilan konsisten", async () => {
  await truncateAll();
  const ok = await mkOrder(); const a = await mkUnit(ok, "IN_PRODUCTION"); const b = await mkUnit(ok, "READY_ON_CUSTOMER_HOLD"); const c = await mkUnit(ok, "IN_TRANSIT_OUT"); const d = await mkUnit(ok, "DELIVERED"); const e = await mkUnit(ok, "AWAITING_PICKUP");
  const sp = await mkOrder({ stage: "SPAM" }); const s1 = await mkUnit(sp, "IN_PRODUCTION");
  assert.deepEqual((await wo("?displayStatus=SIAP_KIRIM")).units.map((u) => u.unitCode).sort(), [b.unitCode, c.unitCode].sort());
  assert.deepEqual((await wo("?displayStatus=TERKIRIM")).units.map((u) => u.unitCode), [d.unitCode]);
  assert.deepEqual((await wo("?displayStatus=PENGAMBILAN")).units.map((u) => u.unitCode), [e.unitCode]);
  assert.deepEqual((await wo("?displayStatus=DIPROSES")).units.map((u) => u.unitCode).sort(), [a.unitCode, s1.unitCode].sort());
  assert.deepEqual((await wo("?displayStatus=DIPROSES&real=1")).units.map((u) => u.unitCode), [a.unitCode], "real=1 menyaring SPAM");
  assert.deepEqual((await wo("?status=DELIVERED")).units.map((u) => u.unitCode), [d.unitCode], "filter status mentah lama tetap");
  const all = byCode((await wo()).units);
  assert.equal(all[c.unitCode].unitStatusDisplay.label, "Siap Kirim"); assert.equal(all[c.unitCode].unitStatusDisplay.detail, "Dalam pengiriman");
  assert.equal(all[d.unitCode].unitStatusDisplay.label, "Terkirim"); assert.equal(all[a.unitCode].orderStatusDisplay.label, "Diproses");
  assert.deepEqual((await wo()).displayStatusCounts, { PENGAMBILAN: 1, DIPROSES: 2, SIAP_KIRIM: 2, TERKIRIM: 1 });
});

test("izin tidak melebar: backlog & work-orders tetap menolak peran tanpa izin baca (Driver 403), peran baca lama (Sales UNIT_READ) tetap 200; tidak ada rute tulis baru", async () => {
  assert.equal((await driver.get("/api/production-v2/backlog")).status, 403);
  assert.equal((await driver.get("/api/production/work-orders")).status, 403);
  assert.equal((await sales.get("/api/production/work-orders")).status, 200);
  assert.equal((await sales.get("/api/production-v2/backlog")).status, 200);
  assert.equal((await lead.post("/api/production-v2/backlog", {})).status, 404, "backlog hanya GET");
});
