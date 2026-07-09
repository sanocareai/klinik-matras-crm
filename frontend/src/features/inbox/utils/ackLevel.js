// Level status kirim pesan (WhatsApp-style): belum terkirim → terkirim →
// sampai ke device → dibaca. Backend belum punya field ini di Message
// (lihat CLAUDE.md) — konstanta ini disiapkan untuk Fase B saat field
// tersedia, supaya UI (ChatWindow ticks) tinggal pakai tanpa refactor.
export const ACK = {
  PENDING: 0,   // sedang dikirim dari CRM (optimistic, belum dapat balasan server)
  SENT: 1,      // sudah sampai di server WAHA (centang 1 abu-abu)
  DELIVERED: 2, // sudah sampai di HP pelanggan (centang 2 abu-abu)
  READ: 3,      // sudah dibaca pelanggan (centang 2 biru)
};

// ackToTicks(ack) → 'none' | 'single' | 'double' | 'blue'
export function ackToTicks(ack) {
  switch (ack) {
    case ACK.SENT:      return "single";
    case ACK.DELIVERED: return "double";
    case ACK.READ:      return "blue";
    default:             return "none";
  }
}
