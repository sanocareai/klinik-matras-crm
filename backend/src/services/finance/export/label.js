// Label Bahasa Indonesia yang dipakai bersama modul export (sama dengan yang tampil di layar Finance).
export const LABEL_STATUS = Object.freeze({
  DRAFT: "Draf", MENUNGGU_APPROVAL: "Menunggu Persetujuan", DISETUJUI: "Disetujui", DIBAYAR: "Dibayar", DITOLAK: "Ditolak", DIBATALKAN: "Dibatalkan",
  DIBAYAR_SEBAGIAN: "Dibayar Sebagian", LUNAS: "Lunas", AKTIF: "Aktif", SEBAGIAN: "Sebagian", POSTED: "Diposting", REVERSED: "Dibalik",
  SELESAI: "Selesai", COCOK: "Cocok", DIABAIKAN: "Diabaikan",
});
export const labelStatus = (s) => (s == null ? "" : LABEL_STATUS[s] || String(s));

export const LABEL_CARA_BAYAR = Object.freeze({ TUNAI: "Tunai", CASH: "Tunai", TRANSFER: "Transfer", QRIS: "QRIS", CARD: "Kartu" });
export const labelCaraBayar = (m) => (m == null || m === "" ? "" : LABEL_CARA_BAYAR[String(m).toUpperCase()] || String(m));

export const LABEL_METODE_TRANSFER = Object.freeze({ SESAMA_BANK: "Sesama Bank", BI_FAST: "BI-FAST", TRANSFER_ONLINE: "Transfer Online", LAINNYA: "Lainnya" });
export const labelMetodeTransfer = (m) => (m == null || m === "" ? "" : LABEL_METODE_TRANSFER[m] || String(m));

/**
 * Keterangan jurnal balik berbentuk "Pembatalan JV-… — <alasan>" (journal.js). Alasan pembatalan/pembalikan diperlakukan sensitif:
 * pengekspor tanpa izin (bukan finance:admin) hanya mendapat "Pembatalan JV-…" — bagian sesudah " — " dibuang.
 */
export function keteranganTanpaAlasan(keterangan, bolehSensitif) {
  const t = keterangan == null ? "" : String(keterangan);
  if (bolehSensitif) return t;
  const m = /^(Pembatalan\s+\S+)\s+—\s/.exec(t);
  return m ? m[1] : t;
}
