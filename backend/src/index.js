import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { webhookRouter }    from "./routes/webhooks.js";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

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

app.get("/api/health", (req, res) => res.json({ ok: true }));

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
