// SARINGAN DAFTAR PEMBAYARAN sisi-layar — fungsi MURNI (tanpa React) supaya perilakunya bisa dibuktikan SAMA dengan versi server yang dipakai Export Excel
// (backend/src/services/finance/saringPembayaran.js). Tes paritas: backend/tests/saringPembayaranParitas.test.js mengimpor berkas ini langsung dan membandingkan hasilnya.
// Periode & tab (status) disaring di SERVER lebih dulu; fungsi ini menyaring pencarian + chip: cara bayar, status, dibagi ke order lain, foto bukti, (rekening).

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
