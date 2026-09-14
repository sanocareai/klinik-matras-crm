// Tes services/armadaAutoJob.js#ensurePickupJobForOrder — jembatan otomatis
// Sales CRM -> Delivery Hub untuk job PICKUP.
//
// FOKUS D-169 (14 September 2026, laporan owner: "make sure ketika kasur
// sewa sudah selesai statusnya akan pengambilan kembali sesuai sistem") —
// parameter `unitStatus` (default "AWAITING_PICKUP") ditambahkan supaya
// fungsi yang SAMA bisa dipakai ulang untuk kasus retur SEWA (unit
// "DELIVERED", bukan "belum pernah diambil"), dipanggil dari
// routes/orders.js saat dropdown order SEWA diubah ke "Pengambilan
// Kembali". Sengaja TANPA database (tx di-fake) — sama pola dengan
// unitProvisioning.test.js, yang diuji logika murni.

import test from "node:test";
import assert from "node:assert/strict";

import { ensurePickupJobForOrder } from "../src/services/armadaAutoJob.js";

// Fake transaksi Prisma minimal — cukup meniru panggilan yang dipakai
// ensurePickupJobForOrder(): unit.findMany (unit bebas ber-status X),
// job.findFirst (job UNSCHEDULED existing), job.create/update,
// jobUnit.createMany.
function fakeTx({ unitsBebas = [], jobExisting = null } = {}) {
  const jobsDibuat = [];
  const jobUnitLinks = [];
  const jobUpdates = [];
  return {
    jobsDibuat, jobUnitLinks, jobUpdates,
    unit: {
      findMany: async ({ where }) => unitsBebas.filter((u) => u.status === where.status),
    },
    job: {
      findFirst: async () => jobExisting,
      create: async ({ data }) => {
        const job = { id: `job${jobsDibuat.length + 1}`, ...data };
        jobsDibuat.push(job);
        return job;
      },
      update: async ({ where, data }) => { jobUpdates.push({ where, data }); return data; },
    },
    jobUnit: {
      createMany: async ({ data }) => { jobUnitLinks.push(...data); return { count: data.length }; },
    },
  };
}

const orderDasar = {
  id: "order1",
  orderNumber: "SWS-14092026-007",
  deliveryAddress: "Jln juragan sinda 1 no 93B",
  deliveryCity: "Depok",
};

test("default unitStatus (AWAITING_PICKUP) — perilaku asli tidak berubah", async () => {
  const tx = fakeTx({ unitsBebas: [{ id: "unit1", status: "AWAITING_PICKUP" }] });
  const jobId = await ensurePickupJobForOrder(tx, orderDasar);

  assert.equal(jobId, "job1");
  assert.equal(tx.jobsDibuat.length, 1);
  assert.equal(tx.jobsDibuat[0].type, "PICKUP");
  assert.equal(tx.jobsDibuat[0].status, "UNSCHEDULED");
  assert.equal(tx.jobsDibuat[0].addressText, "Jln juragan sinda 1 no 93B, Depok");
});

test("tidak ada unit AWAITING_PICKUP -> null, tidak bikin job apa pun", async () => {
  const tx = fakeTx({ unitsBebas: [{ id: "unit1", status: "DELIVERED" }] });
  const jobId = await ensurePickupJobForOrder(tx, orderDasar);

  assert.equal(jobId, null);
  assert.equal(tx.jobsDibuat.length, 0);
});

// --- D-169: retur SEWA (unitStatus "DELIVERED") ----------------------------
test("unitStatus DELIVERED — unit sewa yang sudah terkirim dapat Job PICKUP retur", async () => {
  const tx = fakeTx({ unitsBebas: [{ id: "unit1", status: "DELIVERED" }] });
  const jobId = await ensurePickupJobForOrder(tx, orderDasar, { unitStatus: "DELIVERED" });

  assert.equal(jobId, "job1");
  assert.equal(tx.jobsDibuat.length, 1);
  assert.equal(tx.jobsDibuat[0].type, "PICKUP");
  assert.equal(tx.jobsDibuat[0].status, "UNSCHEDULED");
  // Alamat retur SAMA dengan alamat pengiriman awal — lokasi yang sama
  // tempat kasurnya dikirim, bukan alamat baru yang perlu diisi ulang.
  assert.equal(tx.jobsDibuat[0].addressText, "Jln juragan sinda 1 no 93B, Depok");
});

test("unitStatus DELIVERED — unit AWAITING_PICKUP (order LAIN yang kebetulan masih pending) TIDAK ikut terjaring", async () => {
  // Jaring pengaman: ensurePickupJobForOrder dengan unitStatus:"DELIVERED"
  // TIDAK BOLEH diam-diam juga menangkap unit yang statusnya masih
  // AWAITING_PICKUP — dua makna yang beda sama sekali (belum pernah
  // diambil vs sudah dipakai & perlu diambil lagi).
  const tx = fakeTx({ unitsBebas: [{ id: "unit1", status: "AWAITING_PICKUP" }] });
  const jobId = await ensurePickupJobForOrder(tx, orderDasar, { unitStatus: "DELIVERED" });

  assert.equal(jobId, null);
  assert.equal(tx.jobsDibuat.length, 0);
});

test("idempotent — dipanggil dua kali untuk order yang job PICKUP-nya sudah ada (UNSCHEDULED) menggabung, bukan bikin job baru", async () => {
  const tx = fakeTx({
    unitsBebas: [{ id: "unit1", status: "DELIVERED" }],
    jobExisting: { id: "jobLama", addressText: "Alamat lama tersimpan" },
  });
  const jobId = await ensurePickupJobForOrder(tx, orderDasar, { unitStatus: "DELIVERED" });

  assert.equal(jobId, "jobLama");
  assert.equal(tx.jobsDibuat.length, 0, "tidak boleh bikin job baru — job UNSCHEDULED sudah ada");
  assert.equal(tx.jobUnitLinks.length, 1);
  assert.equal(tx.jobUnitLinks[0].jobId, "jobLama");
  // Job existing SUDAH punya addressText — TIDAK ditimpa.
  assert.equal(tx.jobUpdates.length, 0);
});

test("job existing tanpa addressText (dibuat sebelum D-040) — dilengkapi, bukan dibiarkan kosong", async () => {
  const tx = fakeTx({
    unitsBebas: [{ id: "unit1", status: "DELIVERED" }],
    jobExisting: { id: "jobLama", addressText: null },
  });
  await ensurePickupJobForOrder(tx, orderDasar, { unitStatus: "DELIVERED" });

  assert.equal(tx.jobUpdates.length, 1);
  assert.equal(tx.jobUpdates[0].where.id, "jobLama");
  assert.equal(tx.jobUpdates[0].data.addressText, "Jln juragan sinda 1 no 93B, Depok");
});
