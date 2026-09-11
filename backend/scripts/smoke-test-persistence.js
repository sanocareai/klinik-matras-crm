// Smoke test persistence-layer — dijalankan SEBELUM deploy (lokal, terhadap
// klinik_matras_test) MAUPUN di VPS (docker compose exec backend node
// scripts/smoke-test-persistence.js) terhadap DATABASE_URL yang sedang
// aktif. TIDAK ADA safety gate database-tes di sini seperti
// tests/integration/setup/env.js — script ini SENGAJA dipakai untuk
// mengecek production juga, jadi ia HANYA melakukan baca + INSERT-lalu-
// ROLLBACK di dalam satu transaksi yang SELALU dibatalkan, tidak pernah commit.
//
// KENAPA SCRIPT INI ADA: bug "operator does not exist: uuid = text" (kode
// 42883) di lockRowForUpdate() lolos dari 381 tes stub dan baru ketahuan
// lewat smoke test MANUAL lewat SSH ke production (13 Sept 2026) — setiap
// endpoint yang menulis ledger gagal total sampai ::uuid cast diperbaiki.
// Script ini memformalkan pengecekan itu jadi satu perintah yang bisa
// (dan HARUS) dijalankan sebelum tiap deploy backend, supaya kelas bug yang
// sama tidak pernah lolos ke production lagi tanpa terdeteksi.
import { prisma } from "../src/db.js";
import { lockRowForUpdate, lockMaterialBalance, postStockMovement, computeStockSnapshot } from "../src/services/inventoryLedger.js";

function maskDbUrl(url) {
  if (!url) return "(tidak diset)";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username}:***@${u.host}${u.pathname}`;
  } catch {
    return "(URL tidak valid — tidak ditampilkan)";
  }
}

async function main() {
  console.log(`[smoke] Target database: ${maskDbUrl(process.env.DATABASE_URL)}`);

  console.log("[smoke] Cek 1/4: koneksi dasar ke Postgres...");
  await prisma.$queryRaw`SELECT 1`;
  console.log("[smoke]   OK");

  console.log("[smoke] Cek 2/4: SELECT ... FOR UPDATE dengan cast ::uuid (kelas bug 42883)...");
  // UUID acak yang HAMPIR PASTI tidak ada di tabel manapun — tujuannya BUKAN
  // menemukan baris, tapi memastikan Postgres menerima perbandingan
  // uuid = $1::uuid tanpa error tipe data. Kalau ::uuid cast hilang lagi di
  // masa depan, baris ini akan melempar "operator does not exist: uuid = text".
  const probeId = "00000000-0000-0000-0000-000000000000";
  await prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "materials", probeId);
    await lockRowForUpdate(tx, "stock_counts", probeId);
    await lockRowForUpdate(tx, "goods_receipts", probeId);
    await lockRowForUpdate(tx, "material_issues", probeId);
    await lockRowForUpdate(tx, "stock_transfers", probeId);
    await lockRowForUpdate(tx, "damaged_stock_records", probeId);
    await lockRowForUpdate(tx, "return_records", probeId);
    await lockRowForUpdate(tx, "stock_adjustment_requests", probeId);
  });
  console.log("[smoke]   OK — semua tabel dokumen menerima lock UUID tanpa error tipe data");

  console.log("[smoke] Cek 3/4: computeStockSnapshot() (query gabungan saldo+reserved) jalan tanpa error...");
  const snapshot = await computeStockSnapshot(prisma);
  console.log(`[smoke]   OK — ${snapshot.length} baris material terbaca`);

  console.log("[smoke] Cek 4/4: postStockMovement() + lockMaterialBalance() di dalam transaksi yang SENGAJA di-ROLLBACK (tidak pernah commit)...");
  const material = await prisma.material.findFirst({ select: { id: true, code: true } });
  if (!material) {
    console.log("[smoke]   DILEWATI — tidak ada baris Material sama sekali di database ini, tidak ada yang bisa diuji tulis");
  } else {
    const ROLLBACK_MARKER = "__SMOKE_TEST_ROLLBACK__";
    try {
      await prisma.$transaction(async (tx) => {
        const before = await lockMaterialBalance(tx, material.id);
        await postStockMovement(tx, { materialId: material.id, type: "ADJUSTMENT", qty: 0.0001, note: "smoke test" });
        const after = await lockMaterialBalance(tx, material.id);
        if (Math.abs(after - before - 0.0001) > 1e-6) {
          throw new Error(`saldo tidak berubah sesuai ekspektasi: before=${before} after=${after}`);
        }
        // WAJIB throw supaya transaksi rollback — script ini tidak boleh
        // meninggalkan jejak permanen di database manapun, termasuk test DB.
        throw new Error(ROLLBACK_MARKER);
      });
    } catch (err) {
      if (err.message !== ROLLBACK_MARKER) throw err;
    }
    const rowsAfterRollback = await prisma.stockMovement.count({ where: { materialId: material.id, note: "smoke test" } });
    if (rowsAfterRollback !== 0) {
      throw new Error(`rollback GAGAL — ${rowsAfterRollback} baris smoke-test persist di database`);
    }
    console.log(`[smoke]   OK — write+lock+rollback pada material ${material.code} berhasil, TIDAK ADA baris yang persist (rollback terverifikasi)`);
  }

  console.log("[smoke] SEMUA CEK LULUS — persistence layer aman untuk deploy.");
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("[smoke] GAGAL:", err);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
