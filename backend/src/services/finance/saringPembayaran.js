// SARINGAN DAFTAR PEMBAYARAN sisi-server untuk Export Excel — SALINAN LOGIKA saringan layar (frontend/src/features/finance/saringPembayaran.js). Dibuktikan IDENTIK oleh
// backend/tests/saringPembayaranParitas.test.js (mengimpor berkas layar & membandingkan hasil pada banyak kombinasi filter). Ubah satu → ubah keduanya; tes akan gagal bila berbeda.

/** Pencarian: semua kata di `q` harus muncul di gabungan `bidang`. */
export function cocok(q, ...bidang) {
  const kata = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return true;
  const gudang = bidang.filter((x) => x !== null && x !== undefined).join(" ").toLowerCase();
  return kata.every((k) => gudang.includes(k));
}

/** "150.000" harus cocok dengan nominal 150000: titik pemisah ribuan dibuang dari kata yang murni angka. */
export const normalisasiCari = (q) => String(q || "").split(/\s+/).map((k) => (/^[\d.]+$/.test(k) ? k.replace(/\./g, "") : k)).join(" ");

const sudahVerifikasi = (p) => (p.terverifikasi !== undefined ? !!p.terverifikasi : Array.isArray(p.verifications) && p.verifications.length > 0);

export function saringPembayaran(payments, { q = "", metode = "", verif = "", alokasi = "", bukti = "", rekening = "" } = {}) {
  const qNorm = normalisasiCari(q);
  return (payments || []).filter((p) => {
    const v = sudahVerifikasi(p);
    if (metode && p.method !== metode) return false;
    if (verif === "terverifikasi" && !(v && !p.cancelledAt)) return false;
    if (verif === "belum" && (v || p.cancelledAt)) return false;
    if (verif === "dibatalkan" && !p.cancelledAt) return false;
    const adaAlokasi = (p.finAllocations || []).length > 0;
    if (alokasi === "ada" && !adaAlokasi) return false;
    if (alokasi === "tanpa" && adaAlokasi) return false;
    if (bukti === "ada" && !p.proofPhotoUrl) return false;
    if (bukti === "tanpa" && p.proofPhotoUrl) return false;
    if (rekening && (p.cashAccount?.id ?? p.cashAccountId ?? null) !== rekening) return false;
    return cocok(qNorm, p.order?.orderNumber, p.order?.customer?.name, p.recordedBy?.name, p.method, p.amount, p.notes);
  });
}
