// Logika murni layar Penjualan Karyawan (Finance). Angka resmi (total, terbayar, sisa, status) SELALU dari server — fungsi di sini hanya untuk PRATINJAU
// total saat mengetik di form dan menentukan kolom mana yang tampil, supaya mudah dites tanpa DOM.

export const LABEL_METODE_PJK = { TRANSFER: "Transfer ke rekening", TUNAI: "Tunai (disetor ke rekening)", POTONG_GAJI: "Potong gaji" };

export const JUMLAH_MAKS = 1000;

/**
 * Jumlah item boleh PECAHAN (mis. 1,6 meter/kg) — maksimal 3 angka di belakang koma. Pengguna boleh mengetik koma Indonesia ("1,6") atau titik ("1.6"); server hanya menerima TITIK,
 * jadi fungsi ini menormalkan ke string berpola 123 / 123.456. Mengembalikan null bila tidak sah (kosong, huruf, pemisah ribuan "1.600,5", >3 desimal, 0, negatif, >1000).
 */
export function normalisasiJumlah(teks) {
  const t = String(teks ?? "").trim();
  if (!/^\d{1,4}([.,]\d{1,3})?$/.test(t)) return null;
  const n = t.replace(",", ".");
  const angka = Number(n);
  return angka > 0 && angka <= JUMLAH_MAKS ? n : null;
}

/** Subtotal SATU baris dalam SEN, pembulatan HALF_UP — aritmetika bilangan bulat (tanpa float) dan SAMA dengan aturan server (subtotalItem). */
export function subtotalSen(jumlah, harga) {
  const q = normalisasiJumlah(jumlah), h = Number(harga);
  if (q === null || !Number.isFinite(h) || h <= 0) return 0;
  const perseribu = Math.round(Number(q) * 1000); // jumlah dalam seperseribu (≤ 3 desimal, jadi eksak)
  const sen = Math.round(h * 100);
  return Math.floor((perseribu * sen + 500) / 1000);
}

/** Pratinjau total form = Σ subtotal (dibulatkan per baris) baris yang valid. Server menghitung ulang sendiri dan tidak pernah menerima total dari klien. */
export function totalItems(items) {
  return (items || []).reduce((acc, i) => acc + subtotalSen(i.quantity, i.unitPrice), 0) / 100;
}

/** Tunai/transfer memakai rekening perusahaan; potong gaji tidak menyentuh kas. */
export const metodeButuhRekening = (method) => method !== "POTONG_GAJI";
