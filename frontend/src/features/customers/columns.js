// Kolom tabel Pelanggan (Fase 2 halaman Pelanggan, 31 Okt 2026).
// Tampilan awal hanya enam hal yang paling sering dipakai sales: Pelanggan (nama + nomor), Pipeline, Sales, Kota,
// Order, Nilai Order (+ kolom checkbox dan Aksi). Kolom lain TIDAK dihapus — dapat dinyalakan lewat menu "Kolom"
// (preferensi tampilan per perangkat, disimpan di localStorage seperti urutan menu/tab) dan tetap ada di profil
// pelanggan. Ekspor Excel tidak terpengaruh: selalu memuat SEMUA kolom, urutannya tidak berubah.
// Murni (tanpa JSX) supaya bisa diuji lewat `node --test`.

// Urutan di sini = urutan tampil kolom tambahan (urutan relatif sama dengan tabel lama).
export const KOLOM_TAMBAHAN = [
  { key: "idOrder", label: "ID Order" },
  { key: "statusOrder", label: "Status Order" },
  { key: "keluhan", label: "Keluhan" },
  { key: "kesehatan", label: "Kesehatan" },
  { key: "tags", label: "Tags" },
  { key: "tipe", label: "Tipe" },
  { key: "sumber", label: "Sumber" },
];

const KUNCI_VALID = new Set(KOLOM_TAMBAHAN.map((k) => k.key));
export const STORAGE_KEY = "pelanggan-kolom:v1";

/** Saring daftar tersimpan: hanya kunci yang dikenal, tanpa duplikat. Apa pun yang rusak → kosong (tampilan standar). */
export function bersihkanKolom(nilai) {
  if (!Array.isArray(nilai)) return [];
  const set = new Set(nilai);
  return KOLOM_TAMBAHAN.map((k) => k.key).filter((k) => set.has(k));
}

export function muatKolom(storage) {
  try {
    const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!s) return [];
    return bersihkanKolom(JSON.parse(s.getItem(STORAGE_KEY)));
  } catch {
    return [];
  }
}

export function simpanKolom(kunci, storage) {
  try {
    const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (s) s.setItem(STORAGE_KEY, JSON.stringify(bersihkanKolom(kunci)));
  } catch { /* mode privat / penuh: preferensi tidak tersimpan, tampilan tetap bekerja */ }
}

/** Nyalakan/matikan satu kolom tambahan; hasil selalu dalam urutan KOLOM_TAMBAHAN. */
export function toggleKolom(aktif, key) {
  const set = new Set(bersihkanKolom(aktif));
  if (!KUNCI_VALID.has(key)) return [...set];
  if (set.has(key)) set.delete(key); else set.add(key);
  return KOLOM_TAMBAHAN.map((k) => k.key).filter((k) => set.has(k));
}

// Lebar kolom (px) pada tabel `fixed`. `null` = kolom fleksibel (Pelanggan) yang mengambil sisa ruang.
export const LEBAR_KOLOM = {
  pilih: 44, pelanggan: null, pipeline: 164, sales: 148, kota: 100, order: 60, nilai: 128, aksi: 112,
  idOrder: 150, statusOrder: 150, keluhan: 210, kesehatan: 116, tags: 200, tipe: 116, sumber: 200,
};
export const LEBAR_MIN_PELANGGAN = 200;

/** Daftar kunci kolom yang tampil, berurutan: pilih, pelanggan, pipeline, sales, kota, order, nilai, [tambahan…], aksi. */
export function kolomTampil(tambahan) {
  const ekstra = KOLOM_TAMBAHAN.map((k) => k.key).filter((k) => bersihkanKolom(tambahan).includes(k));
  return ["pilih", "pelanggan", "pipeline", "sales", "kota", "order", "nilai", ...ekstra, "aksi"];
}

/** Lebar minimum tabel = jumlah lebar kolom tetap + lebar minimum kolom Pelanggan (di bawahnya tabel scroll, halaman tidak). */
export function lebarMinTabel(kunci) {
  return kunci.reduce((n, k) => n + (LEBAR_KOLOM[k] ?? LEBAR_MIN_PELANGGAN), 0);
}
