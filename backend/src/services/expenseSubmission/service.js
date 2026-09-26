// PENGAJUAN BIAYA LINTAS DIVISI — service bersama. SATU-SATUNYA tempat yang boleh
// membuat/mengubah baris ExpenseSubmission dan menautkannya ke FinExpense. Lihat banner
// prinsip di schema.prisma#ExpenseSubmission sebelum mengubah file ini.

import { randomUUID } from "node:crypto";
import {
  buatFinExpense, tarikFinExpense as tarikFinExpenseAsli, setujuiFinExpense,
  expenseInclude as finExpenseInclude, bentukExpense,
} from "../finance/expenses.js";
import { generateDocumentNumber, todayBookDateWIB, toBookDate } from "../finance/journal.js";
import { toMoney, moneyToNumber } from "../finance/money.js";
import { pastikanUangMukaBolehDipakai } from "../finance/operationalAdvance.js";
import { hasPermission, rolesOf } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { getWorkspaceConfig, bolehAutoApprove, SUMBER_DANA, ARAHAN_MODUL_LAIN, JENIS_TERLARANG_STOK, ARAHAN_JENIS, ringkasKonteksMetadata } from "./config.js";
import { ownOnly } from "./ownPolicy.js";

import { SubmissionError } from "./errors.js";
import { pastikanBukanDokumenInventory } from "./guard.js";
import { workspaceUntukDivisi, bolehCatatAtasNama } from "./access.js";

export { SubmissionError };

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
  revisionRequestedBy: { select: { id: true, name: true } },
  picUser: { select: { id: true, name: true } },
  driver: { select: { id: true, name: true } },
  helper: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNumber: true, type: true } },
  route: { select: { id: true, date: true } },
  job: { select: { id: true, type: true, status: true } },
  order: { select: { id: true, orderNumber: true } },
  unit: { select: { id: true, unitCode: true } },
  workCenter: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  material: { select: { id: true, code: true, name: true, unit: true } },
  vehicleExpense: { select: { id: true, odometerKm: true, liters: true, category: true } },
  finExpense: { select: { id: true, expenseNumber: true, status: true, amount: true, cashAccountId: true, approvedAt: true, paidAt: true, rejectReason: true, advanceAppliedAmount: true } },
  advance: { select: { id: true, advanceNumber: true, holderId: true, purpose: true, dueDate: true, status: true } },
  createdBy: { select: { id: true, name: true } },
  proofs: { where: { supersededAt: null }, orderBy: { createdAt: "desc" } },
  auditTrail: { orderBy: { createdAt: "desc" }, take: 50, include: { actor: { select: { id: true, name: true } } } },
};

function bentukSubmission(s) {
  const finStatus = s.finExpense?.status;
  // Status EFEKTIF: begitu FinExpense ada, statusnya SELALU mengikuti FinExpense (satu
  // sumber kebenaran) — kolom `status` tersimpan tetap di-refresh oleh sinkronStatus()
  // di titik transisi FinExpense, tapi field ini adalah jaminan tambahan di lapisan baca.
  // Pengecualian TUNGGAL: OTOMATIS_DISETUJUI TETAP tampil beda dari DISETUJUI manual
  // selama FinExpense-nya masih persis DISETUJUI (belum dibayar/ditolak/dibatalkan oleh
  // manusia) — supaya "diajukan otomatis vs disetujui manusia" tidak hilang begitu saja
  // dari tampilan (lihat req #3 audit-ability auto-approve).
  const statusEfektif = finStatus
    ? (finStatus === "DISETUJUI" && s.status === "OTOMATIS_DISETUJUI" ? "OTOMATIS_DISETUJUI" : (FIN_TO_SUBMISSION_STATUS[finStatus] || s.status))
    : s.status;
  return {
    ...s,
    amount: moneyToNumber(s.amount),
    finExpense: s.finExpense ? { ...s.finExpense, amount: moneyToNumber(s.finExpense.amount) } : null,
    status: statusEfektif,
  };
}

/** Finance/Admin boleh "catat atas nama" (requestedById != diri sendiri) di semua workspace; Dispatcher hanya di Delivery; lainnya TIDAK. */
function bolehCatatAtasNamaOrangLain(user, workspace = "DELIVERY") {
  return bolehCatatAtasNama(user, workspace);
}

/** Usulan sumber dana -> hint mode FinExpense. `undefined` = biarkan buatFinExpense pilih default dari kapabilitas user (perilaku lama, tidak berubah kalau field ini kosong). */
// ⚠️ REKENING_PERUSAHAAN & UANG_MUKA_OPERASIONAL SENGAJA dipetakan ke UTANG,
// BUKAN LANGSUNG — form Pengajuan Biaya TIDAK mengumpulkan cashAccountId sama
// sekali (banner prinsip: "Finance yang menentukan cashAccount FINAL"), dan
// buatFinExpense() MEWAJIBKAN cashAccountId untuk mode LANGSUNG di titik
// pembuatan. Memetakan ke LANGSUNG di sini akan membuat ajukanPengajuan()
// SELALU gagal 400 untuk dua sumberDana ini begitu pemohonnya punya
// FINANCE_POST (mode efektif ikut hint, bukan dipaksa REIMBURSEMENT lagi).
// UTANG punya sifat yang pas: beban diakui sekarang, rekening/kas KONKRET
// dipilih Finance belakangan saat /pay — persis alur "sumber dananya jelas
// TAPI rekening spesifik ditentukan nanti" yang dua sumberDana ini maksudkan.
// sumberDana ITU SENDIRI tetap tersimpan apa adanya (lihat field di atas) —
// pemetaan mode di sini murni teknis, tidak menghilangkan informasi yang
// pemohon pilih.
function modeDariSumberDana(sumberDana) {
  switch (sumberDana) {
    case "REKENING_PERUSAHAAN": return "UTANG";
    // UANG_MUKA_OPERASIONAL TIDAK dipetakan ke UTANG biasa lagi (itu menyebabkan uang keluar dua kali):
    // ajukanPengajuan() mewajibkan uang muka aktif (advanceId) dan memakai mode UANG_MUKA.
    case "TALANGAN_PRIBADI": return "REIMBURSEMENT";
    case "BELUM_DIBAYAR": return "UTANG";
    // Default "UTANG", BUKAN undefined — kalau dibiarkan undefined,
    // buatFinExpense() sendiri jatuh balik ke LANGSUNG (default-nya untuk
    // form Finance lama yang SELALU mengumpulkan cashAccountId), yang di
    // sini akan gagal 400 (cashAccountId selalu null dari ajukanPengajuan)
    // untuk SETIAP pemohon ber-FINANCE_POST yang belum memilih sumber dana
    // sama sekali — bukan cuma yang pilih REKENING_PERUSAHAAN/UANG_MUKA.
    default: return "UTANG";
  }
}

function validasiTipe(workspace, expenseType) {
  const cfg = getWorkspaceConfig(workspace);
  if (!cfg) throw new SubmissionError(`Workspace "${workspace}" tidak dikenal`, 400);
  const kodeJenis = String(expenseType || "").toUpperCase();
  if (cfg.strict && ARAHAN_JENIS[kodeJenis]) {
    const a = ARAHAN_JENIS[kodeJenis];
    throw new SubmissionError(`Jenis biaya "${expenseType}" (${a.label}) tidak diproses lewat Pengajuan Biaya — gunakan ${a.ke}.`, 422);
  }
  if (JENIS_TERLARANG_STOK.includes(kodeJenis)) {
    throw new SubmissionError(
      `Jenis biaya "${expenseType}" adalah urusan stok/pembelian — bukan Pengajuan Biaya (akan terhitung dua kali). ` +
      `Gunakan: ${ARAHAN_MODUL_LAIN.map((a) => `${a.kebutuhan} → ${a.ke}`).join("; ")}.`, 422);
  }
  if (cfg.tanpaAkun?.[expenseType]) throw new SubmissionError(cfg.tanpaAkun[expenseType], 422);
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

/**
 * C2.1 — SEMUA workspace (termasuk Delivery): membatalkan pengajuan hanya oleh pemohon/pembuat atau admin keuangan (sama dengan tarik/ajukan/ubah).
 */
function pastikanMilikAtauAdmin(s, user, aksi) {
  if (s.requestedById !== user.id && s.createdById !== user.id && !hasPermission(user, P.FINANCE_ADMIN)) {
    throw new SubmissionError(`Hanya pemohon sendiri (atau admin keuangan) yang boleh ${aksi} pengajuan ini`, 403);
  }
}

/** C2.1 — koreksi metadata di SEMUA workspace: pemilik pengajuan atau staf Finance (finance:post / finance:admin). */
function pastikanMilikAtauStaf(s, user) {
  const staf = hasPermission(user, P.FINANCE_POST) || hasPermission(user, P.FINANCE_ADMIN);
  if (!staf && s.requestedById !== user.id && s.createdById !== user.id) {
    throw new SubmissionError("Hanya pemohon sendiri atau staf Finance yang boleh mengoreksi data pengajuan ini", 403);
  }
}

/** Buat pengajuan baru berstatus DRAFT — bebas diedit selama masih di sini. */
export async function buatPengajuan(db, { workspace, user, body }) {
  const cfg = validasiTipe(workspace, body.expenseType);
  const nominal = body.amount != null ? toMoney(body.amount, { field: "Nominal pengajuan" }) : null;
  if (nominal && nominal.lessThanOrEqualTo(0)) throw new SubmissionError("Nominal harus lebih dari 0");
  if (body.sumberDana !== undefined && body.sumberDana !== null && body.sumberDana !== "" && !SUMBER_DANA.some((s) => s.code === body.sumberDana)) {
    throw new SubmissionError(`Sumber dana "${body.sumberDana}" tidak dikenal`, 400);
  }

  // Catat atas nama pengaju (D-181) — requestedById BOLEH orang lain, TAPI
  // cuma untuk Finance/Dispatcher (lihat bolehCatatAtasNamaOrangLain). Diam-
  // diam turun ke `user.id` sendiri untuk siapa pun yang tidak punya izin
  // itu, BUKAN ditolak — supaya form pengajuan normal (pengaju mengisi
  // untuk dirinya sendiri) tidak perlu tahu-menahu soal aturan ini sama
  // sekali.
  let requestedById = user.id;
  if (body.requestedById && body.requestedById !== user.id) {
    if (!bolehCatatAtasNamaOrangLain(user, workspace)) {
      throw new SubmissionError(workspace === "DELIVERY" ? "Hanya Finance atau Dispatcher yang boleh mencatat pengajuan atas nama orang lain" : "Hanya Finance yang boleh mencatat pengajuan atas nama orang lain", 403);
    }
    const requester = await db.user.findUnique({ where: { id: body.requestedById }, select: { id: true } });
    if (!requester) throw new SubmissionError("Pemohon (atas nama) tidak ditemukan", 404);
    requestedById = body.requestedById;
  }

  // C1 — relasi Produksi/Gudang, kebijakan jenis biaya, dan guard anti double-counting (hanya workspace baru; Delivery tidak berubah).
  const konteks = await validasiKonteks(db, { workspace, cfg, body, excludeId: null, tahap: "draf" });

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
  let picNameSnapshot = null;
  if (body.picUserId) {
    const pic = await db.user.findUnique({ where: { id: body.picUserId }, select: { name: true } });
    if (!pic) throw new SubmissionError("PIC tidak ditemukan", 404);
    picNameSnapshot = pic.name;
  }

  // Uang Muka Operasional: bila dipilih, wajib milik pengaju/PIC dan masih aktif (memilih WAJIB paling lambat saat diajukan).
  let advanceId = null;
  if (body.sumberDana === "UANG_MUKA_OPERASIONAL" && body.advanceId) {
    await pastikanUangMukaBolehDipakai(db, { advanceId: body.advanceId, pemilikIds: [requestedById, body.picUserId] });
    advanceId = body.advanceId;
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
      requestedById,
      picUserId: body.picUserId || null,
      picNameSnapshot,
      // WhatsApp/lisan cuma komunikasi, BUKAN sumber pencatatan — field di bawah
      // ini murni jejak MANUSIA yang mencatat, tidak pernah diisi otomatis dari
      // webhook/integrasi WA manapun.
      // requestedAt SENGAJA `new Date()` biasa (bukan toBookDate — itu untuk
      // kolom @db.Date tanggal buku, ini kolom timestamp lengkap jam:menit).
      requestedAt: body.requestedAt ? new Date(body.requestedAt) : null,
      urgentReason: body.urgentReason?.trim() || null,
      sourceNote: body.sourceNote?.trim() || null,
      sumberDana: body.sumberDana || null,
      advanceId,
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
      ...konteks.data,
      vehiclePlateSnapshot, driverNameSnapshot, helperNameSnapshot, routeNameSnapshot,
      metadata: body.metadata || {},
      paymentMethod: body.paymentMethod?.trim() || null,
      vendorName: body.vendorName?.trim() || null,
      status: "DRAFT",
      createdById: user.id,
    },
    include: submissionInclude,
  });
  await catatAudit(db, { submissionId: created.id, actorId: user.id, field: "status", before: null, after: "DRAFT", reason: "Pengajuan dibuat" });
  return bentukSubmission(created);
}

/** Satu baris jejak audit (siapa, kapan, apa, sebelum/sesudah, alasan). Dipakai SEMUA mutation pengajuan. */
export function catatAudit(db, { submissionId, actorId, field, before = null, after = null, reason = null }) {
  return db.expenseSubmissionAudit.create({
    data: { id: randomUUID(), submissionId, field, before: before == null ? null : String(before), after: after == null ? null : String(after), reason, actorId },
  });
}

/** Edit pengajuan — sah selama DRAFT atau PERLU_REVISI (seluruh field boleh diubah). Perubahan tetap dicatat di audit (field yang berubah). */
export async function ubahPengajuanDraft(db, { id, user, body }) {
  const s = await db.expenseSubmission.findUnique({ where: { id } });
  if (!s) throw new SubmissionError("Pengajuan tidak ditemukan", 404);
  if (!["DRAFT", "PERLU_REVISI"].includes(s.status)) throw new SubmissionError(`Pengajuan berstatus ${s.status} — hanya draf atau yang diminta revisi yang bisa diedit`, 409);
  if (s.requestedById !== user.id && s.createdById !== user.id && !hasPermission(user, P.FINANCE_ADMIN)) {
    throw new SubmissionError("Hanya pemohon sendiri (atau admin keuangan) yang boleh mengedit draf ini", 403);
  }
  const wsKey = workspaceUntukDivisi(s.division);
  const cfg = validasiTipe(wsKey, body.expenseType ?? s.expenseType);
  const nominal = body.amount != null ? toMoney(body.amount, { field: "Nominal pengajuan" }) : null;
  const data = {};
  const konteksBaru = await validasiKonteks(db, { workspace: wsKey, cfg, body: { ...s, ...body, expenseType: body.expenseType ?? s.expenseType, metadata: body.metadata ?? s.metadata }, excludeId: id, tahap: "draf", punyaBodyRelasi: body });
  Object.assign(data, konteksBaru.data);
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
  if (body.metadata !== undefined) data.metadata = body.metadata || {};
  if (body.paymentMethod !== undefined) data.paymentMethod = body.paymentMethod?.trim() || null;
  if (body.vendorName !== undefined) data.vendorName = body.vendorName?.trim() || null;
  if (body.costCenter !== undefined) data.costCenter = body.costCenter?.trim() || null;
  if (body.urgentReason !== undefined) data.urgentReason = body.urgentReason?.trim() || null;
  if (body.sourceNote !== undefined) data.sourceNote = body.sourceNote?.trim() || null;
  if (body.requestedAt !== undefined) data.requestedAt = body.requestedAt ? new Date(body.requestedAt) : null;
  if (body.sumberDana !== undefined) {
    if (body.sumberDana && !SUMBER_DANA.some((x) => x.code === body.sumberDana)) throw new SubmissionError(`Sumber dana "${body.sumberDana}" tidak dikenal`, 400);
    data.sumberDana = body.sumberDana || null;
  }
  if (body.requestedById !== undefined && body.requestedById !== s.requestedById) {
    if (!bolehCatatAtasNamaOrangLain(user, wsKey)) throw new SubmissionError(wsKey === "DELIVERY" ? "Hanya Finance atau Dispatcher yang boleh mencatat pengajuan atas nama orang lain" : "Hanya Finance yang boleh mencatat pengajuan atas nama orang lain", 403);
    const requester = await db.user.findUnique({ where: { id: body.requestedById }, select: { id: true } });
    if (!requester) throw new SubmissionError("Pemohon (atas nama) tidak ditemukan", 404);
    data.requestedById = body.requestedById;
  }
  if (body.picUserId !== undefined && body.picUserId !== s.picUserId) {
    const pic = body.picUserId ? await db.user.findUnique({ where: { id: body.picUserId }, select: { name: true } }) : null;
    if (body.picUserId && !pic) throw new SubmissionError("PIC tidak ditemukan", 404);
    data.picUserId = body.picUserId || null;
    data.picNameSnapshot = pic?.name || null;
  }
  // Uang Muka Operasional: kaitan ke uang muka hanya berlaku selama sumber dananya memang itu.
  const sumberBaru = body.sumberDana !== undefined ? (body.sumberDana || null) : s.sumberDana;
  if (sumberBaru !== "UANG_MUKA_OPERASIONAL") {
    if (s.advanceId) data.advanceId = null;
  } else if (body.advanceId !== undefined) {
    if (body.advanceId) {
      await pastikanUangMukaBolehDipakai(db, {
        advanceId: body.advanceId,
        pemilikIds: [data.requestedById ?? s.requestedById, data.picUserId !== undefined ? data.picUserId : s.picUserId],
      });
      data.advanceId = body.advanceId;
    } else {
      data.advanceId = null;
    }
  }
  void cfg;
  const updated = await db.expenseSubmission.update({ where: { id }, data, include: submissionInclude });
  await catatAudit(db, { submissionId: id, actorId: user.id, field: "draft", before: null, after: Object.keys(data).sort().join(", ") || "-", reason: s.status === "PERLU_REVISI" ? "Perbaikan setelah diminta revisi" : "Edit draf" });
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
    if (!["DRAFT", "PERLU_REVISI"].includes(s.status)) throw new SubmissionError(`Pengajuan berstatus ${s.status} — hanya draf atau yang diminta revisi yang bisa diajukan`, 409);
    if (s.requestedById !== user.id && s.createdById !== user.id && !hasPermission(user, P.FINANCE_ADMIN)) {
      throw new SubmissionError("Hanya pemohon sendiri (atau admin keuangan) yang boleh mengajukan", 403);
    }

    const wsKey = workspaceUntukDivisi(s.division);
    const cfg = getWorkspaceConfig(wsKey) || { division: s.division };
    // C1 — validasi ULANG saat diajukan (draf bisa diubah lewat jalur lain): jenis biaya, relasi wajib, alasan mendesak, metadata wajib, guard dokumen.
    if (cfg.strict) await validasiKonteks(tx, { workspace: wsKey, cfg, body: s, excludeId: id, tahap: "ajukan" });

    // Kunci idempotensi domain — kalau baris sudah punya idempotencyKey lain (mustahil di
    // jalur normal, hanya bisa lewat retry dengan header berbeda pada baris yg sama),
    // tolak eksplisit daripada diam-diam menimpa.
    if (s.idempotencyKey && idemKey && s.idempotencyKey !== idemKey) {
      throw new SubmissionError("Pengajuan ini sudah diproses dengan kunci permintaan yang berbeda", 409);
    }

    // Bukti yang sudah diunggah ke PENGAJUAN (ExpenseSubmissionProof, lewat
    // POST .../bukti) sebelum diajukan — dituntun jadi FinExpense.receiptUrl
    // supaya pastikanNotaLengkap() (dipanggil setujuiFinExpense() di bawah,
    // baik jalur manual maupun otomatis) benar-benar MELIHAT nota yang sudah
    // ada, bukan menganggap belum ada nota sama sekali. Versi TERBARU (belum
    // superseded) yang dipakai — sejalan dengan "bukti pakai versi, bukan
    // overwrite" (banner prinsip #3).
    const buktiTerakhir = await tx.expenseSubmissionProof.findFirst({
      where: { submissionId: id, supersededAt: null }, orderBy: { createdAt: "desc" }, select: { url: true },
    });

    // Uang Muka Operasional: WAJIB memilih uang muka aktif milik pengaju/PIC. Tidak ada jalan pintas ke UTANG biasa.
    let advanceId = null;
    if (s.sumberDana === "UANG_MUKA_OPERASIONAL") {
      if (!s.advanceId) {
        throw new SubmissionError("Sumber dana Uang muka operasional wajib memilih uang muka aktif milik pengaju atau PIC", 422);
      }
      await pastikanUangMukaBolehDipakai(tx, { advanceId: s.advanceId, pemilikIds: [s.requestedById, s.picUserId] });
      advanceId = s.advanceId;
    }

    const finExpense = await buatFinExpense(tx, {
      advanceId,
      date: s.date, amount: s.amount, description: s.description, categoryId: await kategoriUntuk(tx, cfg, s.expenseType),
      division: cfg.division, mode: modeDariSumberDana(s.sumberDana), // hint dari usulan pemohon; buatFinExpense tetap memutuskan mode EFEKTIF dari kapabilitas user
      cashAccountId: null, supplierId: null,
      // reimburseToId = PEMOHON ASLI (s.requestedById), bukan siapa pun yang
      // memanggil /ajukan — requestedById sudah divalidasi (izin "catat atas
      // nama") SEKALI saat dokumen dibuat (buatPengajuan), jadi aman dipakai
      // apa adanya di sini tanpa cek ulang. reimburseToOverrideAllowed:true
      // supaya nilainya TIDAK diam-diam ditimpa `user.id` pemanggil ajukan
      // kalau kebetulan pemanggilnya bukan FINANCE_POST (mis. Dispatcher yang
      // mencatat untuk driver — uangnya harus kembali ke driver, bukan ke
      // dispatcher).
      reimburseToId: s.requestedById, reimburseToOverrideAllowed: true,
      payeeName: s.vendorName, orderId: s.orderId, unitId: s.unitId || null,
      // Produksi/Gudang: pengaju non-Finance TIDAK dipaksa jadi reimbursement — sumber dana usulan dihormati (UTANG/REIMBURSEMENT; Finance tetap memutuskan bayar).
      ikutiModeUsulan: !!cfg.strict,
      receiptUrl: buktiTerakhir?.url || null, notes: s.notes, langsungAjukan: true, user,
    });

    // Auto-approve (D-181) — jenis biaya rutin bernilai kecil (lihat
    // config.js#bolehAutoApprove) langsung disetujui dalam TRANSAKSI YANG
    // SAMA dengan pembuatan FinExpense-nya, jadi baik dokumen maupun jurnal
    // pengakuan bebannya lahir atomik bersama status pengajuan — TIDAK ada
    // jendela waktu di mana satu ada tanpa yang lain.
    // Aktor own-only (Driver/Helper/Leader Driver) diturunkan dari izin server-side — TIDAK auto-approve.
    const mandiriOwn = ownOnly(user);
    const autoApproved = bolehAutoApprove(cfg, s.expenseType, s.amount, { mandiriOwn });
    const seharusnyaOtomatis = mandiriOwn && bolehAutoApprove(cfg, s.expenseType, s.amount);
    let catatanOtomatis = null;
    if (autoApproved) {
      catatanOtomatis = `Auto-approve: jenis "${s.expenseType}" ≤ Rp${cfg.autoApprove.maxAmount.toLocaleString("id-ID")} (kebijakan ${cfg.label})`;
      await setujuiFinExpense(tx, { id: finExpense.id, actor: user, autoApproved: true, catatanOtomatis });
    }

    await tx.$executeRawUnsafe("SAVEPOINT sp_ajukan_pengajuan");
    let updated;
    try {
      updated = await tx.expenseSubmission.update({
        where: { id },
        data: {
          finExpenseId: finExpense.id,
          status: autoApproved ? "OTOMATIS_DISETUJUI" : "MENUNGGU_PERSETUJUAN",
          submittedAt: new Date(), idempotencyKey: idemKey || null,
        },
        include: submissionInclude,
      });
      if (autoApproved) {
        // Audit trail EKSPLISIT (req #3: "auto-approved tetap audit-able") —
        // actorId null menandai SISTEM yang bertindak, bukan manusia; reason
        // menyimpan kebijakan persis yang dipakai supaya bisa ditelusuri
        // balik kalau ambang batasnya kelak berubah.
        await tx.expenseSubmissionAudit.create({
          data: {
            id: randomUUID(), submissionId: id, field: "status",
            before: "DRAFT", after: "OTOMATIS_DISETUJUI", reason: catatanOtomatis, actorId: null,
          },
        });
      } else {
        await catatAudit(tx, {
          submissionId: id, actorId: user.id, field: "status", before: s.status, after: "MENUNGGU_PERSETUJUAN",
          reason: seharusnyaOtomatis
            ? "Diajukan; auto-approve tidak berlaku untuk pengajuan mandiri (menunggu persetujuan Finance)"
            : (s.status === "PERLU_REVISI" ? "Diajukan ulang setelah revisi" : "Diajukan"),
        });
      }
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

/**
 * Kategori FinExpense untuk workspace+jenis biaya — pemetaan EKSPLISIT dari
 * cfg.categoryMapping (config.js), TIDAK PERNAH fallback ke "kategori aktif
 * mana pun". Jenis biaya yang belum dipetakan/kategorinya belum aktif
 * memblokir pengajuan dengan pesan jelas — lebih baik tertahan sebentar
 * daripada salah akun di laporan keuangan.
 */
async function kategoriUntuk(tx, cfg, expenseType) {
  const code = cfg.categoryMapping?.[expenseType];
  if (!code) {
    throw new SubmissionError(
      `Jenis biaya "${expenseType}" belum punya pemetaan kategori Finance untuk ${cfg.label || cfg.division} — hubungi Finance untuk memasangnya sebelum bisa diajukan`,
      422
    );
  }
  const kategori = await tx.finExpenseCategory.findUnique({ where: { code }, select: { id: true, active: true } });
  if (!kategori || !kategori.active) {
    throw new SubmissionError(
      `Kategori Finance "${code}" untuk jenis biaya "${expenseType}" belum terpasang atau nonaktif — hubungi Finance untuk memasangnya sebelum bisa diajukan`,
      422
    );
  }
  return kategori.id;
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
  await catatAudit(db, { submissionId: id, actorId: user.id, field: "status", before: "MENUNGGU_PERSETUJUAN", after: "DRAFT", reason: "Ditarik kembali oleh pemohon" });
  return bentukSubmission(updated);
}

/**
 * MINTA REVISI — reviewer (finance:approve) mengembalikan pengajuan yang MENUNGGU_PERSETUJUAN
 * ke pemilik untuk diperbaiki. BEDA dari tarik (aksi pemilik) dan batalkan (mengakhiri).
 * Alasan WAJIB. FinExpense ditarik ke DRAFT persis seperti tarik (tidak menyentuh buku besar:
 * FinExpense MENUNGGU_APPROVAL belum pernah diposting), pengajuan lepas dari FinExpense dan
 * berstatus PERLU_REVISI; pemilik mengedit lalu mengajukan ulang (FinExpense baru).
 * Atomik dengan kunci baris; retry tidak mengubah apa pun (status sudah bukan MENUNGGU_PERSETUJUAN -> 409).
 */
export async function mintaRevisiPengajuan(prismaClient, { id, user, reason }) {
  const alasan = String(reason || "").trim();
  if (alasan.length < 3) throw new SubmissionError("Alasan revisi wajib diisi (minimal 3 karakter)", 400);
  return prismaClient.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT id FROM "expense_submissions" WHERE id = $1::uuid FOR UPDATE', id);
    const s = await tx.expenseSubmission.findUnique({ where: { id }, include: { finExpense: { select: { id: true, status: true } } } });
    if (!s) throw new SubmissionError("Pengajuan tidak ditemukan", 404);
    if (s.status !== "MENUNGGU_PERSETUJUAN" || !s.finExpenseId || s.finExpense?.status !== "MENUNGGU_APPROVAL") {
      throw new SubmissionError(`Pengajuan berstatus ${s.status} — revisi hanya bisa diminta saat masih menunggu persetujuan`, 409);
    }
    if (s.requestedById === user.id || s.createdById === user.id) {
      throw new SubmissionError("Anda tidak bisa meminta revisi untuk pengajuan Anda sendiri — gunakan Tarik", 403);
    }
    await tx.finExpense.update({ where: { id: s.finExpenseId }, data: { status: "DRAFT", submittedAt: null } });
    const updated = await tx.expenseSubmission.update({
      where: { id },
      data: {
        status: "PERLU_REVISI", finExpenseId: null, submittedAt: null, idempotencyKey: null,
        revisionReason: alasan, revisionRequestedById: user.id, revisionRequestedAt: new Date(),
      },
      include: submissionInclude,
    });
    await catatAudit(tx, { submissionId: id, actorId: user.id, field: "status", before: "MENUNGGU_PERSETUJUAN", after: "PERLU_REVISI", reason: alasan });
    return bentukSubmission(updated);
  }, { timeout: 20_000, maxWait: 20_000 });
}

/** Batalkan — sebelum FinExpense ada (langsung), atau sesudahnya (delegasi ke /expenses/:id/cancel yang sudah ada, FINANCE_ADMIN). */
export async function batalkanPengajuan(db, { id, user, reason }) {
  const s = await db.expenseSubmission.findUnique({ where: { id } });
  if (!s) throw new SubmissionError("Pengajuan tidak ditemukan", 404);
  pastikanMilikAtauAdmin(s, user, "membatalkan");
  if (!s.finExpenseId) {
    if (!["DRAFT", "PERLU_REVISI", "MENUNGGU_PERSETUJUAN"].includes(s.status)) throw new SubmissionError(`Pengajuan berstatus ${s.status} — tidak bisa dibatalkan`, 409);
    const updated = await db.expenseSubmission.update({ where: { id }, data: { status: "DIBATALKAN" }, include: submissionInclude });
    await catatAudit(db, { submissionId: id, actorId: user.id, field: "status", before: s.status, after: "DIBATALKAN", reason: reason?.trim() || "Dibatalkan oleh pemohon" });
    return bentukSubmission(updated);
  }
  throw new SubmissionError("Pengajuan ini sudah punya FinExpense — batalkan lewat aksi Batalkan pada dokumen Finance-nya (butuh FINANCE_ADMIN)", 409);
}

/** Koreksi metadata NON-finansial (keterangan/vendor/penautan) dengan jejak audit before/after. Dibekukan begitu DIBAYAR — koreksi lanjut lewat workflow koreksi FinExpense. */
export async function ubahMetadataPengajuan(db, { id, user, reason, changes }) {
  if (!reason?.trim()) throw new SubmissionError("Alasan perubahan wajib diisi");
  const s = await db.expenseSubmission.findUnique({ where: { id }, include: { finExpense: { select: { status: true } } } });
  if (!s) throw new SubmissionError("Pengajuan tidak ditemukan", 404);
  pastikanMilikAtauStaf(s, user);
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
  const s = await tx.expenseSubmission.findUnique({ where: { finExpenseId }, select: { id: true, status: true } });
  if (!s) return;
  const fe = await tx.finExpense.findUnique({ where: { id: finExpenseId }, select: { status: true } });
  if (!fe) return;
  // Jangan turunkan OTOMATIS_DISETUJUI jadi DISETUJUI polos kalau FinExpense-nya
  // MASIH persis DISETUJUI (mis. koreksi metadata yang tidak mengubah status) —
  // penanda "ini lahir otomatis" cuma boleh hilang saat statusnya benar-benar
  // berubah lebih lanjut (dibayar/ditolak/dibatalkan), bukan tertimpa diam-diam
  // oleh sinkronisasi rutin. Lihat bentukSubmission() untuk logika baca yang sama.
  if (s.status === "OTOMATIS_DISETUJUI" && fe.status === "DISETUJUI") return;
  await tx.expenseSubmission.update({ where: { id: s.id }, data: { status: FIN_TO_SUBMISSION_STATUS[fe.status] || "MENUNGGU_PERSETUJUAN" } });
}

/**
 * Heuristik deteksi kemungkinan duplikat — kendaraan/jenis/tanggal/nominal/PIC
 * sama dalam rentang pendek. HANYA PERINGATAN, tidak pernah memblokir — kecuali
 * duplikat BENAR-BENAR identik (retry/double-click dengan idempotencyKey yang
 * sama), yang dicegah di level lain (ajukanPengajuan(), SAVEPOINT+unique
 * constraint), bukan di sini. `picUserId` OPSIONAL — kalau diisi, mempersempit
 * kandidat ke PIC yang sama (mengurangi peringatan palsu antar-driver yang
 * kebetulan isi BBM tanggal & nominal mirip). Kandidat yang dikembalikan
 * membawa `adaBukti` (sudah punya foto nota versi aktif atau belum) supaya
 * pemohon/Finance bisa menilai sendiri seberapa besar kemungkinan ini memang
 * duplikat nyata, bukan kebetulan.
 */
export async function cekKemungkinanDuplikat(db, { division, vehicleId, expenseType, date, amount, excludeId, picUserId, workCenterId, warehouseId, unitId, documentRef, hanyaMilikId = null }) {
  if (!vehicleId && !expenseType) return [];
  const tgl = toBookDate(date);
  const mulai = new Date(tgl); mulai.setDate(mulai.getDate() - 2);
  const selesai = new Date(tgl); selesai.setDate(selesai.getDate() + 2);
  const kandidat = await db.expenseSubmission.findMany({
    where: {
      division, expenseType, date: { gte: mulai, lte: selesai },
      ...(vehicleId && { vehicleId }),
      ...(workCenterId && { workCenterId }),
      ...(warehouseId && { warehouseId }),
      ...(unitId && { unitId }),
      ...(picUserId && { picUserId }),
      ...(excludeId && { id: { not: excludeId } }),
      status: { notIn: ["DIBATALKAN", "DITOLAK"] },
      // C2.1 — pengguna non-Finance hanya diperingatkan soal pengajuan MILIKNYA (tidak membocorkan pengajuan orang lain).
      ...(hanyaMilikId && { OR: [{ requestedById: hanyaMilikId }, { createdById: hanyaMilikId }] }),
    },
    select: {
      id: true, submissionNumber: true, amount: true, date: true, status: true,
      picNameSnapshot: true, vehiclePlateSnapshot: true, expenseType: true, description: true, documentRef: true, metadata: true,
      requestedBy: { select: { name: true } },
      workCenter: { select: { name: true } }, warehouse: { select: { name: true } }, unit: { select: { unitCode: true } }, material: { select: { code: true } },
      proofs: { where: { supersededAt: null }, select: { id: true }, take: 1 },
    },
    take: 5,
  });
  const nominal = amount != null ? toMoney(amount) : null;
  return kandidat
    .filter((k) => !nominal || Math.abs(moneyToNumber(k.amount) - Number(nominal)) < 1)
    .map(({ proofs, workCenter, warehouse, unit, material, requestedBy, metadata, ...k }) => ({
      ...k, amount: moneyToNumber(k.amount), adaBukti: proofs.length > 0, pemohon: requestedBy?.name || null,
      konteks: [unit && `unit ${unit.unitCode}`, workCenter && `mesin ${workCenter.name}`, warehouse && `gudang ${warehouse.name}`, material && `material ${material.code}`, ringkasKonteksMetadata(getWorkspaceConfig(workspaceUntukDivisi(division)), metadata)].filter(Boolean).join(" · ") || null,
    }));
}

/**
 * Pemetaan jenis biaya → kategori Finance harus terpasang & aktif. Kalau belum, pengajuan DIBLOKIR dengan penjelasan konfigurasi yang kurang
 * (lebih baik tertahan daripada salah akun). Dipakai juga oleh GET /config untuk menandai jenis yang belum siap.
 */
export async function statusKategori(db, cfg, tipe) {
  const kode = cfg.categoryMapping?.[tipe];
  if (!kode) return { siap: false, kode: null, alasan: `Jenis biaya "${tipe}" belum punya pemetaan kategori Finance untuk ${cfg.label} — Finance perlu memetakannya dulu` };
  const k = await db.finExpenseCategory.findUnique({ where: { code: kode }, select: { active: true } });
  if (!k) return { siap: false, kode, alasan: `Kategori Finance "${kode}" belum terpasang — Finance perlu memasangnya (Finance › Pengaturan › Pasang Akun Bawaan) sebelum jenis biaya ini bisa diajukan` };
  if (!k.active) return { siap: false, kode, alasan: `Kategori Finance "${kode}" nonaktif — Finance perlu mengaktifkannya kembali sebelum jenis biaya ini bisa diajukan` };
  return { siap: true, kode, alasan: null };
}

async function pastikanKategoriSiap(db, cfg, tipe) {
  const s = await statusKategori(db, cfg, tipe);
  if (!s.siap) throw new SubmissionError(s.alasan, 422);
}

/**
 * Validasi relasi & kebijakan workspace ketat (C1/C2). Mengembalikan `data` kolom relasi untuk disimpan.
 *  - relasi hanya yang diizinkan workspace (kendaraan/rute/job/driver/helper ditolak di sini)
 *  - unit ikut order-nya; mesin (WorkCenter), gudang, material harus ada & aktif
 *  - tahap "ajukan": relasi wajib per jenis, alasan mendesak, metadata wajib
 *  - guard anti double-counting: dokumen Inventory/Pembelian/Tagihan/Pengeluaran tidak boleh dicatat lagi
 */
async function validasiKonteks(db, { workspace, cfg, body, excludeId, tahap, punyaBodyRelasi = null }) {
  if (!cfg.strict) return { data: {} };
  const tipe = body.expenseType;
  // C2 — pemetaan kategori Finance wajib SIAP (ada & aktif) sebelum draf/pengajuan diterima; tidak ada fallback diam-diam.
  await pastikanKategoriSiap(db, cfg, tipe);
  const lain = ["vehicleId", "routeId", "jobId", "driverId", "helperId"].filter((k) => (punyaBodyRelasi ?? body)[k]);
  if (lain.length > 0) throw new SubmissionError(`Kendaraan, rute, job, driver, dan helper tidak berlaku untuk pengajuan ${cfg.label}`, 422);
  const izin = new Set(cfg.relations || []);
  const peta = { order: "orderId", unit: "unitId", machine: "workCenterId", warehouse: "warehouseId", material: "materialId", document: "documentRef" };
  const diisi = (punyaBodyRelasi ?? body);
  for (const [nama, kolom] of Object.entries(peta)) {
    if (!izin.has(nama) && diisi[kolom]) throw new SubmissionError(`Tautan ${nama === "machine" ? "mesin" : nama} tidak berlaku untuk pengajuan ${cfg.label}`, 422);
  }
  const data = {};
  const nilai = (k) => (body[k] === undefined ? undefined : (body[k] || null));
  let unit = null;
  if (izin.has("unit") && nilai("unitId")) {
    unit = await db.unit.findUnique({ where: { id: body.unitId }, select: { id: true, orderId: true, unitCode: true } });
    if (!unit) throw new SubmissionError("Unit produksi tidak ditemukan", 404);
    if (body.orderId && body.orderId !== unit.orderId) throw new SubmissionError("Unit itu bukan bagian dari order yang dipilih — unit selalu ikut order-nya", 422);
    data.unitId = unit.id; data.orderId = unit.orderId;
  } else if (punyaBodyRelasi && "unitId" in punyaBodyRelasi && !punyaBodyRelasi.unitId) data.unitId = null;
  const oid = punyaBodyRelasi ? punyaBodyRelasi.orderId : body.orderId;
  if (izin.has("order") && !unit && oid) {
    const o = await db.order.findUnique({ where: { id: oid }, select: { id: true } });
    if (!o) throw new SubmissionError("Order tidak ditemukan", 404);
  }
  if (punyaBodyRelasi && "orderId" in punyaBodyRelasi && !unit) data.orderId = punyaBodyRelasi.orderId || null;
  if (izin.has("machine") && nilai("workCenterId")) {
    const w = await db.workCenter.findUnique({ where: { id: body.workCenterId }, select: { id: true, active: true } });
    if (!w || !w.active) throw new SubmissionError("Mesin/area kerja tidak ditemukan atau nonaktif", 404);
  }
  if (punyaBodyRelasi && "workCenterId" in punyaBodyRelasi) data.workCenterId = punyaBodyRelasi.workCenterId || null;
  if (izin.has("warehouse") && nilai("warehouseId")) {
    const g = await db.warehouse.findUnique({ where: { id: body.warehouseId }, select: { id: true, active: true } });
    if (!g || !g.active) throw new SubmissionError("Gudang tidak ditemukan atau nonaktif", 404);
  }
  if (punyaBodyRelasi && "warehouseId" in punyaBodyRelasi) data.warehouseId = punyaBodyRelasi.warehouseId || null;
  if (izin.has("material") && nilai("materialId")) {
    const m = await db.material.findUnique({ where: { id: body.materialId }, select: { id: true } });
    if (!m) throw new SubmissionError("Material tidak ditemukan", 404);
  }
  if (punyaBodyRelasi && "materialId" in punyaBodyRelasi) data.materialId = punyaBodyRelasi.materialId || null;
  if (punyaBodyRelasi && "documentRef" in punyaBodyRelasi) data.documentRef = punyaBodyRelasi.documentRef ? String(punyaBodyRelasi.documentRef).trim().toUpperCase() : null;
  if (!punyaBodyRelasi) {
    // buat baru: semua relasi dari body apa adanya
    for (const [nama, kolom] of Object.entries(peta)) {
      if (kolom === "unitId" || !izin.has(nama)) continue;
      if (body[kolom]) data[kolom] = kolom === "documentRef" ? String(body[kolom]).trim().toUpperCase() : body[kolom];
    }
  }

  const efektif = { ...body, ...data };
  // Guard anti double-counting (di setiap tahap, jadi draf tidak bisa menyelundupkan dokumen stok/pembelian).
  await pastikanBukanDokumenInventory(db, {
    expenseType: tipe, documentRef: efektif.documentRef,
    teks: [body.description, body.notes, body.vendorName, body.sourceNote, body.urgentReason, body.metadata],
    excludeId,
  });

  if (tahap === "ajukan") {
    for (const rel of (cfg.relasiWajib?.[tipe] || [])) {
      const kolom = peta[rel];
      if (!efektif[kolom]) throw new SubmissionError(`Untuk ${cfg.expenseTypes.find((t) => t.code === tipe)?.label || tipe} wajib memilih ${rel === "machine" ? "mesin" : rel} yang dikerjakan`, 422);
    }
    if ((cfg.wajibAlasanMendesak || []).includes(tipe) && String(efektif.urgentReason || "").trim().length < 5) {
      throw new SubmissionError("Alasan mendesak wajib diisi (minimal 5 karakter) untuk jenis biaya ini", 422);
    }
    const meta = efektif.metadata && typeof efektif.metadata === "object" ? efektif.metadata : {};
    for (const f of cfg.metadataFields(tipe)) {
      if (f.required && (meta[f.key] === undefined || meta[f.key] === null || String(meta[f.key]).trim() === "")) {
        throw new SubmissionError(`${f.label} wajib diisi`, 422);
      }
    }
    if (!(Number(efektif.amount) > 0)) throw new SubmissionError("Nominal harus lebih dari 0 sebelum diajukan", 422);
  }
  return { data };
}

export { bentukSubmission, bentukExpense, finExpenseInclude };
