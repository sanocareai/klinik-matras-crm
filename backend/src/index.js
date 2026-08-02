import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { initSocket } from "./socket.js";

import { webhookRouter }    from "./routes/webhooks.js";
import { productRouter }    from "./routes/products.js";
import { authRouter }       from "./routes/auth.js";
import { conversationRouter } from "./routes/conversations.js";
import { customerRouter }   from "./routes/customers.js";
import { analyticsRouter }  from "./routes/analytics.js";
import { intelligenceRouter } from "./routes/intelligence.js";
import { orderRouter }      from "./routes/orders.js";
import { dashboardRouter }  from "./routes/dashboard.js";
import { userRouter }       from "./routes/users.js";
import { pipelineRouter }   from "./routes/pipeline.js";
import { broadcastRouter }  from "./routes/broadcast.js";
import { automationRouter } from "./routes/automation.js";
import { aiRouter }         from "./routes/ai.js";
import { replyAssistantRouter } from "./routes/replyAssistant.js";
import { knowledgeRouter }  from "./routes/knowledge.js";
import { settingsRouter }  from "./routes/settings.js";
import { templateRouter }  from "./routes/templates.js";
import { trackingRouter, trackingRedirectRouter } from "./routes/tracking.js";
import { internalRouter } from "./routes/internal.js";
import { sseRouter }      from "./routes/sse.js";
import { adminRouter }    from "./routes/admin.js";
import { unitRouter }     from "./routes/units.js";
import { productionRouter } from "./routes/production.js";
import { armadaRouter }     from "./routes/armada.js";
import { kendaliRouter }    from "./routes/kendali.js";
import { inventoryRouter }  from "./routes/inventory.js";
import { goodsReceiptRouter } from "./routes/goodsReceipt.js";
import { materialIssueRouter } from "./routes/materialIssue.js";
import { stockTransferRouter } from "./routes/stockTransfer.js";
import { stockCountRouter } from "./routes/stockCount.js";
import { damagedStockRouter } from "./routes/damagedStock.js";
import { returnRecordRouter } from "./routes/returnRecord.js";
import { stockAdjustmentRouter } from "./routes/stockAdjustment.js";
import { scopeRevisionRouter } from "./routes/scopeRevisions.js";
import { masterDataRouter } from "./routes/masterData.js";
import { startReconciliationJob } from "./services/reconciliation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pastikan direktori uploads ada
import { mkdirSync } from "fs";
const uploadsDir    = path.join(__dirname, "../uploads");
const productsDir   = path.join(__dirname, "../data/products");
const unitPhotosDir = path.join(__dirname, "../data/unit-photos");
const jobPhotosDir  = path.join(__dirname, "../data/job-photos");
const paymentProofsDir = path.join(__dirname, "../data/payment-proofs");
// Bukti temuan bongkar & bukti persetujuan customer (PRD §7.4) — dir SENDIRI,
// terpisah dari foto proses produksi: kepentingan hukum & umur simpannya beda.
const scopeRevisionPhotosDir = path.join(__dirname, "../data/scope-revision-photos");
mkdirSync(uploadsDir,    { recursive: true });
mkdirSync(productsDir,   { recursive: true });
mkdirSync(unitPhotosDir, { recursive: true });
mkdirSync(jobPhotosDir,  { recursive: true });
mkdirSync(paymentProofsDir, { recursive: true });
mkdirSync(scopeRevisionPhotosDir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Sajikan file media yang diupload
app.use("/uploads",           express.static(uploadsDir));
app.use("/media/unit-photos", express.static(unitPhotosDir));
app.use("/media/job-photos",  express.static(jobPhotosDir));
app.use("/media/payment-proofs", express.static(paymentProofsDir));
app.use("/media/scope-revision-photos", express.static(scopeRevisionPhotosDir));
app.use("/media/products", express.static(productsDir));

app.use("/api/webhooks",     webhookRouter);
app.use("/api/auth",         authRouter);
app.use("/api/conversations", conversationRouter);
app.use("/api/customers",    customerRouter);
app.use("/api/analytics",    analyticsRouter);
app.use("/api/intelligence", intelligenceRouter);
app.use("/api/orders",       orderRouter);
app.use("/api/dashboard",    dashboardRouter);
app.use("/api/users",        userRouter);
app.use("/api/pipeline",     pipelineRouter);
app.use("/api/broadcast",    broadcastRouter);
app.use("/api/automation",   automationRouter);
app.use("/api/ai",           aiRouter);
app.use("/api/ai",           replyAssistantRouter); // Wave 4B.0 — additive, tidak mengubah aiRouter
app.use("/api/knowledge",    knowledgeRouter);
// Sano Hub Phase 1 — dijaga permission (UNIT_STAGE_WRITE/QC_WRITE/dst).
// Tidak ada user existing yang punya role produksi, jadi mounting ini AMAN:
// endpointnya ada tapi tidak ada satu pun akun yang bisa memakainya sampai
// role diberikan lewat UserRole. Lihat docs/sano-hub/PHASE-0.md.
app.use("/api/units",        unitRouter);
app.use("/api/production",   productionRouter);
app.use("/api/armada",       armadaRouter);
app.use("/api/kendali",      kendaliRouter);
app.use("/api/inventory",    inventoryRouter);
app.use("/api/inventory/goods-receipts", goodsReceiptRouter);
app.use("/api/inventory/material-issues", materialIssueRouter);
app.use("/api/inventory/transfers", stockTransferRouter);
app.use("/api/inventory/stock-counts", stockCountRouter);
app.use("/api/inventory/damaged-stock", damagedStockRouter);
app.use("/api/inventory/returns", returnRecordRouter);
app.use("/api/inventory/adjustments", stockAdjustmentRouter);
app.use("/api/scope-revisions", scopeRevisionRouter);
app.use("/api/settings",    settingsRouter);
app.use("/api/templates",   templateRouter);
app.use("/api/products",    productRouter);
app.use("/api/tracking",   trackingRouter);
app.use("/api/internal",   internalRouter);
app.use("/api/events",     sseRouter);
app.use("/api/admin",      adminRouter);
app.use("/api/master-data", masterDataRouter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Redirect publik tracking link — HARUS di atas static files agar tidak ditangkap React SPA
app.use("/r", trackingRedirectRouter);

// Di production, sajikan build React dari sini juga (1 server untuk API + frontend)
import fs from "fs";
const frontendDist = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "Not found" });
  const indexFile = path.join(frontendDist, "index.html");
  if (!fs.existsSync(indexFile)) {
    return res.status(200).send("Backend jalan. Buka http://localhost:5173 untuk development.");
  }
  res.sendFile(indexFile);
});

const PORT = process.env.PORT || 4000;
// http.createServer dibutuhkan supaya Socket.IO bisa attach ke server yang
// SAMA dengan Express (bukan server terpisah/port lain) — app.listen() biasa
// sebenarnya juga bikin http.Server di baliknya, tapi kita perlu instance-nya
// secara eksplisit untuk dikasih ke initSocket().
const server = http.createServer(app);
initSocket(server);
server.listen(PORT, () => {
  console.log(`Backend jalan di http://localhost:${PORT}`);
  startReconciliationJob();
});
