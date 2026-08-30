// Tes pembuatan Unit dari Order — mata rantai pertama tulang punggung operasi.
//
// KENAPA TES INI PENTING. Sejak 1 Agustus 2026 pembuatan order dan pembuatan
// unit berada dalam SATU transaksi (routes/customers.js). Konsekuensinya:
// kalau logika di sini melempar error, sales TIDAK BISA MEMBUAT ORDER SAMA
// SEKALI — jalur yang dipakai 7 orang setiap hari. Jadi bagian yang paling
// wajib diuji bukan "jalannya benar", tapi "tidak meledak untuk data aneh":
// notes JSON rusak, notes teks polos, order tanpa orderNumber, count nol.
//
// Sengaja TANPA database: `tx` di-fake. Yang diuji logika murni — bentuk
// unitCode, kelanjutan seq, pemetaan status, dan ketahanan parser.

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseOrderNotes,
  unitStatusFromOrderStatus,
  createUnitsForOrder,
} from "../src/services/unitProvisioning.js";

// Fake transaksi Prisma: cukup meniru panggilan yang dipakai service —
// TERMASUK job/jobUnit sejak 24 Agustus 2026 (createUnitsForOrder sekarang
// juga memanggil services/armadaAutoJob.js#ensurePickupJobForOrder untuk
// unit yang lahir AWAITING_PICKUP, lihat tes "auto-job" di bawah).
function fakeTx({ seqTertinggi = null } = {}) {
  const dibuat = [];
  const jobsDibuat = [];
  return {
    dibuat,
    jobsDibuat,
    unit: {
      findFirst: async () => (seqTertinggi === null ? null : { seq: seqTertinggi }),
      createMany: async ({ data }) => { dibuat.push(...data); return { count: data.length }; },
      // Fake SEDERHANA: filter status persis seperti Prisma, tapi TIDAK
      // meniru `jobUnits.none` (tidak relevan di tes ini — tidak ada tes
      // yang memanggil createUnitsForOrder dua kali untuk order yang sama
      // unit-nya sudah punya job dari panggilan sebelumnya).
      findMany: async ({ where } = {}) => {
        if (!where) return dibuat;
        return dibuat.filter((u) => !where.status || u.status === where.status.in?.[0] || u.status === where.status);
      },
    },
    job: {
      // Tidak ada job existing di skenario tes murni ini — tiap panggilan
      // createUnitsForOrder di sini mewakili ORDER BARU, bukan menambah
      // unit ke order yang jobnya sudah ada.
      findFirst: async () => null,
      create: async ({ data }) => {
        const job = { id: `job${jobsDibuat.length + 1}`, ...data };
        jobsDibuat.push(job);
        return job;
      },
    },
    jobUnit: {
      createMany: async () => ({ count: 0 }),
    },
  };
}

const orderDasar = {
  id: "abcdef1234567890",
  orderNumber: "RES-01082026-007",
  status: "PENDING",
  notes: JSON.stringify({ merkKasur: "Sano", ukuranKasur: "160x200 cm (Queen)", keluhanCustomer: "pegal" }),
};

// --- parser notes ----------------------------------------------------------
// D-012: merk/ukuran masih blob JSON di dalam Order.notes. Baris lawas berisi
// teks polos. Parser WAJIB gagal jadi objek kosong, tidak boleh melempar.
test("parseOrderNotes menangani JSON valid", () => {
  assert.deepEqual(parseOrderNotes(JSON.stringify({ merkKasur: "Sano" })), { merkKasur: "Sano" });
});

test("parseOrderNotes tidak melempar untuk data lawas / rusak", () => {
  // Ini bentuk-bentuk yang BENAR-BENAR ada di production (import Excel Jan–Jun).
  assert.deepEqual(parseOrderNotes("keluhan pegal saja"), {});
  assert.deepEqual(parseOrderNotes('{"merkKasur":'), {});
  assert.deepEqual(parseOrderNotes(null), {});
  assert.deepEqual(parseOrderNotes(undefined), {});
  assert.deepEqual(parseOrderNotes(""), {});
  // JSON valid tapi BUKAN objek — jangan sampai lolos jadi array/angka
  assert.deepEqual(parseOrderNotes("[1,2]"), {});
  assert.deepEqual(parseOrderNotes("42"), {});
});

// --- pemetaan status -------------------------------------------------------
test("status unit mengikuti status order, dengan jaring pengaman", () => {
  assert.equal(unitStatusFromOrderStatus("PENDING"), "AWAITING_PICKUP");
  assert.equal(unitStatusFromOrderStatus("PROCESSING"), "IN_PRODUCTION");
  assert.equal(unitStatusFromOrderStatus("READY"), "READY_FOR_DELIVERY");
  assert.equal(unitStatusFromOrderStatus("DELIVERED"), "DELIVERED");
  // Nilai OrderStatus baru yang belum dipetakan TIDAK boleh jadi undefined —
  // kolom status unit NOT NULL, undefined akan menggagalkan pembuatan order.
  assert.equal(unitStatusFromOrderStatus("STATUS_BARU_YANG_BELUM_ADA"), "AWAITING_PICKUP");
  assert.equal(unitStatusFromOrderStatus(undefined), "AWAITING_PICKUP");
});

// --- pembuatan unit --------------------------------------------------------
test("membuat satu unit dengan kode & merk/ukuran dari notes", async () => {
  const tx = fakeTx();
  await createUnitsForOrder(tx, { order: orderDasar, count: 1 });

  assert.equal(tx.dibuat.length, 1);
  assert.deepEqual(tx.dibuat[0], {
    unitCode: "RES-01082026-007-U1",
    orderId: orderDasar.id,
    seq: 1,
    merk: "Sano",
    ukuran: "160x200 cm (Queen)",
    status: "AWAITING_PICKUP",
  });
});

test("seq MELANJUTKAN dari unit yang sudah ada, bukan mengulang dari 1", async () => {
  // Skenario nyata: order 1 kasur, lalu ketahuan ada kasur kedua →
  // POST /orders/:id/units. Mengulang dari 1 akan menabrak unique
  // constraint @@unique([orderId, seq]) dan unitCode.
  const tx = fakeTx({ seqTertinggi: 2 });
  await createUnitsForOrder(tx, { order: orderDasar, count: 2 });

  assert.deepEqual(tx.dibuat.map((u) => u.seq), [3, 4]);
  assert.deepEqual(tx.dibuat.map((u) => u.unitCode),
    ["RES-01082026-007-U3", "RES-01082026-007-U4"]);
});

test("order tanpa orderNumber memakai kode warisan LEG-", async () => {
  // Order hasil import Excel Jan–Jun tidak punya orderNumber. Formatnya harus
  // SAMA PERSIS dengan migrasi backfill, supaya tidak ada dua format kode
  // untuk kasus yang sama.
  const tx = fakeTx();
  await createUnitsForOrder(tx, { order: { ...orderDasar, orderNumber: null }, count: 1 });
  assert.equal(tx.dibuat[0].unitCode, "LEG-abcdef12-U1");
});

test("merk/ukuran kosong jadi null, bukan string kosong", async () => {
  // Production benar-benar punya baris {"merkKasur":"","ukuranKasur":""}.
  // String kosong di kolom yang akan difilter papan bengkel itu racun halus:
  // tidak NULL, jadi lolos dari cek `IS NOT NULL`, tapi juga tidak berguna.
  const tx = fakeTx();
  await createUnitsForOrder(tx, {
    order: { ...orderDasar, notes: JSON.stringify({ merkKasur: "  ", ukuranKasur: "" }) },
    count: 1,
  });
  assert.equal(tx.dibuat[0].merk, null);
  assert.equal(tx.dibuat[0].ukuran, null);
});

test("notes rusak tidak menggagalkan pembuatan unit", async () => {
  // Ini invarian yang paling penting: order TETAP bisa dibuat walau notes-nya
  // tidak bisa di-parse. Kalau ini gagal, sales berhenti bekerja.
  const tx = fakeTx();
  await createUnitsForOrder(tx, { order: { ...orderDasar, notes: "teks polos lawas" }, count: 1 });
  assert.equal(tx.dibuat.length, 1);
  assert.equal(tx.dibuat[0].merk, null);
});

test("count tidak masuk akal menghasilkan nol unit, bukan error", async () => {
  // CATATAN: `undefined` TIDAK ada di daftar ini dengan sengaja — lihat tes
  // berikutnya. Nilai-nilai di bawah adalah masukan yang benar-benar salah,
  // dan yang benar adalah tidak membuat apa-apa TANPA melempar (melempar =
  // sales gagal membuat order, karena order & unit satu transaksi).
  for (const count of [0, -3, NaN, null, "abc"]) {
    const tx = fakeTx();
    const hasil = await createUnitsForOrder(tx, { order: orderDasar, count });
    assert.equal(tx.dibuat.length, 0, `count=${count} seharusnya tidak membuat unit`);
    assert.deepEqual(hasil, []);
  }
});

test("count undefined BERBEDA dari count tidak valid — artinya pakai default 1", async () => {
  // Bedanya penting dan mudah tertukar: klien lama (web & mobile) tidak
  // mengirim `unitCount` sama sekali. Kalau `undefined` diperlakukan sebagai
  // "tidak valid → nol unit", seluruh order dari klien lama akan lahir tanpa
  // unit — persis bug yang sedang diperbaiki.
  const tx = fakeTx();
  await createUnitsForOrder(tx, { order: orderDasar, count: undefined });
  assert.equal(tx.dibuat.length, 1);

  // Tanpa properti `count` sama sekali — hasilnya harus identik.
  const tx2 = fakeTx();
  await createUnitsForOrder(tx2, { order: orderDasar });
  assert.equal(tx2.dibuat.length, 1);
});

test("statusOverride dipakai kalau diberikan", async () => {
  const tx = fakeTx();
  await createUnitsForOrder(tx, {
    order: { ...orderDasar, status: "PENDING" },
    count: 1,
    statusOverride: "RECEIVED",
  });
  assert.equal(tx.dibuat[0].status, "RECEIVED");
});

// --- jembatan otomatis ke Delivery Hub (24 Agustus 2026) -------------------
// Sebelum ini, order/unit baru HANYA terlihat dispatcher lewat daftar "unit
// belum terjadwal" — dia masih harus klik "Buat Job" manual. Sekarang unit
// yang lahir AWAITING_PICKUP langsung dapat Job (UNSCHEDULED, tanpa
// driver/tanggal) di transaksi yang sama. Lihat services/armadaAutoJob.js.
test("unit AWAITING_PICKUP otomatis dapat job PICKUP (UNSCHEDULED)", async () => {
  const tx = fakeTx();
  await createUnitsForOrder(tx, { order: orderDasar, count: 1 });

  assert.equal(tx.jobsDibuat.length, 1);
  assert.equal(tx.jobsDibuat[0].type, "PICKUP");
  assert.equal(tx.jobsDibuat[0].status, "UNSCHEDULED");
  assert.equal(tx.jobsDibuat[0].orderId, orderDasar.id);
});

test("unit yang lahir DI LUAR AWAITING_PICKUP tidak memicu job apa pun", async () => {
  // statusOverride RECEIVED — unit ini sudah "lewat" tahap pickup (mis.
  // dipindah manual), jadi tidak butuh job pickup sama sekali.
  const tx = fakeTx();
  await createUnitsForOrder(tx, { order: orderDasar, count: 1, statusOverride: "RECEIVED" });
  assert.equal(tx.jobsDibuat.length, 0);
});
