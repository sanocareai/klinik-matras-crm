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
const { financeRouter } = await import("../../../src/routes/finance.js");
const { financeTxRouter } = await import("../../../src/routes/financeTransactions.js");
// expenseSubmissionRouter (24 September 2026) — Pengajuan Biaya Lintas
// Divisi, pilot Delivery. Kode ASLI produksi, sama pola dengan router lain
// di file ini, additive di prefix /api/finance yang sama.
const { expenseSubmissionRouter } = await import("../../../src/routes/expenseSubmissions.js");
const { financeKasbonRouter } = await import("../../../src/routes/financeKasbon.js");
const { financePenerimaanRouter } = await import("../../../src/routes/financePenerimaan.js");
const { financePushHooks } = await import("../../../src/middleware/financePushHooks.js");
const { financePemasukanRouter } = await import("../../../src/routes/financePemasukan.js");
const { financeApprovalsRouter } = await import("../../../src/routes/financeApprovals.js");
const { financePembayaranRouter } = await import("../../../src/routes/financePembayaran.js");
const { financeTransaksiRouter } = await import("../../../src/routes/financeTransaksi.js");
const { financeBukuRouter } = await import("../../../src/routes/financeBuku.js");
const { financeMediaRouter, financeReceiptsLegacyPathRouter, financePaymentProofsPathRouter } = await import("../../../src/routes/financeMedia.js");
const { mobileRouter } = await import("../../../src/routes/mobileAuth.js");
const { authRouter } = await import("../../../src/routes/auth.js");
const { userRouter } = await import("../../../src/routes/users.js");
// armadaRouter (22 September 2026) — ditambahkan supaya GET /armada/my-jobs
// bisa dites integrasi sungguhan (bug RTE-220926-01/02, lihat
// myJobsRouteCentric.integration.test.js). Kode ASLI yang sama persis
// dipakai produksi, bukan tiruan — sama filosofi dengan router lain di file
// ini.
const { armadaRouter } = await import("../../../src/routes/armada.js");
// incentiveSnapshotRouter (24 September 2026) — sama pola dengan armadaRouter
// di atas: kode ASLI produksi, additive di prefix /api/armada yang sama.
const { incentiveSnapshotRouter } = await import("../../../src/routes/incentiveSnapshot.js");
const { incentivePayoutRouter } = await import("../../../src/routes/incentivePayout.js");

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
  // Mount PERSIS urutan src/index.js: financeRouter dulu, financeTxRouter
  // additive di path yang SAMA (lihat komentar di index.js).
  app.use("/api/finance", financePushHooks);
  app.use("/api/finance", financeRouter);
  app.use("/api/finance", financeTxRouter);
  app.use("/api/finance", expenseSubmissionRouter);
  app.use("/api/finance", financeKasbonRouter);
  app.use("/api/finance", financePenerimaanRouter);
  app.use("/api/finance", financeApprovalsRouter);
  app.use("/api/finance", financePemasukanRouter);
  app.use("/api/finance", financePembayaranRouter);
  app.use("/api/finance", financeTransaksiRouter);
  app.use("/api/finance", financeBukuRouter);
  app.use("/api/finance", financeMediaRouter);
  app.use("/media/finance-receipts", financeReceiptsLegacyPathRouter);
  app.use("/media/bukti-pembayaran", financePaymentProofsPathRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", userRouter);
  app.use("/api/mobile", mobileRouter);
  app.use("/api/armada", armadaRouter);
  app.use("/api/armada", incentiveSnapshotRouter);
  app.use("/api/armada", incentivePayoutRouter);

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
