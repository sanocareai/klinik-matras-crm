// Complaint / After-Sales Case — permukaan HTTP (D-116, 11 September 2026).
// Logika inti ada di services/complaintCase.js — lihat catatan panjang di
// sana dan di schema.prisma model ComplaintCase untuk latar belakang.
//
// ATURAN PERMISSION (ringkas, detail penuh ada di constants/permissions.js):
// COMPLAINT_READ/WRITE dipegang LINTAS divisi (Sales/Delivery/Produksi/
// Warehouse/QC) untuk field kasus itu sendiri. Aksi yang menyentuh entitas
// divisi LAIN (bikin Job, bikin Material Issue, tautkan QC, override status
// order) tetap dijaga permission ASLI divisi itu — COMPLAINT_WRITE bukan
// pintu belakang ke sana.

import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { createMaterialIssue } from "./materialIssue.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { notifyComplaintCaseOwnerChanged } from "../services/pushNotifications.js";
import {
  ComplaintError, complaintCaseInclude,
  createComplaintCase, updateComplaintFields, transitionStatus,
  createDeliveryTask, linkQcFitTest, logFollowUp, confirmCustomer,
} from "../services/complaintCase.js";

export const complaintsRouter = express.Router();
complaintsRouter.use(requireAuth);

function handleErr(err, res) {
  if (err instanceof ComplaintError || typeof err.statusCode === "number") {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Complaint case error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

// GET /api/complaints?orderId=&unitId=&status=&currentOwner=
complaintsRouter.get("/", requirePermission(P.COMPLAINT_READ), async (req, res) => {
  try {
    const { orderId, unitId, status, currentOwner } = req.query;
    const cases = await prisma.complaintCase.findMany({
      where: {
        ...(orderId && { orderId }),
        ...(unitId && { unitId }),
        ...(status && { status }),
        ...(currentOwner && { currentOwner }),
      },
      include: complaintCaseInclude,
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    res.json({ cases });
  } catch (err) {
    handleErr(err, res);
  }
});

complaintsRouter.get("/:id", requirePermission(P.COMPLAINT_READ), async (req, res) => {
  try {
    const kase = await prisma.complaintCase.findUnique({ where: { id: req.params.id }, include: complaintCaseInclude });
    if (!kase) return res.status(404).json({ error: "Kasus tidak ditemukan" });
    res.json(kase);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/complaints — dibuka Sales dari Order Detail (juga bisa dari
// divisi lain yang pegang COMPLAINT_WRITE, mis. dispatcher mencatat komplain
// yang disampaikan langsung ke driver di lapangan).
complaintsRouter.post("/", requirePermission(P.COMPLAINT_WRITE), async (req, res) => {
  try {
    const kase = await createComplaintCase(req.body, req.user.id);
    res.status(201).json(kase);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/complaints/:id — field non-status (kategori/severity/warranty/
// root cause/resolution/biaya/target/attachment). Status TIDAK bisa diubah
// lewat sini — lihat POST /:id/status.
complaintsRouter.patch("/:id", requirePermission(P.COMPLAINT_WRITE), async (req, res) => {
  try {
    const { status, currentOwner, ...fields } = req.body;
    if (status !== undefined || currentOwner !== undefined) {
      throw new ComplaintError("Gunakan POST /:id/status untuk mengubah status/pemegang kasus");
    }
    const kase = await updateComplaintFields(req.params.id, fields, req.user.id);
    res.json(kase);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/complaints/:id/status — transisi status manual. SELESAI ditolak
// di sini (lihat services/complaintCase.js), harus lewat /confirm-customer.
complaintsRouter.post("/:id/status", requirePermission(P.COMPLAINT_WRITE), async (req, res) => {
  try {
    const kase = await transitionStatus(req.params.id, req.body, req.user.id);
    res.json(kase);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/complaints/:id/delivery-task — { jobType: "PICKUP"|"DELIVERY", accessNotes? }
// Dijaga JOB_WRITE (permission ASLI Delivery), bukan COMPLAINT_WRITE — sesuai
// prinsip di kepala file.
complaintsRouter.post("/:id/delivery-task", requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const kase = await createDeliveryTask(req.params.id, req.body, req.user.id);
    res.status(201).json(kase);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/complaints/:id/material-requirement — body SAMA dengan
// POST /api/inventory/material-issues, ditambah otomatis sourceType
// COMPLAINT_REWORK + complaintCaseId + unitId (kalau kasus punya unit).
// Dijaga INVENTORY_WRITE (permission ASLI Warehouse).
complaintsRouter.post("/:id/material-requirement", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const kase = await prisma.complaintCase.findUnique({ where: { id: req.params.id } });
    if (!kase) return res.status(404).json({ error: "Kasus tidak ditemukan" });

    const issue = await createMaterialIssue({
      ...req.body,
      sourceType: "COMPLAINT_REWORK",
      unitId: req.body.unitId || kase.unitId || undefined,
      sourceReference: kase.caseNumber,
      complaintCaseId: kase.id,
    }, req.user.id);

    await prisma.$transaction(async (tx) => {
      if (["BARU", "VERIFIKASI", "INVESTIGASI", "ACTION_REQUIRED", "DIJADWALKAN", "DALAM_PENANGANAN"].includes(kase.status)) {
        await tx.complaintCase.update({ where: { id: kase.id }, data: { status: "MENUNGGU_MATERIAL", currentOwner: "WAREHOUSE" } });
      }
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.COMPLAINT, entityId: kase.id, eventType: EVENT_TYPES.COMPLAINT_MATERIAL_REQUESTED,
        actorId: req.user.id, metadata: { issueNumber: issue.issueNumber, materialIssueId: issue.id },
      });
    });

    const full = await prisma.complaintCase.findUnique({ where: { id: kase.id }, include: complaintCaseInclude });
    if (full.currentOwner === "WAREHOUSE") {
      notifyComplaintCaseOwnerChanged(full).catch((e) => console.error("[complaints] notifikasi gagal:", e.message));
    }
    res.status(201).json(full);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/complaints/:id/link-qc — { qcFitTestId }. Dijaga QC_WRITE.
complaintsRouter.post("/:id/link-qc", requirePermission(P.QC_WRITE), async (req, res) => {
  try {
    const kase = await linkQcFitTest(req.params.id, req.body.qcFitTestId, req.user.id);
    res.json(kase);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/complaints/:id/follow-up — { note }. Dijaga ORDER_WRITE (Sales).
complaintsRouter.post("/:id/follow-up", requirePermission(P.ORDER_WRITE), async (req, res) => {
  try {
    const kase = await logFollowUp(req.params.id, req.body.note, req.user.id);
    res.status(201).json(kase);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/complaints/:id/confirm-customer — Dijaga ORDER_WRITE (Sales).
// SATU-SATUNYA jalan mencapai status SELESAI.
complaintsRouter.post("/:id/confirm-customer", requirePermission(P.ORDER_WRITE), async (req, res) => {
  try {
    const kase = await confirmCustomer(req.params.id, req.user.id);
    res.json(kase);
  } catch (err) {
    handleErr(err, res);
  }
});
