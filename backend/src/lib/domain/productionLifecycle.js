// Fase 5 — status siklus produksi yang SAMA untuk Meja, Corner, Dokumentasi, Unit 360, Status Produksi, dan laporan. MURNI.
// Satu fungsi, satu kosakata: tidak ada layar yang menurunkan status sendiri. Corner "tidak berlaku" dinyatakan apa adanya (bukan "selesai", bukan "menunggu").

export const LIFECYCLE_LABEL = Object.freeze({
  DIBATALKAN: "Dibatalkan",
  TERKIRIM: "Sudah dikirim",
  DALAM_PENGIRIMAN: "Dalam pengiriman",
  SIAP_KIRIM: "Siap Kirim",
  MENUNGGU_GUDANG: "Menunggu Gudang menerima barang jadi",
  MENUNGGU_QC: "Menunggu putusan QC",
  REWORK: "Rework setelah QC gagal",
  MENUNGGU_CORNER: "Menunggu dikerjakan Corner",
  DI_CORNER: "Sedang di Corner",
  SIAP_DISELESAIKAN: "Siap diselesaikan",
  DI_MEJA: "Dikerjakan di Meja",
  BELUM_MULAI: "Belum mulai",
});

/**
 * input: { runStatus, currentPhase, unitStatus, next ({action, wait, stepNo}), latestQcResult, cornerStatus (hasil cornerStatusOf), adaptation, handoffStatus, started }
 * Mengembalikan { key, label, detail, cornerNotApplicable, cornerReason }.
 */
export function lifecycleStatusOf({ runStatus, currentPhase, unitStatus, next = null, latestQcResult = null, cornerStatus = null, adaptation = false, handoffStatus = null, started = true } = {}) {
  const base = (key, detail = null) => ({
    key, label: LIFECYCLE_LABEL[key], detail,
    cornerNotApplicable: cornerStatus?.status === "TIDAK_BERLAKU", cornerReason: cornerStatus?.status === "TIDAK_BERLAKU" ? cornerStatus.reason : null,
  });
  if (runStatus === "CANCELLED" || unitStatus === "CANCELLED") return base("DIBATALKAN");
  if (unitStatus === "DELIVERED") return base("TERKIRIM");
  if (unitStatus === "IN_TRANSIT_OUT") return base("DALAM_PENGIRIMAN");
  if (unitStatus === "READY_FOR_DELIVERY" || unitStatus === "READY_ON_CUSTOMER_HOLD") return base("SIAP_KIRIM", adaptation ? "Diselesaikan dengan mode adaptasi (tanpa penerimaan barang jadi Gudang)" : null);
  if (currentPhase === "HANDOFF" || handoffStatus === "OFFERED") return base("MENUNGGU_GUDANG", "Barang jadi sudah ditawarkan ke Gudang; Siap Kirim setelah Gudang menerima dan retur sisa bahan selesai");
  if (!started) return base("BELUM_MULAI");
  if (next?.wait === "AWAITING_QC") return base("MENUNGGU_QC");
  if (latestQcResult === "FAIL_REWORK" && currentPhase === "PROCESS" && (next?.stepNo == null || next.stepNo < 9)) return base("REWORK");
  if (cornerStatus?.applies) {
    if (["DIKERJAKAN", "JAHIT_SELESAI"].includes(cornerStatus.status)) return base("DI_CORNER", cornerStatus.label);
    if (cornerStatus.status === "MENUNGGU_CORNER" && next?.stepNo >= 9) return base("MENUNGGU_CORNER");
  }
  if (next?.action === "FINISH" && cornerStatus?.status === "TIDAK_BERLAKU") return base("SIAP_DISELESAIKAN", "Corner tidak berlaku — PIC Meja menyelesaikan");
  if (next?.wait === "READY_TO_FINISH") return base("SIAP_DISELESAIKAN", "Tahap kerja selesai");
  return base("DI_MEJA");
}
