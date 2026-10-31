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
import { executeDeliveryCrossBoundaryCommand } from "./deliveryCrossBoundaryCommandService.js";
import { cancelOrderDeliveryJobs } from "./deliveryJobCancellationService.js";
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

// ─── GERBANG REDELIVERY (31 Oktober 2026, insiden Sony RES-27082026-183) ──
//
// Kronologi nyata: ADMIN mendorong kasus DIJADWALKAN→DALAM_PENANGANAN→QC→
// SIAP_DIKIRIM (8 detik), bikin Job DELIVERY baru (langsung ASSIGNED ke
// driver), lalu 27 MENIT KEMUDIAN mendorong DIKIRIM_ULANG→KONFIRMASI_
// CUSTOMER→SELESAI lewat POST /:id/status manual — TANPA job DELIVERY itu
// pernah tersentuh driver sama sekali (0 DeliveryExecutionEvent, 0 foto,
// tetap ASSIGNED). Kasus bilang "selesai", job pengiriman ulangnya nyangkut
// selamanya di tab Aktif driver. Auto-advance dari POST /jobs/:id/complete
// (routes/armada.js) TIDAK kena masalah ini — itu TRIGGER-nya job yang
// benar-benar COMPLETED, otomatis sudah memenuhi gerbang ini. Yang bolong
// adalah jalur MANUAL (transitionStatus) yang bisa melompat lebih cepat
// dari pekerjaan fisiknya.
//
// Job TUNTAS hanya kalau type DELIVERY, status COMPLETED, DAN punya bukti
// (proofPhotoUrls terisi — POST /jobs/:id/complete SELALU mewajibkan ini,
// lihat validatePodInput di services/deliveryExecution.js, jadi kriteria
// ini sama persis dengan yang sudah ditegakkan di titik penyelesaian job).
// ASSIGNED/EN_ROUTE/ARRIVED/FAILED/RESCHEDULED semuanya BELUM memenuhi —
// FAILED secara khusus TETAP diblokir (gagal kirim bukan "selesai"), job
// lama (complaintCaseId beda/null) TIDAK ikut dihitung sama sekali (relasi
// langsung ke Job.complaintCaseId, BUKAN Order.status atau job pengiriman
// original), dan status Route (termasuk COMPLETED) TIDAK relevan — sumber
// kebenaran "sudah sampai" adalah Job itu sendiri, bukan rute pembawanya.
export function isRedeliveryJobSettled(job) {
  return job.status === "COMPLETED" && Array.isArray(job.proofPhotoUrls) && job.proofPhotoUrls.length > 0;
}

export async function getOutstandingRedeliveryJobs(client, caseId) {
  const jobs = await client.job.findMany({
    where: { complaintCaseId: caseId, type: "DELIVERY" },
    select: { id: true, status: true, proofPhotoUrls: true, routeId: true },
  });
  return jobs.filter((j) => !isRedeliveryJobSettled(j));
}

// Dipanggil di DUA titik (transitionStatus DAN confirmCustomer, lihat
// instruksi "validasi backend pada transisi dan confirmCustomer, bukan
// warning UI saja") — bukan sekali di titik paling awal, supaya tidak ada
// jalur yang bisa memanggil salah satu tanpa lewat yang lain.
//
// HARDENING (review 31 Oktober 2026, poin 2): versi PERTAMA gerbang ini
// menganggap "0 job DELIVERY sama sekali" = "kasus ini memang tidak butuh
// redelivery" — lubang itu sendiri. SATU-SATUNYA jalan masuk KONFIRMASI_
// CUSTOMER yang TIDAK lewat DIKIRIM_ULANG (dan karenanya tidak lewat
// createDeliveryTask, yang SELALU membuat Job) adalah MENUNGGU_CUSTOMER ->
// KONFIRMASI_CUSTOMER (lihat ALLOWED_TRANSITIONS) — admin bisa mendorong
// kasus yang SEBENARNYA butuh kirim ulang fisik lewat jalur itu TANPA
// pernah membuat Job, dan gerbang versi pertama meloloskannya begitu saja.
// Karena sistem TIDAK punya sinyal independen "apakah kasus ini butuh
// redelivery" selain tindakan membuat Job itu sendiri, "0 job pernah
// dibuat" SEKARANG dianggap belum selesai juga — satu-satunya jalan
// melewatinya adalah WAJIB membuat+menuntaskan Job, atau menandai eksplisit
// lewat waiveRedelivery() (yang MEMAKSA keputusan "memang tidak perlu
// redelivery" jadi tercatat, bukan default diam-diam).
export async function assertRedeliveryCompleted(client, kase) {
  if (kase.redeliveryWaivedAt) return; // keputusan eksplisit admin, lihat waiveRedelivery()
  const outstanding = await getOutstandingRedeliveryJobs(client, kase.id);
  if (outstanding.length > 0) {
    const statuses = outstanding.map((j) => STATUS_LABEL_JOB[j.status] || j.status).join(", ");
    throw new ComplaintError(
      `Kasus ini punya ${outstanding.length} job pengiriman ulang yang belum tuntas (status: ${statuses}) — lengkapi dulu lewat app driver (selesai + bukti foto), atau gunakan "Selesaikan tanpa pengiriman ulang" dengan alasan kalau redelivery memang tidak akan dilanjutkan.`,
      409
    );
  }
  const everHadJob = await client.job.count({ where: { complaintCaseId: kase.id, type: "DELIVERY" } });
  if (everHadJob === 0) {
    throw new ComplaintError(
      `Kasus ini belum pernah punya job pengiriman ulang sama sekali — buat Delivery Task dulu kalau memang perlu kirim ulang fisik, atau gunakan "Selesaikan tanpa pengiriman ulang" dengan alasan kalau memang tidak perlu.`,
      409
    );
  }
}

const STATUS_LABEL_JOB = {
  UNSCHEDULED: "Belum Dijadwalkan", SCHEDULED: "Dijadwalkan", ASSIGNED: "Ditugaskan",
  EN_ROUTE: "Dalam Perjalanan", ARRIVED: "Tiba", COMPLETED: "Selesai (tanpa bukti)", FAILED: "Gagal", RESCHEDULED: "Dijadwalkan Ulang",
};

export const complaintCaseInclude = {
  order: { select: { id: true, orderNumber: true, status: true, customer: { select: { id: true, name: true, phone: true } } } },
  unit: { select: { id: true, unitCode: true, merk: true, ukuran: true, status: true } },
  createdBy: { select: { id: true, name: true } },
  customerConfirmedBy: { select: { id: true, name: true } },
  qcFitTest: { select: { id: true, verdict: true, createdAt: true } },
  jobs: {
    select: {
      id: true, type: true, status: true, scheduledDate: true, driverId: true, completedAt: true, createdAt: true,
      proofPhotoUrls: true, routeId: true,
    },
    orderBy: { createdAt: "desc" },
  },
  redeliveryWaivedBy: { select: { id: true, name: true } },
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
  // HARDENING (review 31 Oktober 2026, poin 2) — DIKIRIM_ULANG SENGAJA tidak
  // boleh ditulis manual, pola SAMA dengan SELESAI di atas. ALLOWED_TRANSITIONS
  // masih mencantumkan SIAP_DIKIRIM -> DIKIRIM_ULANG supaya UI tahu itu
  // tujuan yang VALID secara konsep, tapi satu-satunya cara MENULISNYA tetap
  // createDeliveryTask (satu transaksi dengan pembuatan Job DELIVERY) —
  // tanpa ini, status bisa didorong ke DIKIRIM_ULANG lewat sini tanpa Job
  // apa pun pernah lahir, dan assertRedeliveryCompleted jadi bergantung
  // sepenuhnya pada disiplin caller, bukan pada struktur yang memaksa.
  if (status === "DIKIRIM_ULANG") {
    throw new ComplaintError("Gunakan endpoint buat Delivery Task untuk masuk status ini — status ini wajib disertai Job DELIVERY, tidak bisa ditulis lewat transisi manual");
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
  // Gerbang redelivery — SATU-SATUNYA pintu manual menuju KONFIRMASI_CUSTOMER
  // (selain auto-advance dari job completion, yang sudah otomatis memenuhi
  // gerbang ini karena dipicu OLEH job yang baru saja COMPLETED). Lihat
  // catatan panjang di assertRedeliveryCompleted di atas.
  if (status === "KONFIRMASI_CUSTOMER") {
    await assertRedeliveryCompleted(prisma, existing);
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

  await prisma.$transaction((tx) => executeDeliveryCrossBoundaryCommand(tx, {
    actorId: userId,
    commandType: "COMPLAINT_DELIVERY_TASK_CREATE",
    aggregateHint: kase.id,
    request: { caseId: kase.id, type },
    mutate: async (commandTx) => {
      const job = await commandTx.job.create({
        data: {
          type, orderId: kase.orderId, complaintCaseId: kase.id,
          accessNotes: accessNotes?.trim() || defaultNote,
        },
      });
      if (kase.unitId) {
        await commandTx.jobUnit.create({ data: { jobId: job.id, unitId: kase.unitId } });
      }
      await commandTx.complaintCase.update({
        where: { id: kase.id },
        data: { status: nextStatus, currentOwner: "DELIVERY" },
      });
      await recordActivity(commandTx, {
        entityType: ENTITY_TYPES.COMPLAINT, entityId: kase.id, eventType: EVENT_TYPES.COMPLAINT_DELIVERY_TASK_CREATED,
        actorId: userId, metadata: { jobType: type, jobId: job.id },
      });
      return { value: job.id, jobIds: [job.id] };
    },
  }));

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
  // Pertahanan kedua (defense in depth) — transitionStatus SUDAH menolak
  // masuk ke KONFIRMASI_CUSTOMER tanpa redelivery tuntas, tapi SELESAI
  // adalah titik tulis TERAKHIR dan PALING MAHAL untuk salah (itu yang
  // dibaca "status order/komplain" di semua tempat lain) — diperiksa lagi
  // di sini supaya tidak bergantung pada SATU gerbang saja kalau nanti ada
  // jalur lain yang menulis status KONFIRMASI_CUSTOMER tanpa lewat
  // transitionStatus.
  await assertRedeliveryCompleted(prisma, kase);

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

// Status dari mana waiveRedelivery relevan. DIKIRIM_ULANG/KONFIRMASI_CUSTOMER
// = redelivery sudah berjalan tapi dibatalkan rencananya. MENUNGGU_CUSTOMER
// ditambahkan (hardening 31 Oktober 2026, poin 2) — SATU-SATUNYA status lain
// yang punya transisi langsung ke KONFIRMASI_CUSTOMER (lihat ALLOWED_
// TRANSITIONS) TANPA lewat DIKIRIM_ULANG; sejak assertRedeliveryCompleted
// sekarang menolak "0 job pernah dibuat", kasus yang MEMANG tidak perlu
// redelivery (mis. diselesaikan lewat penjelasan/refund tanpa kirim ulang
// fisik) butuh jalan keluar eksplisit yang bisa dipanggil SEBELUM mencoba
// masuk KONFIRMASI_CUSTOMER, bukan cuma sesudah ditolak.
const WAIVE_ALLOWED_STATUSES = ["DIKIRIM_ULANG", "MENUNGGU_CUSTOMER", "KONFIRMASI_CUSTOMER"];
// Job yang BELUM berjalan sama sekali — aman dibatalkan lewat mekanisme
// pembatalan yang SUDAH ADA (cancelOrderDeliveryJobs/DeliveryJobCancellation,
// dipakai juga oleh pembatalan order PKR/Penjualan Karyawan). Job EN_ROUTE/
// ARRIVED SENGAJA TIDAK masuk sini — driver sudah di jalan, waiver harus
// MENUNGGU hasilnya (selesai/gagal), tidak menariknya paksa dari lapangan.
const JOB_NOT_STARTED_STATUSES = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED"];
const JOB_IN_PROGRESS_STATUSES = ["EN_ROUTE", "ARRIVED"];

// POST /complaints/:id/waive-redelivery — jalur resolusi EKSPLISIT untuk
// kasus yang penyelesaiannya SENGAJA TIDAK lewat pengiriman ulang fisik
// (refund, kompensasi lain, ATAU memang tidak pernah butuh kirim ulang sama
// sekali) atau redelivery yang sudah diputuskan batal dilanjutkan (job gagal
// berkali-kali, customer akhirnya pilih opsi lain, dst). SATU-SATUNYA cara
// melewati assertRedeliveryCompleted — alasan WAJIB, siapa & kapan tercatat
// di kolom (redeliveryWaivedAt/By/Reason) DAN ActivityEvent, pola sama
// dengan DIBATALKAN (cancelReason wajib). TIDAK mengubah status kasus itu
// sendiri — hanya membuka gerbang; kasus tetap harus lewat transitionStatus
// ke KONFIRMASI_CUSTOMER lalu confirmCustomer seperti biasa (customer tetap
// wajib dikonfirmasi, cuma syarat "job redelivery tuntas"-nya yang dilepas).
//
// HARDENING (review 31 Oktober 2026, poin 1) — versi PERTAMA cuma menulis
// kolom waiver, job redelivery yang masih ASSIGNED/SCHEDULED/UNSCHEDULED
// dibiarkan nyangkut selamanya (persis masalah yang sedang diperbaiki, cuma
// dipindah dari "gerbang kasus" ke "job yatim") — SEKARANG job yang BELUM
// berjalan ikut DIBATALKAN secara eksplisit+audited (bukan dihapus/ditandai
// COMPLETED palsu) sebagai bagian dari transaksi yang sama. Job yang SEDANG
// berjalan (EN_ROUTE/ARRIVED), tercatat COMPLETED tapi tanpa bukti foto (POD
// belum sinkron), atau punya antrean RescheduleCase AKTIF — SEMUA menolak
// waiver (409) sampai direkonsiliasi manual; TIDAK PERNAH ditandai selesai
// otomatis atau diberi POD palsu di jalur ini.
//
// Job redelivery yang dibatalkan di sini TERTAUT KE KOMPLAIN INI SENDIRI
// (complaintCaseId FK) — bukan job divisi lain yang "dipinjam" permission-nya;
// ORDER_WRITE (pemilik keputusan resolusi kasus) dianggap cukup berwenang
// atas job yang lahir SEBAGAI AKIBAT keputusan kasus yang sama, pola yang
// SAMA dengan confirmCustomer (ORDER_WRITE) menulis Order.complaintResolvedAt
// tanpa perlu permission domain Order terpisah.
export async function waiveRedelivery(caseId, reason, userId) {
  if (!reason?.trim()) throw new ComplaintError("Alasan wajib diisi untuk menyelesaikan kasus tanpa pengiriman ulang");
  const kase = await prisma.complaintCase.findUnique({ where: { id: caseId } });
  if (!kase) throw new ComplaintError("Kasus tidak ditemukan", 404);
  if (!WAIVE_ALLOWED_STATUSES.includes(kase.status)) {
    throw new ComplaintError(
      `Kasus berstatus "${STATUS_LABEL[kase.status] || kase.status}" — opsi ini cuma relevan setelah kasus sampai tahap menunggu customer atau mengirim ulang`
    );
  }
  if (kase.redeliveryWaivedAt) throw new ComplaintError("Kasus ini sudah ditandai tidak butuh pengiriman ulang sebelumnya");

  const jobs = await prisma.job.findMany({
    where: { complaintCaseId: caseId, type: "DELIVERY" },
    select: { id: true, status: true, proofPhotoUrls: true },
  });

  const inProgress = jobs.filter((j) => JOB_IN_PROGRESS_STATUSES.includes(j.status));
  if (inProgress.length > 0) {
    throw new ComplaintError(
      `Job pengiriman ulang sedang dalam perjalanan (${inProgress.map((j) => STATUS_LABEL_JOB[j.status] || j.status).join(", ")}) — tunggu sampai tuntas atau gagal, baru bisa menyelesaikan tanpa pengiriman ulang`,
      409
    );
  }
  const unsyncedPod = jobs.filter((j) => j.status === "COMPLETED" && !(j.proofPhotoUrls?.length));
  if (unsyncedPod.length > 0) {
    throw new ComplaintError(
      "Job pengiriman ulang tercatat Selesai tapi tanpa bukti foto (POD belum sinkron) — rekonsiliasi dulu secara manual, jangan ditutup lewat waiver",
      409
    );
  }
  if (jobs.length > 0) {
    const activeRescheduleCount = await prisma.rescheduleCase.count({
      where: { jobId: { in: jobs.map((j) => j.id) }, status: "AKTIF" },
    });
    if (activeRescheduleCount > 0) {
      throw new ComplaintError(
        "Ada antrean penjadwalan ulang (reschedule) yang masih aktif untuk job pengiriman ulang ini — selesaikan dulu lewat alur reschedule sebelum menyelesaikan kasus tanpa pengiriman ulang",
        409
      );
    }
  }
  const notStarted = jobs.filter((j) => JOB_NOT_STARTED_STATUSES.includes(j.status));

  const trimmed = reason.trim();
  const full = await prisma.$transaction(async (tx) => {
    // updateMany + where redeliveryWaivedAt:null, bukan update biasa — penjaga
    // atomik terhadap race double-submit (dua request lolos pre-check "belum
    // diwaive" bersamaan): yang kalah dapat count=0, dihentikan SEBELUM ikut
    // membatalkan job/menulis activity kedua kalinya.
    const result = await tx.complaintCase.updateMany({
      where: { id: caseId, redeliveryWaivedAt: null },
      data: { redeliveryWaivedAt: new Date(), redeliveryWaivedById: userId, redeliveryWaivedReason: trimmed },
    });
    if (result.count === 0) {
      throw new ComplaintError("Kasus ini sudah ditandai tidak butuh pengiriman ulang sebelumnya", 409);
    }
    if (notStarted.length > 0) {
      await cancelOrderDeliveryJobs(tx, {
        orderId: kase.orderId,
        reason: `Komplain diselesaikan tanpa pengiriman ulang: ${trimmed}`,
        actorId: userId,
        jobIds: notStarted.map((j) => j.id),
      });
    }
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.COMPLAINT, entityId: caseId, eventType: EVENT_TYPES.COMPLAINT_REDELIVERY_WAIVED,
      actorId: userId, metadata: { reason: trimmed, cancelledJobIds: notStarted.map((j) => j.id) },
    });
    return tx.complaintCase.findUnique({ where: { id: caseId }, include: complaintCaseInclude });
  });

  return full;
}
