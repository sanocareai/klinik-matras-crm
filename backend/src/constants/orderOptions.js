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

export const UKURAN_KASUR = [
  "90x200 cm (Single)",
  "120x200 cm (Single Besar)",
  "160x200 cm (Queen)",
  "180x200 cm (King)",
  "200x200 cm (King Besar)",
  "Ukuran Custom",
];
