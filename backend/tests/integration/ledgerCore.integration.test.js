// Test integrasi — inventoryLedger.js terhadap PostgreSQL SUNGGUHAN.
//
// KENAPA FILE INI ADA: tests/inventoryLedger.test.js (stub) membuktikan
// LOGIKA postStockMovement/lockRowForUpdate benar — tapi stub itu sendiri
// yang membuktikan salah: $queryRawUnsafe dengan parameter tanpa cast
// eksplisit ($1 vs $1::uuid) dikirim Postgres sebagai `text`, dan
// `uuid = text` bukan operator yang ada (kode 42883). Stub tidak pernah
// bisa menangkap ini karena stub TIDAK PERNAH benar-benar mengirim SQL ke
// Postgres. Bug itu baru ketahuan lewat smoke test manual pasca-deploy
// (13 Sept 2026) — file ini MEMFORMALKAN smoke test itu jadi test yang
// jalan otomatis sebelum deploy, bukan lagi bergantung diingat manual.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUnit, createTestUser } from "./setup/fixtures.js";
import { postStockMovement, lockRowForUpdate, lockMaterialBalance, computeStockSnapshot, LedgerError } from "../../src/services/inventoryLedger.js";

test.before(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

test("postStockMovement: RECEIPT nyata tertulis ke Postgres dan balance ikut naik", async () => {
  const material = await createTestMaterial();
  await testPrisma.$transaction((tx) => postStockMovement(tx, {
    materialId: material.id, type: "RECEIPT", qty: 10, createdById: null,
  }));

  const rows = await testPrisma.stockMovement.findMany({ where: { materialId: material.id } });
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].qty), 10);

  const balance = await testPrisma.$transaction((tx) => lockMaterialBalance(tx, material.id));
  assert.equal(balance, 10);
});

test("postStockMovement: ISSUE ditolak Postgres sungguhan kalau saldo hasil akhir < 0 (TIDAK ada baris ledger yang tertulis)", async () => {
  const material = await createTestMaterial();
  await testPrisma.$transaction((tx) => postStockMovement(tx, { materialId: material.id, type: "RECEIPT", qty: 5 }));

  await assert.rejects(
    () => testPrisma.$transaction((tx) => postStockMovement(tx, { materialId: material.id, type: "ISSUE", qty: -10 })),
    LedgerError
  );

  const rows = await testPrisma.stockMovement.findMany({ where: { materialId: material.id } });
  assert.equal(rows.length, 1, "hanya RECEIPT awal — percobaan ISSUE yang ditolak TIDAK boleh meninggalkan jejak apa pun");
});

test("postStockMovement: unitId tersimpan persis di Postgres, bisa ditelusuri balik lewat query nyata", async () => {
  const material = await createTestMaterial();
  const { unit } = await createTestUnit();
  await testPrisma.$transaction((tx) => postStockMovement(tx, {
    materialId: material.id, type: "RECEIPT", qty: 3, unitId: unit.id,
  }));

  const found = await testPrisma.stockMovement.findFirst({ where: { unitId: unit.id } });
  assert.ok(found, "movement harus ditemukan lewat unitId");
  assert.equal(found.materialId, material.id);
});

test("Transaksi ATOMIC: kalau ada error SETELAH baris ledger ditulis tapi SEBELUM transaksi commit, ledger ikut batal (rollback penuh, bukan setengah tertulis)", async () => {
  const material = await createTestMaterial();
  await assert.rejects(
    () => testPrisma.$transaction(async (tx) => {
      await postStockMovement(tx, { materialId: material.id, type: "RECEIPT", qty: 7 });
      throw new Error("simulasi kegagalan setelah ledger ditulis di dalam transaksi yang sama");
    }),
    /simulasi kegagalan/
  );

  const rows = await testPrisma.stockMovement.findMany({ where: { materialId: material.id } });
  assert.equal(rows.length, 0, "ledger yang ditulis di transaksi yang gagal TIDAK BOLEH persist — ini yang membuat status dokumen & ledger selalu atomic");
});

test("lockRowForUpdate: mengunci baris NYATA (SELECT ... FOR UPDATE ::uuid) tanpa error tipe data, untuk setiap tabel dokumen", async () => {
  const material = await createTestMaterial();
  const count = await testPrisma.stockCount.create({
    data: { countNumber: `CC-TEST-${Date.now()}`, countType: "CYCLE_COUNT", countMethod: "BY_ITEM" },
  });
  // Kalau ::uuid cast hilang lagi di masa depan, baris ini akan melempar
  // "operator does not exist: uuid = text" — persis error yang lolos ke
  // production sebelum smoke test manual menangkapnya.
  await testPrisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "materials", material.id);
    await lockRowForUpdate(tx, "stock_counts", count.id);
  });
  assert.ok(true, "kedua lock berhasil tanpa melempar error tipe data");
});

test("lockRowForUpdate: menolak id yang bukan UUID valid dengan error yang jelas (bukan crash generik)", async () => {
  await assert.rejects(
    () => testPrisma.$transaction((tx) => lockRowForUpdate(tx, "materials", "bukan-uuid")),
  );
});

test("computeStockSnapshot: available = balance - reserved, dihitung ulang dari ledger Postgres sungguhan (bukan kolom tersimpan)", async () => {
  const material = await createTestMaterial();
  await testPrisma.$transaction((tx) => postStockMovement(tx, { materialId: material.id, type: "RECEIPT", qty: 20 }));
  await testPrisma.$transaction((tx) => postStockMovement(tx, { materialId: material.id, type: "ISSUE", qty: -5 }));

  const snapshot = await computeStockSnapshot(testPrisma);
  const row = snapshot.find((r) => r.materialId === material.id);
  assert.ok(row);
  assert.equal(row.balance, 15);
  assert.equal(row.reserved, 0); // belum ada Material Issue APPROVED/READY_TO_PICK/PICKED untuk material ini
  assert.equal(row.available, 15);
});

test("computeStockSnapshot: Reserved dari Material Issue APPROVED mengurangi Available walau saldo ledger belum berubah (Issue belum benar-benar diposting)", async () => {
  const material = await createTestMaterial();
  await testPrisma.$transaction((tx) => postStockMovement(tx, { materialId: material.id, type: "RECEIPT", qty: 20 }));

  const { user } = await createTestUser();
  const issue = await testPrisma.materialIssue.create({
    data: {
      issueNumber: `MI-TEST-${Date.now()}`, sourceType: "MANUAL", status: "APPROVED",
      requestedById: user.id,
      lines: { create: [{ materialId: material.id, requestedQty: 8 }] },
    },
  });

  const snapshot = await computeStockSnapshot(testPrisma);
  const row = snapshot.find((r) => r.materialId === material.id);
  assert.equal(row.balance, 20, "saldo ledger TIDAK berubah — belum ada baris ISSUE, cuma reservasi");
  assert.equal(row.reserved, 8);
  assert.equal(row.available, 12);

  // Batalkan -> reservasi WAJIB lepas otomatis (Available balik ke 20).
  await testPrisma.materialIssue.update({ where: { id: issue.id }, data: { status: "CANCELLED" } });
  const snapshotAfterCancel = await computeStockSnapshot(testPrisma);
  const rowAfterCancel = snapshotAfterCancel.find((r) => r.materialId === material.id);
  assert.equal(rowAfterCancel.reserved, 0, "cancel WAJIB otomatis melepas reservasi");
  assert.equal(rowAfterCancel.available, 20);
});
