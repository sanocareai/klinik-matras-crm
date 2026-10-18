// SALES MENGUBAH ORDER, PRODUKSI & GUDANG IKUT (keputusan Owner, 19 Okt 2026): perubahan status order dari workspace Sales (Batalkan, ubah status ke Siap Kirim/Terkirim) TIDAK lagi ditolak hanya karena unit
// order itu masih punya Production Run yang berjalan. Sebagai gantinya Produksi/Gudang DISELARASKAN otomatis di transaksi yang sama, dan setiap langkah tercatat (siapa, kapan, sebelum–sesudah):
//   • CANCEL    — Run yang masih berjalan dibatalkan (fase/operasi ditutup, penawaran barang jadi OFFERED dibatalkan); permintaan bahan yang BELUM diserahkan dibatalkan dan reservasinya dilepas;
//                 rencana dibatalkan bila tidak ada bahan yang sudah diserahkan. Bahan yang SUDAH diserahkan Gudang TIDAK dibalik otomatis (tidak ada pergerakan stok): dilaporkan di riwayat supaya Gudang
//                 mengembalikannya lewat Retur Bahan/Penyesuaian.
//   • READY / DELIVERED — Run TIDAK dibatalkan dan tidak dianggap selesai: diberi penanda "dilepas untuk pengiriman" (kind SALES_STATUS_CHANGE; bukan override Admin, bukan hasil pemeriksaan/QC). Pencatatan produksi
//                 tetap bisa ditutup administratif (Selesaikan Produksi / Konfirmasi Barang Jadi).
// Modul ini TIDAK menulis Unit/Run langsung: penulisan dilakukan fungsi milik service pemilik (custody/QC-handoff/planning/material-issue). Dipanggil SEBELUM status unit diubah oleh route Sales.
// Tidak bergantung pada flag writer V2/cohort: yang menentukan hanya ada-tidaknya Run non-terminal untuk unit order itu.
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { RUN_OWNED_STATUSES } from "./productionRunGuards.js";
import { batalkanRunKarenaOrderInTx } from "./productionQcHandoffCommandService.js";
import { batalkanIssueAktifKarenaOrderInTx } from "./productionMaterialIssueCommandService.js";
import { batalkanPlanKarenaOrderInTx } from "./productionPlanningCommandService.js";
import { tandaiRunDilepasKarenaDispatchInTx } from "./unitCustodyCommandService.js";

export const AKSI_SELARAS = Object.freeze({ CANCEL: "CANCEL", READY: "READY", DELIVERED: "DELIVERED" });

async function runBerjalanOrder(tx, orderId) {
  return tx.productionRun.findMany({
    where: { status: { in: [...RUN_OWNED_STATUSES] }, unit: { orderId } },
    select: { id: true, unitId: true, status: true, currentPhase: true, revision: true, unit: { select: { id: true, unitCode: true, status: true } } },
    orderBy: { id: "asc" },
  });
}

/**
 * @param {object} tx transaksi Prisma milik route Sales
 * @param {{orderId:string, aksi:"CANCEL"|"READY"|"DELIVERED", actorId?:string|null, alasan?:string|null, orderStatusSebelum?:string|null}} p
 * @returns ringkasan { runDibatalkan, runDilepas, peringatan[] } — kosong bila tidak ada Run berjalan (perilaku V1 identik).
 */
export async function selaraskanProduksiDenganOrderInTx(tx, { orderId, aksi, actorId = null, alasan = null, orderStatusSebelum = null }) {
  const ringkasan = { runDibatalkan: [], runDilepas: [], peringatan: [] };
  const runs = await runBerjalanOrder(tx, orderId);
  if (runs.length === 0) return ringkasan;
  const orderStatusSesudah = aksi === AKSI_SELARAS.CANCEL ? "CANCELLED" : aksi;
  const sebab = String(alasan ?? "").trim() || (aksi === AKSI_SELARAS.CANCEL ? "Order dibatalkan di Sales" : `Order diubah ke ${orderStatusSesudah} di Sales`);

  if (aksi === AKSI_SELARAS.CANCEL) {
    for (const run of runs) {
      const bahan = await batalkanIssueAktifKarenaOrderInTx(tx, { runId: run.id, actorId, reason: sebab });
      let plan = { planDibatalkan: false, reservasiDilepas: bahan.reservasiDilepas };
      if (bahan.sudahDiserahkan.length === 0) {
        const rencana = await tx.productionRunPlan.findMany({ where: { runId: run.id, status: { not: "CANCELLED" } }, select: { id: true } });
        for (const r of rencana) {
          const hasil = await batalkanPlanKarenaOrderInTx(tx, { planId: r.id, actorId, reason: sebab });
          if (hasil.dibatalkan) { plan.planDibatalkan = true; plan.reservasiDilepas += hasil.reservasiDilepas; }
        }
      }
      const rr = await batalkanRunKarenaOrderInTx(tx, { runId: run.id, actorId, reason: sebab });
      if (!rr.dibatalkan) continue;
      const bahanSudahDiserahkan = bahan.sudahDiserahkan.flatMap((i) => i.lines.map((l) => ({ issueNumber: i.issueNumber, code: l.code, name: l.name, unit: l.unit, qty: l.qty })));
      const meta = {
        aksi, unitCode: run.unit.unitCode, runId: run.id, runStatusBefore: rr.statusSebelum, runPhase: rr.fase, runRevisionBefore: rr.revisiSebelum, runRevisionAfter: rr.revision,
        unitStatusBefore: run.unit.status, orderStatusBefore: orderStatusSebelum, orderStatusAfter: orderStatusSesudah, reason: sebab,
        planDibatalkan: plan.planDibatalkan, reservasiDilepas: plan.reservasiDilepas, issueDibatalkan: bahan.dibatalkan, bahanSudahDiserahkan,
      };
      await recordActivity(tx, { entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_FOLLOWS_ORDER, actorId: actorId || null, metadata: meta });
      await recordActivity(tx, { entityType: "order", entityId: orderId, eventType: EVENT_TYPES.PRODUCTION_FOLLOWS_ORDER, actorId: actorId || null, metadata: meta });
      ringkasan.runDibatalkan.push({ runId: run.id, unitCode: run.unit.unitCode });
      for (const b of bahanSudahDiserahkan) ringkasan.peringatan.push(`Bahan ${b.code} ${b.qty} ${b.unit ?? ""} (permintaan ${b.issueNumber}) sudah diserahkan Gudang untuk ${run.unit.unitCode}: kembalikan lewat Retur Bahan/Penyesuaian`.replace(/\s+/g, " "));
    }
    return ringkasan;
  }

  // READY / DELIVERED: Run tetap berjalan, diberi penanda dilepas (SEBELUM status unit berubah).
  const dilepas = await tandaiRunDilepasKarenaDispatchInTx(tx, {
    unitIds: runs.map((r) => r.unitId), actorId, via: `ORDER_${aksi}`, kind: "SALES_STATUS_CHANGE", alasan: sebab, catatAktivitas: false,
  });
  for (const d of dilepas) {
    const meta = { aksi, unitCode: d.unitCode, runId: d.runId, runStatusBefore: d.runStatus, runPhase: d.runPhase, unitStatusBefore: d.unitStatusBefore, orderStatusBefore: orderStatusSebelum, orderStatusAfter: orderStatusSesudah, reason: sebab };
    await recordActivity(tx, { entityType: "unit", entityId: d.unitId, eventType: EVENT_TYPES.PRODUCTION_FOLLOWS_ORDER, actorId: actorId || null, metadata: meta });
    await recordActivity(tx, { entityType: "order", entityId: orderId, eventType: EVENT_TYPES.PRODUCTION_FOLLOWS_ORDER, actorId: actorId || null, metadata: meta });
    ringkasan.runDilepas.push({ runId: d.runId, unitCode: d.unitCode });
  }
  return ringkasan;
}
