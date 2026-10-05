// Status "belum dibalas" sebuah percakapan — SATU definisi dipakai server & dites sendiri.
//
// Definisi (sama dengan GET /conversations di routes/conversations.js dan tab "Belum Dibalas" di aplikasi/web): percakapan BELUM DIBALAS bila
// pesan TERAKHIR-nya berarah INBOUND (dari pelanggan). Begitu ada pesan OUTBOUND setelahnya — dari CRM maupun diketik dari WhatsApp di HP —
// percakapan itu sudah dibalas.

/**
 * @param {{direction: string, createdAt: Date|string}|null|undefined} pesanTerakhir
 * @param {number} [sekarang] ms epoch (untuk tes)
 * @returns {{isUnanswered: boolean, unansweredMinutes: number|null}}
 */
export function statusBelumDibalas(pesanTerakhir, sekarang = Date.now()) {
  const belum = pesanTerakhir?.direction === "INBOUND";
  return {
    isUnanswered: belum,
    unansweredMinutes: belum ? Math.max(0, Math.floor((sekarang - new Date(pesanTerakhir.createdAt).getTime()) / 60000)) : null,
  };
}
