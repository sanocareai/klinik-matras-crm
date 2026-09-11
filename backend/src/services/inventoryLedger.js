// Warehouse — SUMBER TUNGGAL untuk (a) menulis stock_movements dan
// (b) menghitung saldo (on-hand/reserved/available). Ditambahkan saat audit
// end-to-end 12 Sept 2026 untuk menutup 3 celah nyata yang ditemukan:
//
//   1. RACE CONDITION: tiap endpoint sebelumnya baca SUM(qty) ledger di luar
//      lock, lalu menulis movement baru di dalam transaksi terpisah. Dua
//      request bersamaan (mis. dua POST /material-issues/:id/issue untuk
//      dua Material Issue BERBEDA yang sama-sama menyentuh material X) bisa
//      dua-duanya lolos cek "stok cukup" sebelum salah satu commit — hasil
//      akhirnya saldo bisa negatif walau tiap request individual "sah" saat
//      dicek. Transaksi Postgres level READ COMMITTED (default) TIDAK
//      mencegah ini — SELECT SUM() biasa tidak mengunci apa pun.
//   2. SALDO NEGATIF: hanya sebagian endpoint (POST /material-issues/:id/issue,
//      POST /transfers/:id/dispatch) yang mengecek shortage sebelum menulis.
//      POST /movements/issue, /movements/waste, damaged-stock/:id/resolve,
//      dan stock-adjustment/:id/post SAMA SEKALI tidak mengecek — bisa
//      menulis ledger yang membuat saldo agregat < 0, yang secara fisik
//      tidak mungkin (tidak ada "minus barang" di rak).
//   3. QUERY SALDO TRIPLIKAT: GET /inventory/stock, GET /inventory/reports/
//      summary, dan GET /inventory/replenishment/suggestions masing-masing
//      punya query SUM+reserved sendiri yang nyaris identik — gampang drift
//      (satu diperbaiki, dua lainnya lupa ikut).
//
// ATURAN: SEMUA endpoint yang menulis stock_movements WAJIB lewat
// postStockMovement() di sini, di dalam prisma.$transaction (tx) — JANGAN
// lagi tx.stockMovement.create()/prisma.stockMovement.create() langsung
// dari route manapun. Pola locknya sama dengan recordActivity() di
// lib/activityLog.js: fungsi ini MENOLAK dipanggil dengan prisma singleton.

export class LedgerError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Status Material Issue yang "mereservasi" stok (belum keluar fisik, tapi
// sudah dijanjikan) — SATU tempat, dipakai computeStockSnapshot() di sini
// DAN diimpor ulang dari routes/materialIssue.js supaya definisi status
// yang MENULIS Reserved (PATCH status) dan yang MEMBACA Reserved
// (computeStockSnapshot) tidak bisa drift satu sama lain.
export const RESERVED_STATUSES = ["APPROVED", "READY_TO_PICK", "PICKED"];

const MOVEMENT_TYPES = ["RECEIPT", "ISSUE", "RETURN", "WASTE", "ADJUSTMENT", "TRANSFER"];

// Toleransi floating point — Decimal(12,4) di DB, float di JS. Selisih
// di bawah ini dianggap nol, bukan "negatif tipis" akibat pembulatan.
const EPSILON = 1e-6;

/**
 * Kunci satu baris tabel (SELECT ... FOR UPDATE) supaya transaksi lain yang
 * menyentuh baris yang SAMA menunggu sampai transaksi ini commit/rollback —
 * ini yang menutup celah TOCTOU (baca status di luar lock, tulis di dalam
 * transaksi terpisah) di semua endpoint "dokumen -> status tertentu -> tulis
 * ledger sekali saja".
 *
 * `table` SELALU literal internal dari kode ini sendiri (bukan input user)
 * — aman diinterpolasi langsung, tidak ada celah SQL injection.
 */
export async function lockRowForUpdate(tx, table, id) {
  if (!tx?.$queryRawUnsafe) {
    throw new Error("lockRowForUpdate butuh `tx` (klien transaksi Prisma), bukan prisma singleton di luar transaksi");
  }
  await tx.$queryRawUnsafe(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, id);
}

/**
 * Kunci baris material lalu hitung saldo BERJALAN (SUM ledger) dalam lock
 * yang sama — baca dan tulis jadi konsisten, tidak ada celah antara "baca
 * saldo" dan "tulis movement baru" seperti pola lama.
 */
export async function lockMaterialBalance(tx, materialId) {
  await lockRowForUpdate(tx, "materials", materialId);
  const [{ balance }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${materialId}::uuid
  `;
  return balance;
}

/**
 * SATU-SATUNYA jalan resmi menulis stock_movements. WAJIB dipanggil di
 * dalam prisma.$transaction (tx).
 *
 * Mengunci material, menghitung saldo berjalan, MENOLAK kalau hasil akhir
 * (saldo + qty) negatif — berlaku untuk SEMUA jenis movement, bukan cuma
 * ISSUE. Fisik tidak bisa punya stok minus, jadi invariant ini universal:
 * ADJUSTMENT/WASTE/TRANSFER keluar yang membuat saldo < 0 juga ditolak,
 * bukan cuma ISSUE seperti validasi lama.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
export async function postStockMovement(tx, {
  materialId, type, qty, location, unitId, unitCost, supplier, batchNumber,
  reason, note, createdById,
  goodsReceiptId, materialIssueId, stockTransferId, stockCountId,
  damagedStockRecordId, returnRecordId, stockAdjustmentRequestId,
} = {}) {
  if (!tx?.stockMovement) {
    throw new Error("postStockMovement butuh `tx` (klien transaksi Prisma), bukan prisma singleton di luar transaksi");
  }
  if (!materialId) throw new LedgerError("materialId wajib diisi");
  if (!MOVEMENT_TYPES.includes(type)) throw new LedgerError(`Jenis movement tidak valid: ${type}`);
  const qtyNum = Number(qty);
  if (!Number.isFinite(qtyNum) || qtyNum === 0) throw new LedgerError("Jumlah movement wajib diisi dan tidak boleh nol");

  const balance = await lockMaterialBalance(tx, materialId);
  const resultBalance = balance + qtyNum;
  if (resultBalance < -EPSILON) {
    const material = await tx.material.findUnique({ where: { id: materialId }, select: { code: true } });
    throw new LedgerError(
      `Stok ${material?.code || materialId} tidak cukup — tersedia ${balance}, butuh ${Math.abs(qtyNum)}`
    );
  }

  return tx.stockMovement.create({
    data: {
      materialId, type, qty: qtyNum,
      location: location || undefined,
      unitId: unitId || null,
      unitCost: unitCost != null && unitCost !== "" ? Number(unitCost) : null,
      supplier: supplier || null,
      batchNumber: batchNumber || null,
      reason: reason || null,
      note: note || null,
      createdById: createdById || null,
      goodsReceiptId: goodsReceiptId || null,
      materialIssueId: materialIssueId || null,
      stockTransferId: stockTransferId || null,
      stockCountId: stockCountId || null,
      damagedStockRecordId: damagedStockRecordId || null,
      returnRecordId: returnRecordId || null,
      stockAdjustmentRequestId: stockAdjustmentRequestId || null,
    },
    include: { material: { select: { code: true, name: true, unit: true } } },
  });
}

/**
 * Snapshot saldo SEMUA material aktif+nonaktif: on-hand (balance), reserved
 * (Material Issue APPROVED..PICKED), available (balance − reserved), plus
 * metadata dipakai UI (lastMovementAt, latestUnitCost). SUMBER TUNGGAL —
 * dipakai GET /inventory/stock, GET /inventory/reports/summary, dan
 * GET /inventory/replenishment/suggestions. Sebelumnya masing-masing
 * endpoint itu punya query SUM+reserved sendiri yang nyaris identik.
 *
 * `client` boleh `prisma` (baca biasa, di luar transaksi) atau `tx` (di
 * dalam transaksi) — murni SELECT, tidak mengunci apa pun.
 */
export async function computeStockSnapshot(client) {
  return client.$queryRaw`
    SELECT m.id AS "materialId", m.code, m.name, m.unit, m.active, m.category,
           m.service_line AS "serviceLine",
           m.reorder_point AS "reorderPoint", m.reorder_qty AS "reorderQty",
           COALESCE(SUM(sm.qty), 0)::float AS balance,
           COALESCE(res.reserved, 0)::float AS reserved,
           (COALESCE(SUM(sm.qty), 0) - COALESCE(res.reserved, 0))::float AS available,
           MAX(sm.created_at) AS "lastMovementAt",
           (SELECT sm2.unit_cost FROM stock_movements sm2
            WHERE sm2.material_id = m.id AND sm2.unit_cost IS NOT NULL
            ORDER BY sm2.created_at DESC LIMIT 1) AS "latestUnitCost"
    FROM materials m
    LEFT JOIN stock_movements sm ON sm.material_id = m.id
    LEFT JOIN (
      SELECT mil.material_id, SUM(mil.requested_qty) AS reserved
      FROM material_issue_lines mil
      JOIN material_issues mi ON mi.id = mil.material_issue_id
      WHERE mi.status = ANY(${RESERVED_STATUSES}::"IssueStatus"[])
      GROUP BY mil.material_id
    ) res ON res.material_id = m.id
    GROUP BY m.id, m.code, m.name, m.unit, m.active, m.category,
             m.service_line, m.reorder_point, m.reorder_qty, res.reserved
    ORDER BY m.code ASC
  `;
}

/** Status stok turunan — SAMA PERSIS dengan deriveStockStatusReal frontend
 * (features/warehouse/inventoryReal.js) supaya klasifikasi LOW/OUT/IN/
 * INACTIVE tidak bisa berbeda antara backend (Reports) dan frontend
 * (Stock & Material page). Dari `available`, BUKAN `balance` mentah. */
export function deriveStockStatus(row) {
  if (!row.active) return "INACTIVE";
  const available = row.available ?? row.balance;
  if (available <= 0) return "OUT_OF_STOCK";
  if (row.reorderPoint != null && available <= row.reorderPoint) return "LOW_STOCK";
  return "IN_STOCK";
}
