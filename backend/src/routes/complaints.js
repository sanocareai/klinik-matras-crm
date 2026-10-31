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
  ComplaintError, complaintCaseInclude, STATUS_LABEL,
  createComplaintCase, updateComplaintFields, transitionStatus,
  createDeliveryTask, linkQcFitTest, logFollowUp, confirmCustomer,
  waiveRedelivery,
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

// Status yang sudah tutup (riwayat) vs aktif. SELESAI hanya bisa dicapai lewat /confirm-customer (gerbang konfirmasi customer tidak berubah).
const STATUS_TUTUP = ["SELESAI", "DIBATALKAN"];
const STATUS_VALID = Object.keys(STATUS_LABEL);
export const BATAS_HALAMAN_MAKS = 300; // sama dengan batas lama; sekarang disertai total + hasMore supaya pemotongan TIDAK PERNAH diam-diam

// Parameter daftar → { where, orderBy, take, skip }. Masukan tidak valid = 400 (bukan 500 dari Prisma). Aditif: pemanggil lama (orderId/unitId/status/currentOwner saja) berperilaku sama.
export function bacaParamDaftar(q = {}) {
  const { orderId, unitId, status, statuses, currentOwner, scope, q: kata } = q;
  const daftar = [...(status ? [String(status)] : []), ...(statuses ? String(statuses).split(",").map((x) => x.trim()).filter(Boolean) : [])];
  for (const st of daftar) if (!STATUS_VALID.includes(st)) throw new ComplaintError(`Status "${st}" tidak dikenal`);
  if (scope !== undefined && scope !== "" && !["aktif", "riwayat"].includes(scope)) throw new ComplaintError('scope harus "aktif" atau "riwayat"');
  const limit = q.limit === undefined || q.limit === "" ? BATAS_HALAMAN_MAKS : Number(q.limit);
  const offset = q.offset === undefined || q.offset === "" ? 0 : Number(q.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > BATAS_HALAMAN_MAKS) throw new ComplaintError(`limit harus bilangan bulat 1–${BATAS_HALAMAN_MAKS}`);
  if (!Number.isInteger(offset) || offset < 0) throw new ComplaintError("offset harus bilangan bulat ≥ 0");
  const AND = [];
  if (daftar.length) AND.push({ status: { in: daftar } });
  if (scope === "aktif") AND.push({ status: { notIn: STATUS_TUTUP } });
  if (scope === "riwayat") AND.push({ status: { in: STATUS_TUTUP } });
  const teks = String(kata ?? "").trim().slice(0, 80);
  if (teks) AND.push({ OR: [
    { caseNumber: { contains: teks, mode: "insensitive" } }, { description: { contains: teks, mode: "insensitive" } },
    { order: { orderNumber: { contains: teks, mode: "insensitive" } } }, { order: { customer: { name: { contains: teks, mode: "insensitive" } } } },
  ] });
  return {
    where: { ...(orderId && { orderId }), ...(unitId && { unitId }), ...(currentOwner && { currentOwner }), ...(AND.length && { AND }) },
    // Aktif: yang paling mendesak dulu (enum urut RENDAH<SEDANG<TINGGI<KRITIS → desc = Kritis di atas), lalu terbaru. Lainnya: terbaru. id = tie-break supaya halaman berurutan stabil.
    orderBy: scope === "aktif" ? [{ severity: "desc" }, { createdAt: "desc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "asc" }],
    take: limit, skip: offset, limit, offset,
  };
}

// GET /api/complaints?orderId=&unitId=&status=&statuses=A,B&currentOwner=&scope=aktif|riwayat&q=&limit=&offset=
// Respons: { cases, total, limit, offset, hasMore } — total = SELURUH hasil filter (bukan hanya halaman ini).
complaintsRouter.get("/", requirePermission(P.COMPLAINT_READ), async (req, res) => {
  try {
    const { where, orderBy, take, skip, limit, offset } = bacaParamDaftar(req.query);
    const [cases, total] = await Promise.all([
      prisma.complaintCase.findMany({ where, include: complaintCaseInclude, orderBy, take, skip }),
      prisma.complaintCase.count({ where }),
    ]);
    res.json({ cases, total, limit, offset, hasMore: offset + cases.length < total });
  } catch (err) {
    handleErr(err, res);
  }
});

// GET /api/complaints/ringkasan — jumlah per status (seluruh kasus) + prioritas + lewat target. Untuk kartu angka & penghitung tahap; TIDAK bergantung pada halaman yang sudah dimuat.
complaintsRouter.get("/ringkasan", requirePermission(P.COMPLAINT_READ), async (req, res) => {
  try {
    const { currentOwner } = req.query;
    const dasar = currentOwner ? { currentOwner: String(currentOwner) } : {};
    if (currentOwner && !["SALES", "DELIVERY", "PRODUCTION", "WAREHOUSE", "QC"].includes(String(currentOwner))) throw new ComplaintError("Divisi pemegang kasus tidak valid");
    const aktif = { ...dasar, status: { notIn: STATUS_TUTUP } };
    const [perStatus, prioritas, lewatTarget] = await Promise.all([
      prisma.complaintCase.groupBy({ by: ["status"], where: dasar, _count: { _all: true } }),
      prisma.complaintCase.count({ where: { ...aktif, severity: { in: ["TINGGI", "KRITIS"] } } }),
      prisma.complaintCase.count({ where: { ...aktif, targetCompletionAt: { lt: new Date() } } }),
    ]);
    const hitung = Object.fromEntries(STATUS_VALID.map((st) => [st, 0]));
    for (const g of perStatus) hitung[g.status] = g._count._all;
    const jumlahAktif = STATUS_VALID.filter((st) => !STATUS_TUTUP.includes(st)).reduce((n, st) => n + hitung[st], 0);
    res.json({ perStatus: hitung, aktif: jumlahAktif, riwayat: hitung.SELESAI + hitung.DIBATALKAN, selesai: hitung.SELESAI, dibatalkan: hitung.DIBATALKAN, prioritas, lewatTarget });
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
// SATU-SATUNYA jalan mencapai status SELESAI. Sejak 31 Oktober 2026 (insiden
// Sony) menolak kasus yang punya Job DELIVERY aktif terkait — lihat
// assertRedeliveryCompleted di services/complaintCase.js.
complaintsRouter.post("/:id/confirm-customer", requirePermission(P.ORDER_WRITE), async (req, res) => {
  try {
    const kase = await confirmCustomer(req.params.id, req.user.id);
    res.json(kase);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/complaints/:id/waive-redelivery — { reason } Dijaga ORDER_WRITE
// (Sales, permission SAMA dengan confirm-customer — ini keputusan resolusi,
// bukan aksi divisi Delivery). SATU-SATUNYA jalan melewati gerbang redelivery
// tanpa job DELIVERY benar-benar COMPLETED+POD — lihat waiveRedelivery di
// services/complaintCase.js untuk kapan ini relevan dan kenapa job yang
// BELUM berjalan ikut dibatalkan (bukan dibiarkan nyangkut) sebagai bagian
// dari aksi yang sama.
complaintsRouter.post("/:id/waive-redelivery", requirePermission(P.ORDER_WRITE), async (req, res) => {
  try {
    const kase = await waiveRedelivery(req.params.id, req.body.reason, req.user.id);
    res.json(kase);
  } catch (err) {
    handleErr(err, res);
  }
});
