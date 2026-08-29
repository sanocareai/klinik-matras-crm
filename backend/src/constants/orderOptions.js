// Master data pilihan form order — SATU sumber kebenaran dipakai frontend
// web DAN mobile lewat GET /api/master-data/order-options (lihat
// routes/masterData.js). Ubah/rename opsi di sini saja, tidak perlu
// duplikasi array di kedua platform.
export const JENIS_LAYANAN = [
  "Upgrade Lapisan Matras Sehat",
  "Upgrade Fondasi Matras Sehat",
  "Paket Upgrade Fondasi + Lapisan Matras Sehat",
  "Full Upgrade All In",
  "Full Service",
  "Ganti Kain",
  "Lainnya",
];

export const MERK_KASUR = [
  "Comforta", "Spring Air", "Dunlopillo", "Therapedic",
  "King Koil", "Sealy", "Serta", "Lady Americana",
  "Elite", "Florence", "Guhdo", "Sano", "Lainnya",
];

// ⚠️ URUTAN & TEKSNYA TERIKAT ke UKURAN_VARIANT_KEY di
// frontend/src/utils/format.js — label di sini dipetakan ke variantKey
// katalog harga ("90", "100", …) di sana. Kalau menambah/rename ukuran,
// UBAH KEDUANYA, kalau tidak layanan untuk ukuran itu tidak akan muncul
// harganya (fallback-nya diam: daftar layanan kosong, bukan error).
//
// "100x200 cm (Super Single)" DITAMBAHKAN 29 Agustus 2026 — daftar harga
// resmi punya SATU kolom penuh untuk ukuran 100 (harganya beda dari 90 di
// beberapa layanan), tapi ukuran itu tidak pernah ada di dropdown ini, jadi
// order kasur 100 selama ini terpaksa dicatat sebagai ukuran lain atau
// "Ukuran Custom".
export const UKURAN_KASUR = [
  "90x200 cm (Single)",
  "100x200 cm (Super Single)",
  "120x200 cm (Single Besar)",
  "160x200 cm (Queen)",
  "180x200 cm (King)",
  "200x200 cm (King Besar)",
  "Ukuran Custom",
];
