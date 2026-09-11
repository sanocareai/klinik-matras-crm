// Tes Warehouse audit end-to-end (12 Sept 2026) — services/inventoryLedger.js.
//
// postStockMovement()/lockRowForUpdate()/lockMaterialBalance() menerima `tx`
// sebagai parameter (pola SAMA dengan loadLastCurrentStageLogs di
// tests/queryBatching.test.js) — jadi bisa dites TANPA database sungguhan
// lewat objek stub berbentuk-Prisma. computeStockSnapshot() TIDAK dites di
// sini (murni satu raw SQL, diverifikasi lewat code review + pemeriksaan
// manual pasca-deploy — pola sama dengan changeUnitRoute()/assignStage() di
// tests/productionRouting.test.js).

import test from "node:test";
import assert from "node:assert/strict";

import { postStockMovement, lockRowForUpdate, LedgerError, deriveStockStatus } from "../src/services/inventoryLedger.js";

// Stub `tx` berbentuk-Prisma: $queryRawUnsafe untuk lock, $queryRaw (tagged
// template) untuk baca saldo, stockMovement.create untuk tulis ledger,
// material.findUnique untuk pesan error yang menyebut kode material.
function makeTx({ balance = 0 } = {}) {
  const calls = { lock: [], queryRaw: 0, create: [] };
  const tx = {
    $queryRawUnsafe: async (sql, id) => { calls.lock.push({ sql, id }); return []; },
    $queryRaw: async () => { calls.queryRaw++; return [{ balance }]; },
    stockMovement: {
      create: async (args) => { calls.create.push(args); return { id: "mv-stub", ...args.data }; },
    },
    material: {
      findUnique: async () => ({ code: "MAT-STUB" }),
    },
  };
  return { tx, calls };
}

// ---------------------------------------------------------------------------
// lockRowForUpdate
// ---------------------------------------------------------------------------

test("lockRowForUpdate: mengirim SELECT ... FOR UPDATE dengan nama tabel & id yang benar", async () => {
  const { tx, calls } = makeTx();
  await lockRowForUpdate(tx, "goods_receipts", "gr-123");
  assert.equal(calls.lock.length, 1);
  assert.match(calls.lock[0].sql, /SELECT id FROM goods_receipts WHERE id = \$1 FOR UPDATE/);
  assert.equal(calls.lock[0].id, "gr-123");
});

test("lockRowForUpdate: menolak dipanggil dengan prisma singleton (tanpa $queryRawUnsafe)", async () => {
  await assert.rejects(() => lockRowForUpdate({}, "materials", "m-1"), /klien transaksi Prisma/);
});

// ---------------------------------------------------------------------------
// postStockMovement — validasi dasar
// ---------------------------------------------------------------------------

test("postStockMovement: menolak dipanggil dengan prisma singleton", async () => {
  await assert.rejects(() => postStockMovement({}, { materialId: "m-1", type: "RECEIPT", qty: 1 }), /klien transaksi Prisma/);
});

test("postStockMovement: menolak materialId kosong", async () => {
  const { tx } = makeTx();
  await assert.rejects(() => postStockMovement(tx, { type: "RECEIPT", qty: 1 }), LedgerError);
});

test("postStockMovement: menolak jenis movement yang tidak dikenal", async () => {
  const { tx } = makeTx();
  await assert.rejects(() => postStockMovement(tx, { materialId: "m-1", type: "TELEPORT", qty: 1 }), LedgerError);
});

test("postStockMovement: menolak qty nol", async () => {
  const { tx } = makeTx();
  await assert.rejects(() => postStockMovement(tx, { materialId: "m-1", type: "RECEIPT", qty: 0 }), LedgerError);
});

test("postStockMovement: menolak qty non-numerik", async () => {
  const { tx } = makeTx();
  await assert.rejects(() => postStockMovement(tx, { materialId: "m-1", type: "RECEIPT", qty: "abc" }), LedgerError);
});

// ---------------------------------------------------------------------------
// postStockMovement — invariant saldo TIDAK BOLEH negatif (celah nyata yang
// diperbaiki 12 Sept 2026: sebelumnya cuma ISSUE lewat Material Issue yang
// dicek, WASTE/ADJUSTMENT/TRANSFER/POST movements/issue lolos tanpa cek)
// ---------------------------------------------------------------------------

test("postStockMovement: ISSUE ditolak kalau saldo hasil akhir < 0", async () => {
  const { tx } = makeTx({ balance: 5 });
  await assert.rejects(
    () => postStockMovement(tx, { materialId: "m-1", type: "ISSUE", qty: -10 }),
    /tidak cukup/
  );
});

test("postStockMovement: ISSUE diterima kalau saldo hasil akhir tepat 0", async () => {
  const { tx, calls } = makeTx({ balance: 10 });
  const result = await postStockMovement(tx, { materialId: "m-1", type: "ISSUE", qty: -10 });
  assert.equal(calls.create.length, 1);
  assert.equal(result.qty, -10);
});

test("postStockMovement: WASTE ditolak kalau saldo hasil akhir < 0 (sebelumnya TIDAK dicek sama sekali — routes/damagedStock.js)", async () => {
  const { tx } = makeTx({ balance: 2 });
  await assert.rejects(() => postStockMovement(tx, { materialId: "m-1", type: "WASTE", qty: -3 }), /tidak cukup/);
});

test("postStockMovement: ADJUSTMENT negatif ditolak kalau saldo hasil akhir < 0 (sebelumnya TIDAK dicek — routes/stockAdjustment.js)", async () => {
  const { tx } = makeTx({ balance: 4 });
  await assert.rejects(() => postStockMovement(tx, { materialId: "m-1", type: "ADJUSTMENT", qty: -5 }), /tidak cukup/);
});

test("postStockMovement: TRANSFER keluar (qty negatif) ditolak kalau saldo hasil akhir < 0", async () => {
  const { tx } = makeTx({ balance: 3 });
  await assert.rejects(() => postStockMovement(tx, { materialId: "m-1", type: "TRANSFER", qty: -4 }), /tidak cukup/);
});

test("postStockMovement: RECEIPT (selalu positif) tidak pernah ditolak invariant saldo", async () => {
  const { tx, calls } = makeTx({ balance: 0 });
  await postStockMovement(tx, { materialId: "m-1", type: "RECEIPT", qty: 100 });
  assert.equal(calls.create.length, 1);
});

test("postStockMovement: pesan error menyebut kode material, bukan UUID mentah", async () => {
  const { tx } = makeTx({ balance: 1 });
  await assert.rejects(
    () => postStockMovement(tx, { materialId: "m-1", type: "ISSUE", qty: -5 }),
    /MAT-STUB/
  );
});

test("postStockMovement: mengunci baris material SEBELUM menulis (lock lalu baca lalu tulis, urutan penting untuk race condition)", async () => {
  const { tx, calls } = makeTx({ balance: 10 });
  await postStockMovement(tx, { materialId: "m-1", type: "ISSUE", qty: -5 });
  assert.equal(calls.lock.length, 1, "harus mengunci baris materials dulu");
  assert.equal(calls.lock[0].sql.includes("materials"), true);
  assert.equal(calls.create.length, 1);
});

test("postStockMovement: field opsional yang tidak diisi disimpan null, bukan undefined (konsisten dengan pola project)", async () => {
  const { tx, calls } = makeTx({ balance: 0 });
  await postStockMovement(tx, { materialId: "m-1", type: "RECEIPT", qty: 1 });
  const data = calls.create[0].data;
  assert.equal(data.unitId, null);
  assert.equal(data.reason, null);
  assert.equal(data.createdById, null);
});

// ---------------------------------------------------------------------------
// deriveStockStatus — HARUS identik dengan deriveStockStatusReal frontend
// (features/warehouse/inventoryReal.js) supaya Reports & Stock and Material
// page tidak pernah menampilkan status berbeda untuk material yang sama.
// ---------------------------------------------------------------------------

test("deriveStockStatus: material nonaktif selalu INACTIVE, apa pun saldonya", () => {
  assert.equal(deriveStockStatus({ active: false, available: 100, reorderPoint: 5 }), "INACTIVE");
});

test("deriveStockStatus: available <= 0 -> OUT_OF_STOCK", () => {
  assert.equal(deriveStockStatus({ active: true, available: 0, reorderPoint: 5 }), "OUT_OF_STOCK");
  assert.equal(deriveStockStatus({ active: true, available: -2, reorderPoint: 5 }), "OUT_OF_STOCK");
});

test("deriveStockStatus: available > 0 dan <= reorderPoint -> LOW_STOCK", () => {
  assert.equal(deriveStockStatus({ active: true, available: 5, reorderPoint: 5 }), "LOW_STOCK");
});

test("deriveStockStatus: reorderPoint null -> TIDAK PERNAH LOW_STOCK (alert mati, bukan reorder di titik nol)", () => {
  assert.equal(deriveStockStatus({ active: true, available: 1, reorderPoint: null }), "IN_STOCK");
});

test("deriveStockStatus: available > reorderPoint -> IN_STOCK", () => {
  assert.equal(deriveStockStatus({ active: true, available: 50, reorderPoint: 5 }), "IN_STOCK");
});

test("deriveStockStatus: pakai `available`, BUKAN `balance` mentah, kalau dua-duanya ada", () => {
  // balance besar tapi available (setelah reserved) sudah 0 -> tetap OUT_OF_STOCK
  assert.equal(deriveStockStatus({ active: true, balance: 100, available: 0, reorderPoint: 5 }), "OUT_OF_STOCK");
});

test("deriveStockStatus: fallback ke balance kalau available tidak ada (baris tanpa reserved)", () => {
  assert.equal(deriveStockStatus({ active: true, balance: 20, reorderPoint: 5 }), "IN_STOCK");
});
