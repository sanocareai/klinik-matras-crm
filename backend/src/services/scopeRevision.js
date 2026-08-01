// Revisi scope — PRD §7.4 (FR-R), D-008.
//
// Kejadian paling umum di restorasi kasur: kasur dibongkar, kondisi aslinya
// lebih parah dari dugaan survei, harga harus berubah. Tanpa alur ini, total
// order diam-diam menyimpang dari yang benar-benar ditagih, dan lantai
// produksi tertahan di utas WhatsApp yang tidak bisa ditemukan lagi.
//
// SATU-SATUNYA jalur yang boleh menulis ke scope_revisions. Aturan bisnisnya
// ditegakkan DI SINI, bukan di route handler — PRD: "Illegal transitions must
// be rejected, not just hidden in the UI".

import { prisma } from "../db.js";
import { failStage } from "./unitStageEngine.js";
import { syncCustomerOrderAggregate } from "./customerOrderAggregate.js";

export class ScopeRevisionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Apakah revisi ini WAJIB memblokir unit sampai customer menjawab?
 *
 * ROUTING.md §5: perubahan LINI atau perubahan HARGA selalu memblokir.
 * Perubahan modul di dalam lini yang sama TANPA perubahan harga cukup dicatat
 * — memblokir untuk itu cuma menghentikan produksi tanpa ada yang perlu
 * ditanyakan ke customer.
 */
export function harusMemblokir({ deltaAmount, fromServiceLine, toServiceLine }) {
  if (Number(deltaAmount) !== 0) return true;
  if (fromServiceLine && toServiceLine && fromServiceLine !== toServiceLine) return true;
  return false;
}

/**
 * Ajukan revisi (FR-R-01). Dipanggil oleh produksi/QC setelah bongkar.
 *
 * FR-R-02: unit otomatis masuk BLOCKED: AWAITING_CUSTOMER_APPROVAL, dan jam
 * bloknya mulai. "Blocked" di sistem ini BUKAN kolom status — ia turunan dari
 * ledger (baris FAIL terakhir tanpa START susulan, lihat isUnitBlocked di
 * unitStageEngine). Jadi blokir di sini memakai failStage() yang SUDAH ADA,
 * bukan mekanisme baru. Konsekuensi yang bagus: jam blok otomatis terhitung
 * dari selisih FAIL → START berikutnya, tanpa kolom jam tambahan, dan
 * terpisah rapi dari hold customer (D-007).
 */
export async function proposeScopeRevision(unitId, {
  actorId, reason, deltaAmount = 0, toServiceId = null, stageId = null, photoUrls = [], note,
} = {}) {
  if (!reason?.trim()) throw new ScopeRevisionError("Alasan revisi wajib diisi");
  const delta = Math.trunc(Number(deltaAmount));
  if (!Number.isFinite(delta)) throw new ScopeRevisionError("deltaAmount harus angka Rupiah bulat");

  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { service: true, currentStage: true },
  });
  if (!unit) throw new ScopeRevisionError("Unit tidak ditemukan", 404);

  // Satu revisi PENDING per unit. Dua tawaran harga berbeda menggantung
  // bersamaan untuk satu kasur adalah cara paling cepat menagih angka yang
  // salah — dan customer tidak bisa menjawab dua-duanya sekaligus.
  const menggantung = await prisma.scopeRevision.findFirst({
    where: { unitId, status: "PENDING" },
  });
  if (menggantung) {
    throw new ScopeRevisionError(
      "Unit ini masih punya revisi yang menunggu jawaban customer. Selesaikan dulu yang itu.", 409);
  }

  let toService = null;
  if (toServiceId) {
    toService = await prisma.serviceCatalog.findUnique({ where: { id: toServiceId } });
    if (!toService) throw new ScopeRevisionError("Layanan tujuan tidak ditemukan", 404);
  }

  const blokir = harusMemblokir({
    deltaAmount: delta,
    fromServiceLine: unit.service?.serviceLine,
    toServiceLine: toService?.serviceLine,
  });

  const revision = await prisma.scopeRevision.create({
    data: {
      unitId,
      orderId: unit.orderId,
      stageId: stageId || unit.currentStageId || null,
      fromServiceId: unit.serviceId || null,
      toServiceId: toService?.id || null,
      reason: reason.trim(),
      deltaAmount: delta,
      photoUrls,
      createdById: actorId || null,
    },
  });

  // Blokir DI LUAR transaksi pembuatan revisi, dan kegagalannya TIDAK
  // membatalkan revisi: failStage menuntut ada tahap yang sedang BERJALAN
  // (baris START terbuka). Kalau revisi diajukan saat tidak ada tahap
  // berjalan — mis. unit baru diterima dan belum ada yang menekan Mulai —
  // revisinya tetap sah dan tetap menunggu jawaban customer. Yang jujur
  // adalah melaporkan blokirnya tidak terpasang, bukan menolak revisinya.
  let blocked = false;
  let blockError = null;
  if (blokir && unit.currentStageId) {
    try {
      await failStage(unitId, unit.currentStageId, {
        actorId,
        blockReason: "AWAITING_CUSTOMER_APPROVAL",
        note: note || `Revisi scope: ${reason.trim()}`,
      });
      blocked = true;
    } catch (err) {
      blockError = err.message;
    }
  }

  return { revision, blocked, blockRequired: blokir, blockError };
}

/**
 * Rekam hasil dari customer (FR-R-04) dan terapkan akibatnya (FR-R-05).
 *
 * DISETUJUI / SEBAGIAN:
 *   - delta harga jadi OrderItem BARU, lalu Order.value dihitung ulang dari
 *     SUM(items). TIDAK PERNAH menulis Order.value langsung — itu sumber bug
 *     yang sudah tercatat (D-012).
 *   - layanan unit berpindah ke toService → modul kerja yang dilalui unit
 *     ikut berubah, karena routing diturunkan dari serviceId (D-003).
 *
 * DITOLAK: unit KEMBALI ke layanan awal dan produksi lanjut dengan spek yang
 *   dijual sales (keputusan Gilang 2 Agustus 2026). Tidak ada perubahan harga.
 *   Penolakannya sengaja disimpan permanen — hasilnya mungkin tidak optimal
 *   (mis. fondasi tetap lemah), dan itu catatan liability, sejalan dengan
 *   D-009 untuk override customer di Uji Berat Badan.
 *
 * Membuka blokir TIDAK dilakukan di sini dengan sengaja: produksi sendiri
 * yang menekan Mulai lagi (startStage). Kalau fungsi ini yang memulai tahap,
 * kolom "siapa yang mengerjakan" di unit_stage_logs berhenti bisa dipercaya —
 * alasan yang sama kenapa ADMIN tidak diberi UNIT_STAGE_WRITE.
 */
export async function decideScopeRevision(revisionId, {
  actorId, status, decidedVia, evidenceUrl, decisionNote, finalDeltaAmount,
} = {}) {
  const SAH = ["APPROVED", "REJECTED", "PARTIAL"];
  if (!SAH.includes(status)) {
    throw new ScopeRevisionError(`status harus salah satu dari: ${SAH.join(", ")}`);
  }

  return prisma.$transaction(async (tx) => {
    const rev = await tx.scopeRevision.findUnique({
      where: { id: revisionId },
      include: { unit: true, toService: true },
    });
    if (!rev) throw new ScopeRevisionError("Revisi tidak ditemukan", 404);

    // Memutuskan ulang DITOLAK. Ini pengganti disiplin append-only untuk
    // tabel ini: barisnya boleh berubah SEKALI, dari PENDING ke hasil akhir.
    if (rev.status !== "PENDING") {
      throw new ScopeRevisionError(
        `Revisi ini sudah diputuskan (${rev.status}) dan tidak bisa diubah lagi. ` +
        "Kalau ada negosiasi lanjutan, ajukan revisi baru.", 409);
    }

    const setuju = status === "APPROVED" || status === "PARTIAL";

    // PARTIAL boleh membawa angka akhir yang berbeda dari usulan — itu
    // gunanya "sebagian". APPROVED memakai delta usulan apa adanya.
    const delta = status === "PARTIAL" && finalDeltaAmount !== undefined
      ? Math.trunc(Number(finalDeltaAmount))
      : rev.deltaAmount;
    if (!Number.isFinite(delta)) throw new ScopeRevisionError("finalDeltaAmount harus angka Rupiah bulat");

    let orderItemId = null;

    if (setuju && delta !== 0) {
      const label = rev.toService?.labelId || "Revisi scope";
      const item = await tx.orderItem.create({
        data: {
          orderId: rev.orderId,
          layananName: `[Revisi] ${label}`,
          harga: delta,
          sortOrder: 999, // selalu di bawah item asli, supaya urutan penawaran awal tetap terbaca
        },
      });
      orderItemId = item.id;

      // Order.value = SUM(items) — sama persis dengan syncOrderValue() di
      // routes/orders.js, tapi harus di dalam transaksi yang sama supaya
      // OrderItem dan value tidak pernah sempat berbeda.
      const agg = await tx.orderItem.aggregate({
        where: { orderId: rev.orderId }, _sum: { harga: true },
      });
      await tx.order.update({
        where: { id: rev.orderId }, data: { value: agg._sum.harga || 0 },
      });
    }

    if (setuju && rev.toServiceId) {
      await tx.unit.update({ where: { id: rev.unitId }, data: { serviceId: rev.toServiceId } });
    }
    // DITOLAK: serviceId TIDAK disentuh — unit memang masih memakai layanan
    // awal (revisi belum pernah menerapkannya). Tidak ada yang perlu
    // dikembalikan; yang penting penolakannya terekam di baris ini.

    const updated = await tx.scopeRevision.update({
      where: { id: revisionId },
      data: {
        status,
        decidedById: actorId || null,
        decidedAt: new Date(),
        decidedVia: decidedVia || null,
        evidenceUrl: evidenceUrl || null,
        decisionNote: decisionNote || null,
        ...(status === "PARTIAL" && finalDeltaAmount !== undefined && { deltaAmount: delta }),
        ...(orderItemId && { orderItemId }),
      },
      include: { unit: true, fromService: true, toService: true },
    });

    return { revision: updated, orderItemId, appliedDelta: setuju ? delta : 0 };
  }).then(async (hasil) => {
    // Agregat customer di luar transaksi: gagalnya sinkronisasi angka
    // ringkasan tidak boleh membatalkan keputusan yang sudah direkam.
    const order = await prisma.order.findUnique({
      where: { id: hasil.revision.orderId }, select: { customerId: true },
    });
    if (order) await syncCustomerOrderAggregate(order.customerId).catch(() => {});
    return hasil;
  });
}

/** Ringkasan untuk dikirim CS ke customer (FR-R-03): foto + sebelum/sesudah + delta. */
export async function buildCustomerSummary(revisionId) {
  const rev = await prisma.scopeRevision.findUnique({
    where: { id: revisionId },
    include: {
      fromService: true,
      toService: true,
      unit: { select: { unitCode: true, merk: true, ukuran: true } },
      order: { select: { orderNumber: true, value: true } },
    },
  });
  if (!rev) throw new ScopeRevisionError("Revisi tidak ditemukan", 404);

  return {
    revisionId: rev.id,
    orderNumber: rev.order?.orderNumber,
    unitCode: rev.unit?.unitCode,
    kasur: [rev.unit?.merk, rev.unit?.ukuran].filter(Boolean).join(" · ") || null,
    temuan: rev.reason,
    layananSebelum: rev.fromService?.labelId || null,
    layananSesudah: rev.toService?.labelId || null,
    selisihHarga: rev.deltaAmount,
    totalSekarang: rev.order?.value ?? null,
    totalSetelahRevisi: (rev.order?.value ?? 0) + rev.deltaAmount,
    foto: rev.photoUrls,
    status: rev.status,
  };
}
