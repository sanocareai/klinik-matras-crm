import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { requireAuth } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "../../data/workflows.json");

export const automationRouter = express.Router();
automationRouter.use(requireAuth);

function readWorkflows() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return []; }
}
function writeWorkflows(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET /api/automation/workflows
automationRouter.get("/workflows", (req, res) => {
  res.json(readWorkflows());
});

// GET /api/automation/workflows/:id
automationRouter.get("/workflows/:id", (req, res) => {
  const wf = readWorkflows().find((w) => w.id === req.params.id);
  if (!wf) return res.status(404).json({ error: "Workflow tidak ditemukan" });
  res.json(wf);
});

// POST /api/automation/workflows
automationRouter.post("/workflows", (req, res) => {
  const { name, trigger, condition, action } = req.body;
  if (!name || !trigger || !action) return res.status(400).json({ error: "Nama, trigger, dan aksi wajib diisi" });

  const workflows = readWorkflows();
  const wf = {
    id: Date.now().toString(),
    name,
    trigger,
    condition: condition || null,
    action,
    active: false,
    runCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  workflows.push(wf);
  writeWorkflows(workflows);
  res.status(201).json(wf);
});

// PATCH /api/automation/workflows/:id
automationRouter.patch("/workflows/:id", (req, res) => {
  const workflows = readWorkflows();
  const idx = workflows.findIndex((w) => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Workflow tidak ditemukan" });
  Object.assign(workflows[idx], req.body, { id: workflows[idx].id, updatedAt: new Date().toISOString() });
  writeWorkflows(workflows);
  res.json(workflows[idx]);
});

// DELETE /api/automation/workflows/:id
automationRouter.delete("/workflows/:id", (req, res) => {
  const workflows = readWorkflows();
  const filtered = workflows.filter((w) => w.id !== req.params.id);
  if (filtered.length === workflows.length) return res.status(404).json({ error: "Tidak ditemukan" });
  writeWorkflows(filtered);
  res.json({ ok: true });
});
