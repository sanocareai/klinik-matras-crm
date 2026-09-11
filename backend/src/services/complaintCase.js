// Complaint / After-Sales Case — SATU sumber kebenaran komplain lintas divisi
// (D-116, 11 September 2026). Lihat catatan panjang di schema.prisma model
// ComplaintCase untuk latar belakang lengkap (kenapa dua jalur lama —
// PATCH /orders/:id/complaint & UnitRevision — tidak cukup).
//
// Fungsi di sini MURNI logika kasus (create/transition/link) — aksi yang
// menyentuh entitas divisi lain (Job, MaterialIssue) TETAP dipanggil dari
// routes/complaints.js supaya permission ASLI divisi itu (JOB_WRITE/
// INVENTORY_WRITE/QC_WRITE) yang menjaga, bukan COMPLAINT_WRITE generik.

import { prisma } from "../db.js";
import { generateComplaintCaseNumber } from "./orderNumberGenerator.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { notifyComplaintCaseOwnerChanged, notifyComplaintCaseHighSeverity } from "./pushNotifications.js";

// Best-effort, TIDAK PERNAH menggagalkan aksi utama — pola SAMA dengan
// notifyDriverGroup dkk di routes/armada.js. Dipanggil SETELAH transaksi
// commit (bukan di dalamnya): kalau push gagal, kasus TETAP tersimpan.
function beritahuBestEffort(fn, ...args) {
  fn(...args).catch((err) => console.error("[complaintCase] notifikasi gagal:", err.message));
}

export class ComplaintError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const COMPLAINT_CATEGORIES = [
  "KUALITAS_PRODUK", "KENYAMANAN", "KETERLAMBATAN", "KERUSAKAN_TRANSIT", "SALAH_SPESIFIKASI", "LAYANAN_STAF", "LAINNYA",
];
export const COMPLAINT_SEVERITIES = ["RENDAH", "SEDANG", "TINGGI", "KRITIS"];
export const COMPLAINT_WARRANTY_STATUSES = ["BELUM_DITENTUKAN", "DALAM_GARANSI", "DILUAR_GARANSI"];
export const COMPLAINT_OWNERS = ["SALES", "DELIVERY", "PRODUCTION", "WAREHOUSE", "QC"];

export const CATEGORY_LABEL = {
  KUALITAS_PRODUK: "Kualitas Produk",
  KENYAMANAN: "Kenyamanan",
  KETERLAMBATAN: "Keterlambatan",
  KERUSAKAN_TRANSIT: "Kerusakan Saat Transit",
  SALAH_SPESIFIKASI: "Salah Spesifikasi",
  LAYANAN_STAF: "Layanan Staf",
  LAINNYA: "Lainnya",
};

export const STATUS_LABEL = {
  BARU: "Baru",
  VERIFIKASI: "Verifikasi",
  INVESTIGASI: "Investigasi",
  ACTION_REQUIRED: "Perlu Tindakan",
  DIJADWALKAN: "Dijadwalkan",
  DALAM_PENANGANAN: "Dalam Penanganan",
  QC: "QC",
  SIAP_DIKIRIM: "Siap Dikirim",
  DIKIRIM_ULANG: "Dikirim Ulang",
  KONFIRMASI_CUSTOMER: "Konfirmasi Customer",
  SELESAI: "Selesai",
  MENUNGGU_CUSTOMER: "Menunggu Customer",
  MENUNGGU_MATERIAL: "Menunggu Material",
  MENUNGGU_JADWAL: "Menunggu Jadwal",
  DIBATALKAN: "Dibatalkan",
};

// Divisi DEFAULT yang pegang bola untuk tiap status — dipakai kalau body
// request TIDAK mengirim currentOwner secara eksplisit. Staf tetap boleh
// override manual (mis. kasus DALAM_PENANGANAN tapi lagi nunggu approval
// dari Sales) lewat field currentOwner terpisah, ini cuma nilai wajar.
const DEFAULT_OWNER_BY_STATUS = {
  BARU: "SALES",
  VERIFIKASI: "SALES",
  INVESTIGASI: "SALES",
  ACTION_REQUIRED: "SALES",
  DIJADWALKAN: "DELIVERY",
  DALAM_PENANGANAN: "PRODUCTION",
  QC: "QC",
  SIAP_DIKIRIM: "DELIVERY",
  DIKIRIM_ULANG: "DELIVERY",
  KONFIRMASI_CUSTOMER: "SALES",
  SELESAI: "SALES",
  MENUNGGU_CUSTOMER: "SALES",
  MENUNGGU_MATERIAL: "WAREHOUSE",
  MENUNGGU_JADWAL: "DELIVERY",
  DIBATALKAN: "SALES",
};

// Graf transisi yang SAH. TIDAK linear kaku — kasus ringan boleh lompat
// (mis. ACTION_REQUIRED → SIAP_DIKIRIM kalau cuma kirim ulang barang
// pengganti tanpa produksi ulang), dan status pengecualian MENUNGGU_* bisa
// kembali ke beberapa titik berbeda di alur utama tergantung konteks.
// SELESAI SENGAJA tidak muncul sebagai tujuan di sini — hanya bisa dicapai
// lewat POST /complaints/:id/confirm-customer (lihat confirmCustomer di
// bawah), supaya "kasus selesai" TIDAK PERNAH bisa ditulis tanpa konfirmasi
// customer eksplisit, sesuai instruksi.
const ALLOWED_TRANSITIONS = {
  BARU: ["VERIFIKASI", "DIBATALKAN"],
  VERIFIKASI: ["INVESTIGASI", "ACTION_REQUIRED", "MENUNGGU_CUSTOMER", "DIBATALKAN"],
  INVESTIGASI: ["ACTION_REQUIRED", "MENUNGGU_CUSTOMER", "DIBATALKAN"],
  ACTION_REQUIRED: ["DIJADWALKAN", "SIAP_DIKIRIM", "MENUNGGU_JADWAL", "MENUNGGU_MATERIAL", "DIBATALKAN"],
  DIJADWALKAN: ["DALAM_PENANGANAN", "MENUNGGU_JADWAL", "MENUNGGU_MATERIAL", "DIBATALKAN"],
  DALAM_PENANGANAN: ["QC", "MENUNGGU_MATERIAL", "DIBATALKAN"],
  QC: ["SIAP_DIKIRIM", "DALAM_PENANGANAN", "DIBATALKAN"], // DALAM_PENANGANAN = QC gagal, balik rework
  SIAP_DIKIRIM: ["DIKIRIM_ULANG", "MENUNGGU_JADWAL", "DIBATALKAN"],
  DIKIRIM_ULANG: ["KONFIRMASI_CUSTOMER", "DIBATALKAN"],
  KONFIRMASI_CUSTOMER: ["MENUNGGU_CUSTOMER", "DALAM_PENANGANAN", "DIBATALKAN"], // DALAM_PENANGANAN = customer masih belum puas
  MENUNGGU_CUSTOMER: ["VERIFIKASI", "INVESTIGASI", "ACTION_REQUIRED", "KONFIRMASI_CUSTOMER", "DIBATALKAN"],
  MENUNGGU_MATERIAL: ["ACTION_REQUIRED", "DIJADWALKAN", "DALAM_PENANGANAN", "DIBATALKAN"],
  MENUNGGU_JADWAL: ["ACTION_REQUIRED", "DIJADWALKAN", "SIAP_DIKIRIM", "DIBATALKAN"],
  SELESAI: [],
  DIBATALKAN: [],
};

export function assertValidTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new ComplaintError(
      `Kasus berstatus "${STATUS_LABEL[from] || from}" tidak bisa langsung menjadi "${STATUS_LABEL[to] || to}"`
    );
  }
}

export const complaintCaseInclude = {
  order: { select: { id: true, orderNumber: true, status: true, customer: { select: { id: true, name: true, phone: true } } } },
  unit: { select: { id: true, unitCode: true, merk: true, ukuran: true, status: true } },
  createdBy: { select: { id: true, name: true } },
  customerConfirmedBy: { select: { id: true, name: true } },
  qcFitTest: { select: { id: true, verdict: true, createdAt: true } },
  jobs: {
    select: { id: true, type: true, status: true, scheduledDate: true, driverId: true, completedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  },
  unitRevisions: {
    select: { id: true, trigger: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  },
  materialIssues: {
    select: { id: true, issueNumber: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  },
};

// POST /complaints — dibuka Sales dari Order Detail. TIDAK bergantung pada
// Order.status/Unit.status sama sekali (itu inti perbaikan D-116) — komplain
// bisa dicatat kapan pun keluhan masuk, walau order masih diproduksi.
export async function createComplaintCase({
  orderId, unitId, category, severity, warrantyStatus, description, targetCompletionAt, attachmentUrls,
}, userId) {
  if (!orderId) throw new ComplaintError("Order wajib dipilih");
  if (!COMPLAINT_CATEGORIES.includes(category)) throw new ComplaintError("Kategori komplain tidak valid");
  if (severity && !COMPLAINT_SEVERITIES.includes(severity)) throw new ComplaintError("Severity tidak valid");
  if (warrantyStatus && !COMPLAINT_WARRANTY_STATUSES.includes(warrantyStatus)) throw new ComplaintError("Status garansi tidak valid");
  if (!description?.trim()) throw new ComplaintError("Keluhan customer wajib diisi");

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) throw new ComplaintError("Order tidak ditemukan", 404);

  if (unitId) {
    const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, orderId: true } });
    if (!unit) throw new ComplaintError("Unit tidak ditemukan", 404);
    if (unit.orderId !== orderId) throw new ComplaintError("Unit yang dipilih bukan bagian dari order ini");
  }

  let parsedTarget = null;
  if (targetCompletionAt) {
    parsedTarget = new Date(targetCompletionAt);
    if (Number.isNaN(parsedTarget.getTime())) throw new ComplaintError("Target penyelesaian tidak valid");
  }

  const caseNumber = await generateComplaintCaseNumber();
  const trimmedDescription = description.trim();

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.complaintCase.create({
      data: {
        caseNumber, orderId, unitId: unitId || null,
        category, severity: severity || "SEDANG", warrantyStatus: warrantyStatus || "BELUM_DITENTUKAN",
        description: trimmedDescription,
        attachmentUrls: Array.isArray(attachmentUrls) ? attachmentUrls.filter((u) => typeof u === "string") : [],
        targetCompletionAt: parsedTarget,
        createdById: userId,
      },
    });

    // Sinkron ke Order.hasComplaint (parity D-109) — badge "Ada Komplain" yang
    // SUDAH ADA di ArmadaOrders.jsx/ProductionOrders.jsx/OrderSection.jsx ikut
    // menyala untuk kasus yang dibuka lewat ComplaintCase juga, TANPA perlu
    // menyentuh kode badge itu sama sekali (satu sumber kebenaran turunan).
    await tx.order.update({
      where: { id: orderId },
      data: {
        hasComplaint: true,
        complaintDate: new Date(),
        complaintDetail: trimmedDescription,
        complaintResolvedAt: null,
        complaintResolvedById: null,
      },
    });

    await recordActivity(tx, {
      entityType: ENTITY_TYPES.COMPLAINT, entityId: c.id, eventType: EVENT_TYPES.COMPLAINT_CREATED,
      actorId: userId, metadata: { category, categoryLabel: CATEGORY_LABEL[category], severity: severity || "SEDANG" },
    });

    return c;
  });

  const full = await prisma.complaintCase.findUnique({ where: { id: created.id }, include: complaintCaseInclude });
  beritahuBestEffort(notifyComplaintCaseHighSeverity, full);
  return full;
}

// PATCH field non-status (kategori/severity/warranty/root cause/resolution/
// biaya/target/attachment) — TIDAK bisa mengubah status/currentOwner di sini,
// itu wajib lewat transitionStatus (lihat validasi transisi di bawah).
export async function updateComplaintFields(caseId, fields, userId) {
  const existing = await prisma.complaintCase.findUnique({ where: { id: caseId } });
  if (!existing) throw new ComplaintError("Kasus tidak ditemukan", 404);

  const data = {};
  if (fields.category !== undefined) {
    if (!COMPLAINT_CATEGORIES.includes(fields.category)) throw new ComplaintError("Kategori komplain tidak valid");
    data.category = fields.category;
  }
  if (fields.severity !== undefined) {
    if (!COMPLAINT_SEVERITIES.includes(fields.severity)) throw new ComplaintError("Severity tidak valid");
    data.severity = fields.severity;
  }
  if (fields.warrantyStatus !== undefined) {
    if (!COMPLAINT_WARRANTY_STATUSES.includes(fields.warrantyStatus)) throw new ComplaintError("Status garansi tidak valid");
    data.warrantyStatus = fields.warrantyStatus;
  }
  if (fields.rootCause !== undefined) data.rootCause = fields.rootCause?.trim() || null;
  if (fields.resolution !== undefined) data.resolution = fields.resolution?.trim() || null;
  if (fields.resolutionCost !== undefined) {
    const cost = fields.resolutionCost === null ? null : Number(fields.resolutionCost);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new ComplaintError("Biaya penyelesaian tidak valid");
    data.resolutionCost = cost;
  }
  if (fields.targetCompletionAt !== undefined) {
    if (fields.targetCompletionAt === null) {
      data.targetCompletionAt = null;
    } else {
      const parsed = new Date(fields.targetCompletionAt);
      if (Number.isNaN(parsed.getTime())) throw new ComplaintError("Target penyelesaian tidak valid");
      data.targetCompletionAt = parsed;
    }
  }
  if (fields.attachmentUrls !== undefined) {
    if (!Array.isArray(fields.attachmentUrls)) throw new ComplaintError("Attachment tidak valid");
    data.attachmentUrls = fields.attachmentUrls.filter((u) => typeof u === "string");
  }

  if (Object.keys(data).length === 0) throw new ComplaintError("Tidak ada field yang diubah");

  await prisma.$transaction(async (tx) => {
    await tx.complaintCase.update({ where: { id: caseId }, data });
    if (fields.rootCause !== undefined && !existing.rootCause && data.rootCause) {
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.COMPLAINT, entityId: caseId, eventType: EVENT_TYPES.COMPLAINT_STATUS_CHANGED,
        actorId: userId, metadata: { from: existing.status, to: existing.status, note: `Root cause dicatat: ${data.rootCause}` },
      });
    }
    if (fields.resolution !== undefined && !existing.resolution && data.resolution) {
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.COMPLAINT, entityId: caseId, eventType: EVENT_TYPES.COMPLAINT_STATUS_CHANGED,
        actorId: userId, metadata: { from: existing.status, to: existing.status, note: `Resolusi dicatat: ${data.resolution}` },
      });
    }
  });

  return prisma.complaintCase.findUnique({ where: { id: caseId }, include: complaintCaseInclude });
}

// Transisi status manual — SELESAI TIDAK BISA dicapai lewat sini (lihat
// catatan ALLOWED_TRANSITIONS), harus lewat confirmCustomer.
export async function transitionStatus(caseId, { status, currentOwner, note }, userId) {
  if (status === "SELESAI") {
    throw new ComplaintError("Gunakan endpoint konfirmasi customer untuk menyelesaikan kasus, bukan transisi status langsung");
  }
  const existing = await prisma.complaintCase.findUnique({ where: { id: caseId } });
  if (!existing) throw new ComplaintError("Kasus tidak ditemukan", 404);
  if (currentOwner !== undefined && currentOwner !== null && !COMPLAINT_OWNERS.includes(currentOwner)) {
    throw new ComplaintError("Divisi pemegang kasus tidak valid");
  }

  assertValidTransition(existing.status, status);
  if (status === "DIBATALKAN" && !note?.trim() && !existing.cancelReason) {
    throw new ComplaintError("Alasan pembatalan wajib diisi");
  }

  const data = {
    status,
    currentOwner: currentOwner || DEFAULT_OWNER_BY_STATUS[status] || existing.currentOwner,
  };
  if (status === "DIBATALKAN") data.cancelReason = note?.trim() || existing.cancelReason;

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.complaintCase.update({ where: { id: caseId }, data });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.COMPLAINT, entityId: caseId,
      eventType: status === "DIBATALKAN" ? EVENT_TYPES.COMPLAINT_CANCELLED : EVENT_TYPES.COMPLAINT_STATUS_CHANGED,
      actorId: userId,
      metadata: {
        from: existing.status, to: status,
        fromLabel: STATUS_LABEL[existing.status], toLabel: STATUS_LABEL[status],
        note: note?.trim() || undefined, reason: status === "DIBATALKAN" ? (note?.trim() || existing.cancelReason) : undefined,
      },
    });
    return c;
  });

  const full = await prisma.complaintCase.findUnique({ where: { id: updated.id }, include: complaintCaseInclude });
  if (data.currentOwner !== existing.currentOwner) {
    beritahuBestEffort(notifyComplaintCaseOwnerChanged, full);
  }
  return full;
}

// POST /complaints/:id/delivery-task — Delivery Task (Job) LAHIR LANGSUNG
// UNSCHEDULED, TIDAK mensyaratkan Order.status/Unit.status apa pun (pola
// sama dengan POST /armada/revisions/:id/create-pickup-job, D-108) — inilah
// yang membuat kasus Sony/Aida bisa langsung masuk radar Delivery walau
// order masih diproduksi.
export async function createDeliveryTask(caseId, { jobType, accessNotes }, userId) {
  const kase = await prisma.complaintCase.findUnique({ where: { id: caseId } });
  if (!kase) throw new ComplaintError("Kasus tidak ditemukan", 404);

  const type = jobType === "DELIVERY" ? "DELIVERY" : "PICKUP";
  const nextStatus = type === "DELIVERY" ? "DIKIRIM_ULANG" : "DIJADWALKAN";
  assertValidTransition(kase.status, nextStatus);

  const defaultNote = type === "DELIVERY"
    ? `Pengiriman ulang setelah komplain ${kase.caseNumber} — ${kase.description}`
    : `Pengambilan/inspeksi untuk komplain ${kase.caseNumber} — ${kase.description}`;

  await prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        type, orderId: kase.orderId, complaintCaseId: kase.id,
        accessNotes: accessNotes?.trim() || defaultNote,
      },
    });
    if (kase.unitId) {
      await tx.jobUnit.create({ data: { jobId: job.id, unitId: kase.unitId } });
    }
    await tx.complaintCase.update({
      where: { id: kase.id },
      data: { status: nextStatus, currentOwner: "DELIVERY" },
    });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.COMPLAINT, entityId: kase.id, eventType: EVENT_TYPES.COMPLAINT_DELIVERY_TASK_CREATED,
      actorId: userId, metadata: { jobType: type, jobId: job.id },
    });
  });

  const full = await prisma.complaintCase.findUnique({ where: { id: caseId }, include: complaintCaseInclude });
  beritahuBestEffort(notifyComplaintCaseOwnerChanged, full);
  return full;
}

// POST /complaints/:id/link-qc — menautkan hasil QcFitTest yang memverifikasi
// rework kasus ini. Dipanggil route yang dijaga QC_WRITE, BUKAN COMPLAINT_WRITE.
export async function linkQcFitTest(caseId, qcFitTestId, userId) {
  if (!qcFitTestId) throw new ComplaintError("Hasil QC wajib dipilih");
  const kase = await prisma.complaintCase.findUnique({ where: { id: caseId } });
  if (!kase) throw new ComplaintError("Kasus tidak ditemukan", 404);
  const qc = await prisma.qcFitTest.findUnique({ where: { id: qcFitTestId }, select: { id: true, verdict: true, unitId: true } });
  if (!qc) throw new ComplaintError("Hasil QC tidak ditemukan", 404);
  if (kase.unitId && qc.unitId !== kase.unitId) {
    throw new ComplaintError("Hasil QC ini bukan untuk unit yang sama dengan kasus komplain");
  }

  await prisma.$transaction(async (tx) => {
    await tx.complaintCase.update({ where: { id: caseId }, data: { qcFitTestId } });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.COMPLAINT, entityId: caseId, eventType: EVENT_TYPES.COMPLAINT_QC_LINKED,
      actorId: userId, metadata: { verdict: qc.verdict, qcFitTestId },
    });
  });

  return prisma.complaintCase.findUnique({ where: { id: caseId }, include: complaintCaseInclude });
}

// POST /complaints/:id/follow-up — percobaan follow-up ke customer, DICATAT
// BERKALI-KALI lewat ActivityEvent (bukan kolom tunggal) — lihat catatan di
// schema.prisma soal kenapa customerConfirmedAt tetap kolom terpisah.
export async function logFollowUp(caseId, note, userId) {
  if (!note?.trim()) throw new ComplaintError("Catatan follow-up wajib diisi");
  const kase = await prisma.complaintCase.findUnique({ where: { id: caseId }, select: { id: true } });
  if (!kase) throw new ComplaintError("Kasus tidak ditemukan", 404);

  await prisma.$transaction(async (tx) => {
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.COMPLAINT, entityId: caseId, eventType: EVENT_TYPES.COMPLAINT_FOLLOW_UP_LOGGED,
      actorId: userId, metadata: { note: note.trim() },
    });
  });

  return prisma.complaintCase.findUnique({ where: { id: caseId }, include: complaintCaseInclude });
}

// POST /complaints/:id/confirm-customer — SATU-SATUNYA jalan mencapai
// SELESAI, sesuai instruksi "case hanya selesai setelah customer confirmed
// resolved". Auto-resolve Order.hasComplaint, pola PERSIS sama dengan
// PATCH /armada/revisions/:id saat UnitRevision mencapai CONFIRMED (D-109).
export async function confirmCustomer(caseId, userId) {
  const kase = await prisma.complaintCase.findUnique({ where: { id: caseId } });
  if (!kase) throw new ComplaintError("Kasus tidak ditemukan", 404);
  if (kase.status !== "KONFIRMASI_CUSTOMER") {
    throw new ComplaintError(
      `Kasus berstatus "${STATUS_LABEL[kase.status] || kase.status}" — konfirmasi customer cuma relevan setelah barang dikirim ulang & customer dihubungi`
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.complaintCase.update({
      where: { id: caseId },
      data: { status: "SELESAI", currentOwner: "SALES", customerConfirmedAt: new Date(), customerConfirmedById: userId },
    });
    const order = await tx.order.findUnique({ where: { id: kase.orderId }, select: { hasComplaint: true, complaintResolvedAt: true } });
    if (order?.hasComplaint && !order.complaintResolvedAt) {
      await tx.order.update({
        where: { id: kase.orderId },
        data: { complaintResolvedAt: new Date(), complaintResolvedById: userId },
      });
    }
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.COMPLAINT, entityId: caseId, eventType: EVENT_TYPES.COMPLAINT_CUSTOMER_CONFIRMED,
      actorId: userId, metadata: {},
    });
    return c;
  });

  return prisma.complaintCase.findUnique({ where: { id: updated.id }, include: complaintCaseInclude });
}
