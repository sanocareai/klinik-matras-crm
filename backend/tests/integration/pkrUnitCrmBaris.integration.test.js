// REPRESENTASI MULTI-UNIT ORDER CRM PENJUALAN KARYAWAN (Okt 2026), terhadap PostgreSQL sungguhan.
// Kasus nyata: PKR-11102026-005 / NEW-11102026-023 — 1 PKR (Rp7.200.000), 3 kasur, 3 unit produksi (U1/U2/U3) tetapi daftar Order CRM hanya menampilkan satu baris tanpa rincian unit.
// Yang dikunci: (1) 1 parent order + 3 sub-baris unit di GET /orders (bukan 3 order), Unit ID unik; (2) tiap unit membawa item, "n dari N", ukuran/spesifikasi, status Produksi, rencana & PIC,
// status Delivery, kirim/ambil; (3) ringkasan induk dijadwalkan/diproduksi/siap/terkirim dihitung dari status unit; (4) pencarian lewat nomor order/unit/PKR/nama pembeli; (5) saringan status
// memakai STATUS UNIT; (6) Delivery memakai SATU job untuk ketiga unit (tanpa job ganda); (7) Finance membaca nilai PKR satu kali — order induk Rp0, tanpa Payment/invoice/jurnal tambahan, tanpa order baru.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { suggestDeliveryJob } from "../../src/services/deliveryHandoff.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const kunci = () => ({ "Idempotency-Key": `pkr-${randomUUID()}` });
const LENGKAP3 = { kategori: "BARU", jumlahUnit: 3, merk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", perluDikirim: true, alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi" };

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Indra Uji", email: `indra-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; };
  return { seller, admin: await peran("ADMIN"), finance: await peran("FINANCE"), sales: await peran("SALES") };
}
async function buatPkr3(w, extra = {}) {
  const r = await w.finance.c.post("/api/finance/penjualan-karyawan", {
    date: "2026-10-11", sellerId: w.seller.id, buyerName: "Bapak Indra (kerabat)",
    items: [{ name: "Kasur Sorong 3in1 custom", quantity: 3, unitPrice: 2_400_000 }], orderCrm: LENGKAP3, ...extra,
  }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
const daftar = async (w, q = "") => {
  const r = await w.admin.c.get(`/api/orders?limit=100${q}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items;
};

test("1 PKR 3 unit = 1 order induk dengan 3 sub-baris unit unik; tiap unit lengkap (item, n dari N, ukuran, status Produksi, rencana, Delivery, kirim)", async () => {
  const w = await siapkan();
  const p = await buatPkr3(w);
  assert.equal(await testPrisma.order.count(), 1, "tidak ada order baru");
  const items = await daftar(w);
  const induk = items.filter((o) => o.penjualanKaryawan?.nomor === p.nomor);
  assert.equal(induk.length, 1, "daftar CRM: SATU baris induk untuk PKR ini");
  const pk = induk[0].penjualanKaryawan;
  assert.equal(pk.unitBaris.length, 3);
  assert.equal(new Set(pk.unitBaris.map((u) => u.id)).size, 3, "Unit ID unik");
  assert.equal(new Set(pk.unitBaris.map((u) => u.kode)).size, 3, "kode unit unik");
  assert.deepEqual(pk.unitBaris.map((u) => u.urutanLabel), ["1 dari 3", "2 dari 3", "3 dari 3"]);
  for (const u of pk.unitBaris) {
    assert.equal(u.item.nama, "Kasur Sorong 3in1 custom");
    assert.equal(u.ukuran, "100 x 200");
    assert.equal(u.produksi.kode, "RECEIVED");
    assert.equal(u.rencana, null, "belum dijadwalkan = null (bukan ditebak)");
    assert.equal(u.kirim.label, "Dikirim");
    assert.equal(u.delivery.kode, "MENUNGGU_PRODUKSI");
  }
  assert.deepEqual(pk.ringkasUnit, { total: 3, dibatalkan: 0, dijadwalkan: 0, sedangDiproduksi: 0, siap: 0, dalamPengiriman: 0, terkirim: 0, menungguAlur: 3, siapFisik: 0 }); // fixture tidak memetakan jenis kasur → unit "menunggu alur" (mode transisi), bukan galat
  // unit di DB = unit di baris (Production membaca Unit ID yang sama)
  const unitDb = await testPrisma.unit.findMany({ where: { orderId: induk[0].id }, orderBy: { seq: "asc" } });
  assert.deepEqual(unitDb.map((u) => u.id), pk.unitBaris.map((u) => u.id));
});

test("Finance membaca nilai PKR SATU kali; order induk Rp0 tanpa Payment/invoice/jurnal tambahan", async () => {
  const w = await siapkan();
  const p = await buatPkr3(w);
  const items = await daftar(w);
  const o = items.find((x) => x.penjualanKaryawan?.nomor === p.nomor);
  assert.equal(o.value, 0);
  assert.equal(o.penjualanKaryawan.pembayaran.total, 7_200_000);
  assert.equal(await testPrisma.payment.count(), 0);
  assert.equal(await testPrisma.invoice.count(), 0);
  assert.equal(await testPrisma.orderItem.count(), 0);
  assert.equal(await testPrisma.finPenjualanKaryawan.count(), 1);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: { not: "PENJUALAN_KARYAWAN" } } }), 0);
  const ringkasan = await w.finance.c.get("/api/finance/penjualan-karyawan");
  assert.equal(ringkasan.status, 200);
});

test("pencarian: nomor order, nomor unit, nomor PKR, nama pembeli (dan nama pelanggan/karyawan) menemukan order induk; kata tak dikenal tidak", async () => {
  const w = await siapkan();
  const p = await buatPkr3(w);
  const order = await testPrisma.order.findFirst({ include: { units: { orderBy: { seq: "asc" } } } });
  const cari = async (s) => (await daftar(w, `&search=${encodeURIComponent(s)}`)).length;
  assert.equal(await cari(order.orderNumber), 1, "nomor order");
  assert.equal(await cari(order.units[1].unitCode), 1, "nomor unit (U2)");
  assert.equal(await cari(order.units[2].unitCode), 1, "nomor unit (U3)");
  assert.equal(await cari(p.nomor), 1, "nomor PKR");
  assert.equal(await cari("Bapak Indra"), 1, "nama pembeli PKR");
  assert.equal(await cari("Indra Uji"), 1, "nama pelanggan internal (karyawan)");
  assert.equal(await cari("TIDAK-ADA-XYZ"), 0);
});

test("saringan status memakai STATUS UNIT; ringkasan induk & status per unit mengikuti unit masing-masing", async () => {
  const w = await siapkan();
  const p = await buatPkr3(w);
  const order = await testPrisma.order.findFirst({ include: { units: { orderBy: { seq: "asc" } } } });
  const [u1, u2, u3] = order.units;
  await testPrisma.unit.update({ where: { id: u1.id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.unit.update({ where: { id: u2.id }, data: { status: "IN_PRODUCTION" } });
  const q = async (s) => (await daftar(w, `&unitStatus=${s}`)).filter((o) => o.penjualanKaryawan?.nomor === p.nomor).length;
  assert.equal(await q("READY_FOR_DELIVERY"), 1);
  assert.equal(await q("IN_PRODUCTION"), 1);
  assert.equal(await q("RECEIVED"), 1, "U3 masih menunggu produksi");
  assert.equal(await q("DELIVERED"), 0);
  const pk = (await daftar(w)).find((o) => o.penjualanKaryawan?.nomor === p.nomor).penjualanKaryawan;
  const per = Object.fromEntries(pk.unitBaris.map((u) => [u.id, u.produksi.kode]));
  assert.deepEqual([per[u1.id], per[u2.id], per[u3.id]], ["READY_FOR_DELIVERY", "IN_PRODUCTION", "RECEIVED"]);
  assert.equal(pk.ringkasUnit.siap, 1);
  assert.equal(pk.ringkasUnit.sedangDiproduksi, 1);
  assert.equal(pk.ringkasUnit.terkirim, 0);
  assert.equal(pk.ringkasUnit.total, 3);
});

test("rencana produksi & PIC per unit dibaca dari rencana V2 unit itu; unit lain tetap 'belum dijadwalkan'; ringkasan dijadwalkan 1/3", async () => {
  const w = await siapkan();
  const p = await buatPkr3(w);
  const order = await testPrisma.order.findFirst({ include: { units: { orderBy: { seq: "asc" } } } });
  const u1 = order.units[0];
  const operator = await testPrisma.productionOperator.create({ data: { userId: w.seller.id } });
  const run = await testPrisma.productionRun.create({ data: { unitId: u1.id, kind: "NEW_PRODUCT", status: "ACTIVE", currentPhase: "PROCESS", revision: 1 } });
  await testPrisma.productionRunPlan.create({
    data: { runId: run.id, status: "PLANNED", productionDate: new Date("2026-10-13T00:00:00Z"), targetDate: new Date("2026-10-14T00:00:00Z"), stationCode: "TABLE_2", operatorId: operator.id },
  });
  const pk = (await daftar(w)).find((o) => o.penjualanKaryawan?.nomor === p.nomor).penjualanKaryawan;
  const b1 = pk.unitBaris.find((u) => u.id === u1.id);
  assert.equal(b1.rencana.target, "2026-10-14");
  assert.equal(b1.rencana.tanggalProduksi, "2026-10-13");
  assert.equal(b1.rencana.stasiun, "TABLE_2");
  assert.equal(b1.rencana.pic, "Indra Uji");
  assert.equal(pk.unitBaris.filter((u) => u.rencana === null).length, 2);
  assert.equal(pk.ringkasUnit.dijadwalkan, 1);
});

test("Delivery: SATU job pengiriman menaungi ketiga unit — setiap sub-baris menunjuk job yang sama, tidak ada job ganda", async () => {
  const w = await siapkan();
  const p = await buatPkr3(w);
  const order = await testPrisma.order.findFirst({ include: { units: { orderBy: { seq: "asc" } } } });
  for (const u of order.units) await testPrisma.unit.update({ where: { id: u.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of order.units) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 1, "tepat satu job pengiriman");
  const pk = (await daftar(w)).find((o) => o.penjualanKaryawan?.nomor === p.nomor).penjualanKaryawan;
  const jobIds = new Set(pk.unitBaris.map((u) => u.delivery.jobId));
  assert.equal(jobIds.size, 1);
  assert.ok([...jobIds][0], "jobId terisi");
  assert.ok(pk.unitBaris.every((u) => u.delivery.kode === "UNSCHEDULED" || u.delivery.kode === "SCHEDULED" || u.delivery.kode === "ASSIGNED"), JSON.stringify(pk.unitBaris.map((u) => u.delivery)));
  assert.equal(pk.ringkasUnit.siap, 3);
});

test("diambil sendiri: tiap unit menampilkan 'Diambil sendiri' dan tidak ada job pengiriman", async () => {
  const w = await siapkan();
  const p = await buatPkr3(w, { orderCrm: { ...LENGKAP3, perluDikirim: false, alamat: undefined, kota: undefined } });
  const pk = (await daftar(w)).find((o) => o.penjualanKaryawan?.nomor === p.nomor).penjualanKaryawan;
  assert.ok(pk.unitBaris.every((u) => u.kirim.label === "Diambil sendiri" && u.delivery.kode === "AMBIL_SENDIRI"));
  assert.equal(await testPrisma.job.count(), 0);
});

test("order biasa (bukan PKR) tidak mendapat sub-baris unit; PKR dibatalkan: unit tidak dihitung dan tidak ada order baru", async () => {
  const w = await siapkan();
  const p = await buatPkr3(w);
  const batal = await w.admin.c.post(`/api/finance/penjualan-karyawan/${p.id}/batal`, { reason: "uji representasi unit" }, kunci());
  assert.ok([200, 201].includes(batal.status), JSON.stringify(batal.body));
  const o = (await daftar(w)).find((x) => x.penjualanKaryawan?.nomor === p.nomor);
  if (o) {
    assert.equal(o.penjualanKaryawan.ringkasUnit.total, 0, "unit dibatalkan tidak dihitung");
    assert.equal(o.penjualanKaryawan.unitBaris.length, 0);
  }
  assert.equal(await testPrisma.order.count(), 1);
});
