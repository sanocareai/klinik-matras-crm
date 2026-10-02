// Logika murni layar Penjualan Karyawan (Finance). Angka resmi (total, terbayar, sisa, status) SELALU dari server — fungsi di sini hanya untuk PRATINJAU
// total saat mengetik di form dan menentukan kolom mana yang tampil, supaya mudah dites tanpa DOM.

export const LABEL_METODE_PJK = { TRANSFER: "Transfer ke rekening", TUNAI: "Tunai (disetor ke rekening)", POTONG_GAJI: "Potong gaji" };

/** Pratinjau total form = Σ(jumlah × harga satuan) baris yang valid. Server menghitung ulang sendiri dan tidak pernah menerima total dari klien. */
export function totalItems(items) {
  return (items || []).reduce((acc, i) => {
    const q = Number(i.quantity), h = Number(i.unitPrice);
    return Number.isFinite(q) && Number.isFinite(h) && q > 0 && h > 0 ? acc + q * h : acc;
  }, 0);
}

/** Tunai/transfer memakai rekening perusahaan; potong gaji tidak menyentuh kas. */
export const metodeButuhRekening = (method) => method !== "POTONG_GAJI";
