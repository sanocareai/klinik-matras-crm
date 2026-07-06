import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { webhookRouter }    from "./routes/webhooks.js";
import { productRouter }    from "./routes/products.js";
import { authRouter }       from "./routes/auth.js";
import { conversationRouter } from "./routes/conversations.js";
import { customerRouter }   from "./routes/customers.js";
import { analyticsRouter }  from "./routes/analytics.js";
import { orderRouter }      from "./routes/orders.js";
import { dashboardRouter }  from "./routes/dashboard.js";
import { userRouter }       from "./routes/users.js";
import { pipelineRouter }   from "./routes/pipeline.js";
import { broadcastRouter }  from "./routes/broadcast.js";
import { automationRouter } from "./routes/automation.js";
import { aiRouter }         from "./routes/ai.js";
import { knowledgeRouter }  from "./routes/knowledge.js";
import { settingsRouter }  from "./routes/settings.js";
import { templateRouter }  from "./routes/templates.js";
import { trackingRouter, trackingRedirectRouter } from "./routes/tracking.js";
import { internalRouter } from "./routes/internal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pastikan direktori uploads ada
import { mkdirSync } from "fs";
const uploadsDir  = path.join(__dirname, "../uploads");
const productsDir = path.join(__dirname, "../data/products");
mkdirSync(uploadsDir,  { recursive: true });
mkdirSync(productsDir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Sajikan file media yang diupload
app.use("/uploads",        express.static(uploadsDir));
app.use("/media/products", express.static(productsDir));

app.use("/api/webhooks",     webhookRouter);
app.use("/api/auth",         authRouter);
app.use("/api/conversations", conversationRouter);
app.use("/api/customers",    customerRouter);
app.use("/api/analytics",    analyticsRouter);
app.use("/api/orders",       orderRouter);
app.use("/api/dashboard",    dashboardRouter);
app.use("/api/users",        userRouter);
app.use("/api/pipeline",     pipelineRouter);
app.use("/api/broadcast",    broadcastRouter);
app.use("/api/automation",   automationRouter);
app.use("/api/ai",           aiRouter);
app.use("/api/knowledge",    knowledgeRouter);
app.use("/api/settings",    settingsRouter);
app.use("/api/templates",   templateRouter);
app.use("/api/products",    productRouter);
app.use("/api/tracking",   trackingRouter);
app.use("/api/internal",   internalRouter);

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
app.listen(PORT, () => console.log(`Backend jalan di http://localhost:${PORT}`));
