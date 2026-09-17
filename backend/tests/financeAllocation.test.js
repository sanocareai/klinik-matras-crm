// Alokasi pembayaran, gerbang verifikasi, dan status turunan dokumen.
//
// Semuanya fungsi MURNI (atau hampir murni dengan stub tx kecil) — dan
// semuanya memutuskan UANG. Kalau salah satunya meleset, gejalanya bukan
// error di layar melainkan angka yang salah diam-diam: order yang terlihat
// lunas padahal belum, atau tagihan supplier yang tidak pernah berhenti di
// "Dibayar Sebagian".

import test from "node:test";
import assert from "node:assert/strict";

import {
  effectiveAllocations, isPaymentCounted, unallocatedAmount, setAllocations,
  AllocationError,
} from "../src/services/finance/allocation.js";
import { statusTagihanEfektif } from "../src/services/finance/posting/supplier.js";
import { revenueSystemKeyForOrder, SYSTEM_KEYS } from "../src/services/finance/accounts.js";
import { saldoNormal } from "../src/services/finance/reports.js";
import { ZERO } from "../src/services/finance/money.js";

// ─── effectiveAllocations ────────────────────────────────────────────────

test("payment TANPA alokasi eksplisit: seluruh nominal milik Payment.orderId", () => {
  // Inilah yang membuat SELURUH data lama tetap sah tanpa backfill apa pun.
  const p = { id: "p1", orderId: "o1", amount: 500000, finAllocations: [] };
  assert.deepEqual(
    effectiveAllocations(p).map((a) => ({ orderId: a.orderId, amount: a.amount.toFixed(2) })),
    [{ orderId: "o1", amount: "500000.00" }]
  );
});

test("payment DENGAN alokasi eksplisit: Payment.orderId TIDAK lagi dipakai", () => {
  const p = {
    id: "p1", orderId: "o1", amount: 500000,
    finAllocations: [
      { orderId: "o2", amount: "300000.00" },
      { orderId: "o3", amount: "200000.00" },
    ],
  };
  const hasil = effectiveAllocations(p);
  assert.equal(hasil.length, 2);
  assert.deepEqual(hasil.map((a) => a.orderId), ["o2", "o3"]);
});

test("unallocatedAmount: payment tanpa alokasi dianggap TERALOKASI PENUH (bukan 'sisa penuh')", () => {
  // Kalau dikembalikan sebagai "sisa 500rb", UI akan menawarkan mengalokasi
  // uang yang sebenarnya sudah punya tujuan — dan alokasi yang lahir dari
  // situ akan menggandakan nominalnya.
  const p = { amount: 500000, finAllocations: [] };
  assert.equal(unallocatedAmount(p).toFixed(2), "0.00");
});

test("unallocatedAmount: sisa dihitung dari alokasi yang sudah ada", () => {
  const p = { amount: 500000, finAllocations: [{ amount: "300000.00" }] };
  assert.equal(unallocatedAmount(p).toFixed(2), "200000.00");
});

// ─── Gerbang verifikasi ──────────────────────────────────────────────────

const GATE_MATI = { enabled: false, since: null };
const SEJAK = new Date("2026-09-17T00:00:00Z");
const GATE_NYALA = { enabled: true, since: SEJAK };

function payment({ dibatalkan = false, terverifikasi = false, createdAt = "2026-09-20T00:00:00Z" } = {}) {
  return {
    amount: 100,
    cancelledAt: dibatalkan ? new Date() : null,
    createdAt: new Date(createdAt),
    verifications: terverifikasi ? [{ id: "v1" }] : [],
  };
}

test("gerbang MATI: semua payment dihitung, terverifikasi atau belum (perilaku lama)", () => {
  assert.equal(isPaymentCounted(payment(), GATE_MATI), true);
  assert.equal(isPaymentCounted(payment({ terverifikasi: true }), GATE_MATI), true);
});

test("payment DIBATALKAN tidak pernah dihitung, apa pun status gerbangnya", () => {
  assert.equal(isPaymentCounted(payment({ dibatalkan: true }), GATE_MATI), false);
  assert.equal(isPaymentCounted(payment({ dibatalkan: true, terverifikasi: true }), GATE_NYALA), false);
});

test("gerbang NYALA: payment baru yang belum diverifikasi TIDAK dihitung", () => {
  assert.equal(isPaymentCounted(payment({ createdAt: "2026-09-20T00:00:00Z" }), GATE_NYALA), false);
  assert.equal(
    isPaymentCounted(payment({ createdAt: "2026-09-20T00:00:00Z", terverifikasi: true }), GATE_NYALA),
    true
  );
});

test("gerbang NYALA: payment SEBELUM tanggal aktivasi TETAP dihitung — tidak pernah berlaku surut", () => {
  // Ini yang membuat penyalaan gerbang aman dilakukan di jam kerja:
  // ratusan order yang sudah dianggap DP tidak mendadak balik jadi
  // "Belum Bayar".
  const lama = payment({ createdAt: "2026-01-01T00:00:00Z", terverifikasi: false });
  assert.equal(isPaymentCounted(lama, GATE_NYALA), true);
});

test("gerbang NYALA tanpa tanggal aktivasi = konfigurasi setengah jadi → pilih sisi AMAN", () => {
  // Menganggap semua order belum dibayar gara-gara setting yang belum
  // lengkap jauh lebih merusak daripada menghitung apa adanya.
  const gateRusak = { enabled: true, since: null };
  assert.equal(isPaymentCounted(payment(), gateRusak), true);
});

// ─── setAllocations (validasi, stub tx) ──────────────────────────────────

function stubTx({ payment: p, orders }) {
  const dibuat = [];
  return {
    _dibuat: dibuat,
    // setAllocations() mengunci baris payment lewat lockRowForUpdate()
    // SEBELUM membacanya (reuse dari inventoryLedger.js) — stub ini cuma
    // mencatat pemanggilan, semantik locking sungguhan diverifikasi tes
    // integrasi terhadap Postgres asli.
    $queryRawUnsafe: async () => [],
    payment: { findUnique: async () => p },
    order: { findMany: async ({ where }) => orders.filter((o) => where.id.in.includes(o.id)) },
    finPaymentAllocation: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }) => { dibuat.push(data); return data; },
    },
  };
}

const PAY = { id: "p1", amount: 1000000, orderId: "o1", cancelledAt: null };
const ORDERS = [
  { id: "o1", status: "DELIVERED", customerId: "c1" },
  { id: "o2", status: "PROCESSING", customerId: "c1" },
];

test("setAllocations: total WAJIB persis sama dengan nominal pembayaran", async () => {
  const tx = stubTx({ payment: PAY, orders: ORDERS });
  await assert.rejects(
    () => setAllocations(tx, {
      paymentId: "p1",
      allocations: [{ orderId: "o1", amount: 600000 }, { orderId: "o2", amount: 300000 }],
    }),
    (e) => e instanceof AllocationError && /tidak sama dengan nominal pembayaran/i.test(e.message)
  );
  assert.equal(tx._dibuat.length, 0, "tidak boleh ada baris yang tertulis saat validasi gagal");
});

test("setAllocations: alokasi melebihi nominal juga ditolak", async () => {
  const tx = stubTx({ payment: PAY, orders: ORDERS });
  await assert.rejects(
    () => setAllocations(tx, {
      paymentId: "p1",
      allocations: [{ orderId: "o1", amount: 700000 }, { orderId: "o2", amount: 400000 }],
    }),
    AllocationError
  );
});

test("setAllocations: alokasi pas menulis baris & mengembalikan order terdampak (termasuk order asal)", async () => {
  const tx = stubTx({ payment: PAY, orders: ORDERS });
  const terdampak = await setAllocations(tx, {
    paymentId: "p1",
    allocations: [{ orderId: "o1", amount: 600000 }, { orderId: "o2", amount: 400000 }],
    userId: "u1",
  });
  assert.equal(tx._dibuat.length, 2);
  // o1 kebetulan juga order asal — tidak boleh muncul dua kali.
  assert.deepEqual(terdampak.sort(), ["o1", "o2"]);
});

test("setAllocations: order asal IKUT dihitung ulang walau uangnya dipindah keluar semua", async () => {
  // Tanpa ini, order asal akan tetap berstatus LUNAS padahal uangnya sudah
  // pindah ke order lain.
  const tx = stubTx({ payment: PAY, orders: [{ id: "o2", status: "PROCESSING", customerId: "c1" }] });
  const terdampak = await setAllocations(tx, {
    paymentId: "p1",
    allocations: [{ orderId: "o2", amount: 1000000 }],
  });
  assert.ok(terdampak.includes("o1"), "order asal pembayaran wajib ikut dihitung ulang");
  assert.ok(terdampak.includes("o2"));
});

test("setAllocations: satu order tidak boleh muncul dua kali", async () => {
  const tx = stubTx({ payment: PAY, orders: ORDERS });
  await assert.rejects(
    () => setAllocations(tx, {
      paymentId: "p1",
      allocations: [{ orderId: "o1", amount: 500000 }, { orderId: "o1", amount: 500000 }],
    }),
    /dua kali/i
  );
});

test("setAllocations: order DIBATALKAN ditolak — pakai Refund, bukan alokasi", async () => {
  const tx = stubTx({
    payment: PAY,
    orders: [{ id: "o2", status: "CANCELLED", customerId: "c1" }],
  });
  await assert.rejects(
    () => setAllocations(tx, { paymentId: "p1", allocations: [{ orderId: "o2", amount: 1000000 }] }),
    /dibatalkan/i
  );
});

test("setAllocations: pembayaran yang sudah dibatalkan tidak bisa dialokasikan", async () => {
  const tx = stubTx({ payment: { ...PAY, cancelledAt: new Date() }, orders: ORDERS });
  await assert.rejects(
    () => setAllocations(tx, { paymentId: "p1", allocations: [{ orderId: "o1", amount: 1000000 }] }),
    /sudah dibatalkan/i
  );
});

// ─── Status turunan tagihan supplier ─────────────────────────────────────

test("statusTagihanEfektif: DITURUNKAN dari alokasi, tidak pernah diketik", () => {
  const bill = { amount: "1000000.00", status: "DISETUJUI" };
  assert.equal(statusTagihanEfektif(bill, 0), "DISETUJUI");
  assert.equal(statusTagihanEfektif(bill, "400000.00"), "DIBAYAR_SEBAGIAN");
  assert.equal(statusTagihanEfektif(bill, "1000000.00"), "LUNAS");
  // Kelebihan bayar tetap LUNAS — selisihnya urusan jurnal, bukan status.
  assert.equal(statusTagihanEfektif(bill, "1200000.00"), "LUNAS");
});

test("statusTagihanEfektif: status keputusan MANUSIA tidak pernah ditimpa turunan", () => {
  // Tagihan yang ditolak/dibatalkan tidak boleh "naik" jadi LUNAS cuma
  // karena kebetulan ada alokasi nyasar.
  for (const status of ["DRAFT", "MENUNGGU_APPROVAL", "DITOLAK", "DIBATALKAN"]) {
    assert.equal(statusTagihanEfektif({ amount: "100.00", status }, "100.00"), status);
  }
});

// ─── Akun pendapatan per kategori order ──────────────────────────────────

test("revenueSystemKeyForOrder: tiap kategori order punya akun pendapatannya sendiri", () => {
  assert.equal(revenueSystemKeyForOrder({ category: "LAYANAN" }), SYSTEM_KEYS.PENDAPATAN_LAYANAN);
  assert.equal(revenueSystemKeyForOrder({ category: "BARU" }), SYSTEM_KEYS.PENDAPATAN_PRODUK);
  assert.equal(revenueSystemKeyForOrder({ category: "SEWA" }), SYSTEM_KEYS.PENDAPATAN_SEWA);
});

test("revenueSystemKeyForOrder: order tanpa kategori jatuh ke LAYANAN (default skema), bukan error", () => {
  // OrderCategory default-nya LAYANAN di schema.prisma — order lama tanpa
  // kategori eksplisit memang layanan.
  assert.equal(revenueSystemKeyForOrder({}), SYSTEM_KEYS.PENDAPATAN_LAYANAN);
  assert.equal(revenueSystemKeyForOrder(null), SYSTEM_KEYS.PENDAPATAN_LAYANAN);
});

// ─── Saldo normal (dasar SELURUH laporan) ────────────────────────────────

test("saldoNormal: akun bersaldo normal DEBIT dan KREDIT dihitung berlawanan arah", () => {
  const totals = { debit: 1000, credit: 300 };
  assert.equal(saldoNormal({ normalBalance: "DEBIT" }, totals).toFixed(2), "700.00");
  assert.equal(saldoNormal({ normalBalance: "KREDIT" }, totals).toFixed(2), "-700.00");
});

test("saldoNormal: akun KONTRA benar-benar mengurangi kelompoknya", () => {
  // "Retur & Potongan Penjualan" bertipe PENDAPATAN tapi saldo normalnya
  // DEBIT. Kalau arahnya ditebak dari TIPE, retur akan terhitung sebagai
  // penjualan — kesalahan klasik yang dijaga tes ini.
  const retur = { normalBalance: "DEBIT", type: "PENDAPATAN" };
  assert.equal(saldoNormal(retur, { debit: 500, credit: 0 }).toFixed(2), "500.00");
});

test("saldoNormal: akun tanpa mutasi bernilai nol, bukan undefined", () => {
  assert.equal(saldoNormal({ normalBalance: "DEBIT" }, undefined).toFixed(2), "0.00");
  assert.equal(saldoNormal({ normalBalance: "KREDIT" }, { debit: ZERO, credit: ZERO }).toFixed(2), "0.00");
});
