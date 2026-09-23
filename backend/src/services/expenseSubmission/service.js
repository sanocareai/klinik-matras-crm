// PENGAJUAN BIAYA LINTAS DIVISI — service bersama. SATU-SATUNYA tempat yang boleh
// membuat/mengubah baris ExpenseSubmission dan menautkannya ke FinExpense. Lihat banner
// prinsip di schema.prisma#ExpenseSubmission sebelum mengubah file ini.

import { randomUUID } from "node:crypto";
import { buatFinExpense, tarikFinExpense as tarikFinExpenseAsli, expenseInclude as finExpenseInclude, bentukExpense } from "../finance/expenses.js";
import { generateDocumentNumber, todayBookDateWIB, toBookDate } from "../finance/journal.js";
import { toMoney, moneyToNumber } from "../finance/money.js";
import { hasPermission } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { getWorkspaceConfig } from "./config.js";

export class SubmissionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "SubmissionError";
    this.statusCode = statusCode;
  }
}

const FIN_TO_SUBMISSION_STATUS = {
  DRAFT: "MENUNGGU_PERSETUJUAN", // FinExpense DRAFT hanya sesaat (langsungAjukan selalu true dari jalur ini) — dipetakan aman kalau suatu saat berubah
  MENUNGGU_APPROVAL: "MENUNGGU_PERSETUJUAN",
  DISETUJUI: "DISETUJUI",
  DITOLAK: "DITOLAK",
  DIBAYAR: "DIBAYAR",
  DIBATALKAN: "DIBATALKAN",
};

export const submissionInclude = {
  requestedBy: { select: { id: true, name: true } },
  picUser: { select: { id: true, name: true } },
  driver: { select: { id: true, name: true } },
  helper: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNumber: true, type: true } },
  route: { select: { id: true, date: true } },
  job: { select: { id: true, type: true, status: true } },
  order: { select: { id: true, orderNumber: true } },
  vehicleExpense: { select: { id: true, odometerKm: true, liters: true, category: true } },
  finExpense: { select: { id: true, expenseNumber: true, status: true, amount: true, cashAccountId: true, approvedAt: true, paidAt: true, rejectReason: true } },
  createdBy: { select: { id: true, name: true } },
  proofs: { where: { supersededAt: null }, orderBy: { createdAt: "desc" } },
  auditTrail: { orderBy: { createdAt: "desc" }, take: 50 },
};

function bentukSubmission(s) {
  const finStatus = s.finExpense?.status;
  return {
    ...s,
    amount: moneyToNumber(s.amount),
    finExpense: s.finExpense ? { ...s.finExpense, amount: moneyToNumber(s.finExpense.amount) } : null,
    // Status EFEKTIF: begitu FinExpense ada, statusnya SELALU mengikuti FinExpense (satu
    // sumber kebenaran) — kolom `status` tersimpan tetap di-refresh oleh sinkronStatus()
    // di titik transisi FinExpense, tapi field ini adalah jaminan tambahan di lapisan baca.
    status: finStatus ? (FIN_TO_SUBMISSION_STATUS[finStatus] || s.status) : s.status,
  };
}

function validasiTipe(workspace, expenseType) {
  const cfg = getWorkspaceConfig(workspace);
  if (!cfg) throw new SubmissionError(`Workspace "${workspace}" tidak dikenal`, 400);
  const valid = cfg.expenseTypes.some((t) => t.code === expenseType);
  if (!valid) throw new SubmissionError(`Jenis biaya "${expenseType}" tidak berlaku untuk ${cfg.label}`, 400);
  return cfg;
}

function susunKeterangan({ expenseType, cfg, vendorOrLocation, vehiclePlateSnapshot, routeNameSnapshot, metadata }) {
  const label = cfg.expenseTypes.find((t) => t.code === expenseType)?.label || expenseType;
  const bagian = [label];
  if (vehiclePlateSnapshot) bagian.push(`kendaraan ${vehiclePlateSnapshot}`);
  if (metadata?.vendorOrLocation || vendorOrLocation) bagian.push(`di ${metadata?.vendorOrLocation || vendorOrLocation}`);
  if (routeNameSnapshot) bagian.push(`— rute ${routeNameSnapshot}`);
  return bagian.join(" ");
}

/** Buat pengajuan baru berstatus DRAFT — bebas diedit selama masih di sini. */
export async function buatPengajuan(db, { workspace, user, body }) {
  const cfg = validasiTipe(workspace, body.expenseType);
  const nominal = body.amount != null ? toMoney(body.amount, { field: "Nominal pengajuan" }) : null;
  if (nominal && nominal.lessThanOrEqualTo(0)) throw new SubmissionError("Nominal harus lebih dari 0");

  let vehiclePlateSnapshot = null;
  if (body.vehicleId) {
    const v = await db.vehicle.findUnique({ where: { id: body.vehicleId }, select: { plateNumber: true, active: true } });
    if (!v) throw new SubmissionError("Kendaraan tidak ditemukan", 404);
    vehiclePlateSnapshot = v.plateNumber;
  }
  let driverNameSnapshot = null;
  if (body.driverId) {
    const d = await db.user.findUnique({ where: { id: body.driverId }, select: { name: true, active: true } });
    if (!d) throw new SubmissionError("Driver tidak ditemukan", 404);
    driverNameSnapshot = d.name;
  }
  let helperNameSnapshot = null;
  if (body.helperId) {
    const h = await db.user.findUnique({ where: { id: body.helperId }, select: { name: true } });
    if (!h) throw new SubmissionError("Helper tidak ditemukan", 404);
    helperNameSnapshot = h.name;
  }
  let routeNameSnapshot = null;
  if (body.routeId) {
    const r = await db.route.findUnique({ where: { id: body.routeId }, select: { date: true } });
    if (!r) throw new SubmissionError("Route tidak ditemukan", 404);
    routeNameSnapshot = r.date ? new Date(r.date).toISOString().slice(0, 10) : null;
  }

  const tanggal = body.date ? toBookDate(body.date) : todayBookDateWIB();
  const description = body.description?.trim() || susunKeterangan({
    expenseType: body.expenseType, cfg, vendorOrLocation: body.vendorName, vehiclePlateSnapshot, routeNameSnapshot, metadata: body.metadata,
  });

  const submissionNumber = await generateDocumentNumber(db, "PB", tanggal);

  const created = await db.expenseSubmission.create({
    data: {
      submissionNumber,
      division: cfg.division,
      costCenter: body.costCenter?.trim() || null,
      requestedById: user.id,
      picUserId: body.picUserId || null,
      picNameSnapshot: null,
      expenseType: body.expenseType,
      date: tanggal,
      amount: nominal ? nominal.toFixed(2) : "0.00",
      description,
      notes: body.notes?.trim() || null,
      jobId: body.jobId || null,
      routeId: body.routeId || null,
      vehicleId: body.vehicleId || null,
      driverId: body.driverId || null,
      helperId: body.helperId || null,
      orderId: body.orderId || null,
      vehicleExpenseId: body.vehicleExpenseId || null,
      vehiclePlateSnapshot, driverNameSnapshot, helperNameSnapshot, routeNameSnapshot,
      metadata: body.metadata || {},
      paymentMethod: body.paymentMethod?.trim() || null,
      vendorName: body.vendorName?.trim() || null,
      status: "DRAFT",
      createdById: user.id,
    },
    include: submissionInclude,
  });
  return bentukSubmission(created);
}

/** Edit pengajuan — HANYA sah selama DRAFT (seluruh field boleh diubah, tanpa jejak audit khusus karena belum "resmi"). */
export async function ubahPengajuanDraft(db, { id, user, body }) {
  const s = await db.expenseSubmission.findUnique({ where: { id } });
  if (!s) throw new SubmissionError("Pengajuan tidak ditemukan", 404);
  if (s.status !== "DRAFT") throw new SubmissionError(`Pengajuan berstatus ${s.status} — hanya draf yang bebas diedit penuh`, 409);
  if (s.requestedById !== user.id && s.createdById !== user.id && !hasPermission(user, P.FINANCE_ADMIN)) {
    throw new SubmissionError("Hanya pemohon sendiri (atau admin keuangan) yang boleh mengedit draf ini", 403);
  }
  const cfg = validasiTipe(s.division === "DELIVERY" ? "DELIVERY" : s.division, body.expenseType ?? s.expenseType);
  const nominal = body.amount != null ? toMoney(body.amount, { field: "Nominal pengajuan" }) : null;
  const data = {};
  if (body.expenseType !== undefined) data.expenseType = body.expenseType;
  if (body.date !== undefined) data.date = toBookDate(body.date);
  if (nominal) data.amount = nominal.toFixed(2);
  if (body.description !== undefined) data.description = body.description.trim();
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null;
  if (body.jobId !== undefined) data.jobId = body.jobId || null;
  if (body.routeId !== undefined) data.routeId = body.routeId || null;
  if (body.vehicleId !== undefined) data.vehicleId = body.vehicleId || null;
  if (body.driverId !== undefined) data.driverId = body.driverId || null;
  if (body.helperId !== undefined) data.helperId = body.helperId || null;
  if (body.picUserId !== undefined) data.picUserId = body.picUserId || null;
  if (body.metadata !== undefined) data.metadata = body.metadata || {};
  if (body.paymentMethod !== undefined) data.paymentMethod = body.paymentMethod?.trim() || null;
  if (body.vendorName !== undefined) data.vendorName = body.vendorName?.trim() || null;
  if (body.costCenter !== undefined) data.costCenter = body.costCenter?.trim() || null;
  void cfg;
  const updated = await db.expenseSubmission.update({ where: { id }, data, include: submissionInclude });
  return bentukSubmission(updated);
}

/**
 * AJUKAN — titik satu-satunya yang membuat/menautkan FinExpense. Idempoten: dipanggil
 * ulang dengan idempotencyKey yang sama (double-click/retry) mengembalikan pengajuan yang
 * SAMA, tidak pernah membuat FinExpense kedua. `db` harus `prisma` (fungsi ini membuka
 * transaksinya sendiri supaya lock+create+link atomik).
 */
export async function ajukanPengajuan(prismaClient, { id, user, idemKey }) {
  return prismaClient.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT id FROM "expense_submissions" WHERE id = $1::uuid FOR UPDATE', id);
    const s = await tx.expenseSubmission.findUnique({ where: { id } });
    if (!s) throw new SubmissionError("Pengajuan tidak ditemukan", 404);

    // Sudah pernah diajukan (retry/double-click) — kembalikan apa adanya, JANGAN buat FinExpense kedua.
    if (s.finExpenseId) {
      const existing = await tx.expenseSubmission.findUnique({ where: { id }, include: submissionInclude });
      return bentukSubmission(existing);
    }
    if (s.status !== "DRAFT") throw new SubmissionError(`Pengajuan berstatus ${s.status} — hanya draf yang bisa diajukan`, 409);
    if (s.requestedById !== user.id && s.createdById !== user.id && !hasPermission(user, P.FINANCE_ADMIN)) {
      throw new SubmissionError("Hanya pemohon sendiri (atau admin keuangan) yang boleh mengajukan", 403);
    }

    const cfg = getWorkspaceConfig(s.division === "DELIVERY" ? "DELIVERY" : s.division) || { division: s.division };

    // Kunci idempotensi domain — kalau baris sudah punya idempotencyKey lain (mustahil di
    // jalur normal, hanya bisa lewat retry dengan header berbeda pada baris yg sama),
    // tolak eksplisit daripada diam-diam menimpa.
    if (s.idempotencyKey && idemKey && s.idempotencyKey !== idemKey) {
      throw new SubmissionError("Pengajuan ini sudah diproses dengan kunci permintaan yang berbeda", 409);
    }

    const finExpense = await buatFinExpense(tx, {
      date: s.date, amount: s.amount, description: s.description, categoryId: await kategoriUntuk(tx, cfg.division, s.expenseType),
      division: cfg.division, mode: undefined, // biarkan buatFinExpense menentukan mode efektif dari capability user (REIMBURSEMENT kalau tanpa FINANCE_POST)
      cashAccountId: null, supplierId: null, reimburseToId: null, payeeName: s.vendorName, orderId: s.orderId, unitId: null,
      receiptUrl: null, notes: s.notes, langsungAjukan: true, user,
    });

    await tx.$executeRawUnsafe("SAVEPOINT sp_ajukan_pengajuan");
    let updated;
    try {
      updated = await tx.expenseSubmission.update({
        where: { id },
        data: { finExpenseId: finExpense.id, status: "MENUNGGU_PERSETUJUAN", submittedAt: new Date(), idempotencyKey: idemKey || null },
        include: submissionInclude,
      });
    } catch (e) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sp_ajukan_pengajuan");
      if (e.code === "P2002") {
        // Baris lain menang race (idempotencyKey unik) — baca ulang, JANGAN buat FinExpense kedua kali.
        const winner = await tx.expenseSubmission.findUnique({ where: { id }, include: submissionInclude });
        return bentukSubmission(winner);
      }
      throw e;
    }
    return bentukSubmission(updated);
  }, { timeout: 20_000, maxWait: 20_000 });
}

/** Cari kategori FinExpense yang cocok untuk workspace+jenis biaya — fallback ke kategori "LAINNYA" divisi itu kalau belum ada pemetaan spesifik. */
async function kategoriUntuk(tx, division, expenseType) {
  const kandidat = await tx.finExpenseCategory.findFirst({
    where: { division, active: true, OR: [{ code: `${division}_${expenseType}` }, { name: { contains: expenseType, mode: "insensitive" } }] },
  });
  if (kandidat) return kandidat.id;
  const umum = await tx.finExpenseCategory.findFirst({ where: { division, active: true }, orderBy: { name: "asc" } });
  if (!umum) throw new SubmissionError(`Belum ada kategori pengeluaran aktif untuk divisi ${division} — hubungi Finance untuk memasangnya`, 422);
  return umum.id;
}

/** Tarik kembali (MENUNGGU_PERSETUJUAN → DRAFT) — hanya sebelum diputuskan Finance. */
export async function tarikPengajuan(db, { id, user }) {
  const s = await db.expenseSubmission.findUnique({ where: { id }, include: { finExpense: { select: { id: true, status: true } } } });
  if (!s) throw new SubmissionError("Pengajuan tidak ditemukan", 404);
  if (s.status !== "MENUNGGU_PERSETUJUAN" || !s.finExpenseId) {
    throw new SubmissionError(`Pengajuan berstatus ${s.status} — hanya yang menunggu persetujuan yang bisa ditarik`, 409);
  }
  if (s.requestedById !== user.id && s.createdById !== user.id && !hasPermission(user, P.FINANCE_ADMIN)) {
    throw new SubmissionError("Hanya pemohon sendiri (atau admin keuangan) yang boleh menarik pengajuan ini", 403);
  }
  await tarikFinExpenseAsli(db, { id: s.finExpenseId, user });
  const updated = await db.expenseSubmission.update({
    where: { id }, data: { status: "DRAFT", finExpenseId: null, submittedAt: null, withdrawnAt: new Date(), idempotencyKey: null },
    include: submissionInclude,
  });
  return bentukSubmission(updated);
}

/** Batalkan — sebelum FinExpense ada (langsung), atau sesudahnya (delegasi ke /expenses/:id/cancel yang sudah ada, FINANCE_ADMIN). */
export async function batalkanPengajuan(db, { id, user, reason }) {
  const s = await db.expenseSubmission.findUnique({ where: { id } });
  if (!s) throw new SubmissionError("Pengajuan tidak ditemukan", 404);
  if (!s.finExpenseId) {
    if (!["DRAFT", "MENUNGGU_PERSETUJUAN"].includes(s.status)) throw new SubmissionError(`Pengajuan berstatus ${s.status} — tidak bisa dibatalkan`, 409);
    const updated = await db.expenseSubmission.update({ where: { id }, data: { status: "DIBATALKAN" }, include: submissionInclude });
    return bentukSubmission(updated);
  }
  throw new SubmissionError("Pengajuan ini sudah punya FinExpense — batalkan lewat aksi Batalkan pada dokumen Finance-nya (butuh FINANCE_ADMIN)", 409);
}

/** Koreksi metadata NON-finansial (keterangan/vendor/penautan) dengan jejak audit before/after. Dibekukan begitu DIBAYAR — koreksi lanjut lewat workflow koreksi FinExpense. */
export async function ubahMetadataPengajuan(db, { id, user, reason, changes }) {
  if (!reason?.trim()) throw new SubmissionError("Alasan perubahan wajib diisi");
  const s = await db.expenseSubmission.findUnique({ where: { id }, include: { finExpense: { select: { status: true } } } });
  if (!s) throw new SubmissionError("Pengajuan tidak ditemukan", 404);
  const statusEfektif = s.finExpense ? (FIN_TO_SUBMISSION_STATUS[s.finExpense.status] || s.status) : s.status;
  if (statusEfektif === "DIBAYAR" || statusEfektif === "DIBATALKAN" || statusEfektif === "DITOLAK") {
    throw new SubmissionError(`Pengajuan berstatus ${statusEfektif} — metadata tidak bisa dikoreksi lagi lewat sini`, 409);
  }
  const IZIN_FIELD = new Set(["description", "notes", "vendorName", "paymentMethod", "picUserId", "metadata"]);
  const data = {};
  const auditRows = [];
  for (const [field, after] of Object.entries(changes || {})) {
    if (!IZIN_FIELD.has(field)) throw new SubmissionError(`Field "${field}" tidak bisa dikoreksi lewat metadata — perubahan finansial lewat workflow koreksi Finance`, 400);
    const before = s[field];
    const beforeStr = typeof before === "object" ? JSON.stringify(before) : (before ?? null);
    const afterStr = typeof after === "object" ? JSON.stringify(after) : (after ?? null);
    if (beforeStr === afterStr) continue;
    data[field] = after;
    auditRows.push({ id: randomUUID(), submissionId: id, field, before: beforeStr, after: afterStr, reason: reason.trim(), actorId: user.id });
  }
  if (auditRows.length === 0) return bentukSubmission(await db.expenseSubmission.findUnique({ where: { id }, include: submissionInclude }));
  const [updated] = await db.$transaction([
    db.expenseSubmission.update({ where: { id }, data, include: submissionInclude }),
    db.expenseSubmissionAudit.createMany({ data: auditRows }),
  ]);
  return bentukSubmission(updated);
}

/** Sinkronkan status pengajuan begitu FinExpense-nya bertransisi (approve/reject/pay/cancel/koreksi) — dipanggil dari financeTransactions.js di titik transisi. No-op kalau tidak ada pengajuan yang menaut. */
export async function sinkronStatusDariFinExpense(tx, finExpenseId) {
  const s = await tx.expenseSubmission.findUnique({ where: { finExpenseId }, select: { id: true } });
  if (!s) return;
  const fe = await tx.finExpense.findUnique({ where: { id: finExpenseId }, select: { status: true } });
  if (!fe) return;
  await tx.expenseSubmission.update({ where: { id: s.id }, data: { status: FIN_TO_SUBMISSION_STATUS[fe.status] || "MENUNGGU_PERSETUJUAN" } });
}

/** Heuristik deteksi kemungkinan duplikat — kendaraan/jenis/tanggal/nominal sama dalam rentang pendek. Hanya PERINGATAN, tidak pernah memblokir. */
export async function cekKemungkinanDuplikat(db, { division, vehicleId, expenseType, date, amount, excludeId }) {
  if (!vehicleId && !expenseType) return [];
  const tgl = toBookDate(date);
  const mulai = new Date(tgl); mulai.setDate(mulai.getDate() - 2);
  const selesai = new Date(tgl); selesai.setDate(selesai.getDate() + 2);
  const kandidat = await db.expenseSubmission.findMany({
    where: {
      division, expenseType, date: { gte: mulai, lte: selesai },
      ...(vehicleId && { vehicleId }),
      ...(excludeId && { id: { not: excludeId } }),
      status: { notIn: ["DIBATALKAN", "DITOLAK"] },
    },
    select: { id: true, submissionNumber: true, amount: true, date: true, status: true },
    take: 5,
  });
  const nominal = amount != null ? toMoney(amount) : null;
  return kandidat
    .filter((k) => !nominal || Math.abs(moneyToNumber(k.amount) - Number(nominal)) < 1)
    .map((k) => ({ ...k, amount: moneyToNumber(k.amount) }));
}

export { bentukSubmission, bentukExpense, finExpenseInclude };
