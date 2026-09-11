import "./env.js"; // urutan WAJIB pertama — sebelum apa pun yang import src/db.js
import express from "express";

// App Express MINIMAL berisi HANYA router Gudang & yang berkaitan (Unit/
// Production untuk endpoint pemakaian bahan) — SENGAJA TIDAK mengimpor
// src/index.js utuh. index.js memuat SELURUH aplikasi sekaligus: worker
// broadcast, cron (SLA alert, stale lead, quality scorer, dst), koneksi
// WAHA, Socket.IO — semuanya akan ikut start kalau diimpor apa adanya,
// menimbulkan efek samping yang tidak berkaitan sama sekali dengan test
// inventory (dan bisa membuat test flaky/lambat/gagal karena WAHA/koneksi
// eksternal tidak tersedia di lingkungan tes). Router yang diimpor di sini
// ADALAH kode asli yang sama persis dijalankan produksi — bukan tiruan.
const { inventoryRouter } = await import("../../../src/routes/inventory.js");
const { goodsReceiptRouter } = await import("../../../src/routes/goodsReceipt.js");
const { materialIssueRouter } = await import("../../../src/routes/materialIssue.js");
const { stockTransferRouter } = await import("../../../src/routes/stockTransfer.js");
const { stockCountRouter } = await import("../../../src/routes/stockCount.js");
const { damagedStockRouter } = await import("../../../src/routes/damagedStock.js");
const { returnRecordRouter } = await import("../../../src/routes/returnRecord.js");
const { stockAdjustmentRouter } = await import("../../../src/routes/stockAdjustment.js");
const { replenishmentRouter } = await import("../../../src/routes/replenishment.js");
const { warehouseReportsRouter } = await import("../../../src/routes/warehouseReports.js");
const { unitRouter } = await import("../../../src/routes/units.js");

export function buildTestApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Mount path PERSIS sama dengan src/index.js — supaya perilaku (termasuk
  // urutan match Express untuk path yang tumpang-tindih, mis.
  // /api/inventory vs /api/inventory/goods-receipts) identik dengan
  // produksi.
  app.use("/api/units", unitRouter);
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/inventory/goods-receipts", goodsReceiptRouter);
  app.use("/api/inventory/material-issues", materialIssueRouter);
  app.use("/api/inventory/transfers", stockTransferRouter);
  app.use("/api/inventory/stock-counts", stockCountRouter);
  app.use("/api/inventory/damaged-stock", damagedStockRouter);
  app.use("/api/inventory/returns", returnRecordRouter);
  app.use("/api/inventory/adjustments", stockAdjustmentRouter);
  app.use("/api/inventory/replenishment", replenishmentRouter);
  app.use("/api/inventory/reports", warehouseReportsRouter);

  return app;
}

/** Start di port acak (0) — kembalikan base URL dipakai fetch() + fungsi close(). */
export function startTestServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}
