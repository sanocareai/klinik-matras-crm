// Menyusun spesifikasi Excel ORDER BERWARNA dari baris export yang sudah ada (sheet "Order" & "Rincian Layanan" di pages/Orders.jsx).
// Hasilnya dikirim ke POST /api/orders/export-xlsx yang merendernya (backend/src/services/orderExcel.js). Murni (tanpa DOM/React) supaya bisa dites.
//
// Label & warna TIDAK didefinisikan di sini: Orders.jsx menyuplai `palettes` dari konstanta yang sama dengan layar (utils/format.js), jadi
// warna di Excel tidak pernah berbeda dari yang dilihat sales di aplikasi. Yang ada di sini hanya aturan tampilan per kolom (tipe, lebar, penanda).

const KUNING = { bg: "#fef3c7", color: "#92400e" };
const MERAH_PEKAT = { bg: "#dc2626", color: "#ffffff" };
const HIJAU = { bg: "#dcfce7", color: "#166534" };
const MERAH_MUDA = { bg: "#fee2e2", color: "#991b1b" };

// Lini produk & jenis item katalog: tidak punya warna di layar, jadi dipilih yang netral & mudah dibedakan.
export const PALETTE_LINI = {
  Kasur: { bg: "#e0f2fe", color: "#075985" },
  Sofa: { bg: "#fce7f3", color: "#9d174d" },
  Divan: { bg: "#ffedd5", color: "#9a3412" },
};
export const PALETTE_JENIS_ITEM = {
  Layanan: { bg: "#ede9fe", color: "#5b21b6" },
  Tambahan: { bg: "#cffafe", color: "#155e75" },
  Produk: { bg: "#dcfce7", color: "#166534" },
  Sewa: { bg: "#dbeafe", color: "#1e40af" },
  Biaya: { bg: "#f1f5f9", color: "#475569" },
};

/** { ENUM: "Label" } + { ENUM: { bg|background, color } } → { "Label": { bg, color } } */
export function paletteDari(labels, badges) {
  const hasil = {};
  for (const [kunci, label] of Object.entries(labels || {})) {
    const b = badges?.[kunci];
    if (!b) continue;
    hasil[label] = { bg: b.bg || b.background, color: b.color };
  }
  return hasil;
}

// Aturan tampilan per kolom, dikunci dengan JUDUL kolom (sama dengan header di file). Kolom yang belum terdaftar tampil sebagai teks biasa.
const ATURAN_ORDER = {
  "ID Order": { lebar: 20 },
  Pelanggan: { lebar: 24 },
  "No HP": { lebar: 16 },
  "Ukuran/Konfigurasi": { lebar: 28, wrap: true },
  Layanan: { lebar: 38, wrap: true },
  "No Komplain": { tandaKomplain: true, lebar: 16 },
  "Keluhan Komplain": { tandaKomplain: true, wrap: true, lebar: 42 },
  "Hari di Status": { tipe: "angka", tandaMandek: true, lebar: 10 },
  "Perkiraan?": { lebar: 11 },
  "Tanggal Lunas": { tipe: "tanggal", lebar: 13 },
  Nilai: { tipe: "uang", total: true, lebar: 16 },
  Ongkir: { tipe: "uang", total: true, lebar: 14 },
  "Ongkir Klaim Garansi": { tipe: "uang", total: true, lebar: 14 },
  "Kategori Keluhan": { wrap: true, lebar: 28 },
  "Keluhan/Catatan": { wrap: true, lebar: 42 },
  "Alamat Pengiriman": { wrap: true, lebar: 42 },
  "Tanggal Pick Up Pasti": { tipe: "tanggal", lebar: 14 },
  "Tanggal Kirim Pasti": { tipe: "tanggal", lebar: 14 },
  "Tgl Pickup Komplain": { tipe: "tanggal", tandaKomplain: true, lebar: 14 },
  "Tgl Kirim Komplain": { tipe: "tanggal", tandaKomplain: true, lebar: 14 },
  "Link Lokasi": { tipe: "link", lebar: 12 },
  Dibuat: { tipe: "tanggal", lebar: 12 },
};
const ATURAN_LAYANAN = {
  "ID Order": { lebar: 20 },
  Pelanggan: { lebar: 24 },
  Layanan: { lebar: 40, wrap: true },
  "Harga Normal": { tipe: "uang", lebar: 15 },
  "Harga Standard": { tipe: "uang", lebar: 15 },
  "Harga Final": { tipe: "uang", total: true, lebar: 15 },
  "Selisih ke Standard": { tipe: "uang", lebar: 16 },
  "Tanggal Order": { tipe: "tanggal", lebar: 13 },
};

function susunKolom(contoh, aturan, palettePerKolom) {
  return Object.keys(contoh || {}).map((judul) => {
    const a = aturan[judul] || {};
    const pal = palettePerKolom[judul];
    return { key: judul, header: judul, tipe: a.tipe || "teks", ...(a.lebar ? { lebar: a.lebar } : {}), ...(a.wrap ? { wrap: true } : {}),
      ...(a.total ? { total: true } : {}), ...(a.tandaKomplain ? { tandaKomplain: true } : {}), ...(a.tandaMandek ? { tandaMandek: true } : {}), ...(pal ? { palette: pal } : {}) };
  });
}

/**
 * @param {object} p
 * @param {Array<object>} p.sheetOrder      baris sheet "Order" (kunci = judul kolom)
 * @param {Array<object>} p.sheetLayanan    baris sheet "Rincian Layanan"
 * @param {Array<string[]>} p.bendera       per baris sheetOrder: ["komplain"?, "mandek"?]
 * @param {Array<string[]>} p.benderaLayanan per baris sheetLayanan (bendera order induknya)
 * @param {{kategori,status,pembayaran}} p.palettes  { "Label": {bg,color} } dari layar (lihat paletteDari)
 */
export function buatSpecExcelOrder({ sheetOrder, sheetLayanan = [], bendera = [], benderaLayanan = [], palettes = {}, filterLabel = "", pengekspor = "" }) {
  const palOrder = {
    Kategori: palettes.kategori,
    "Lini Produk": PALETTE_LINI,
    Status: palettes.status,
    "Jenis Pekerjaan": { "KOMPLAIN / REVISI": MERAH_PEKAT, "Order Baru": { bg: "#f1f5f9", color: "#475569" } },
    Mandek: { Ya: KUNING },
    Pembayaran: palettes.pembayaran,
    "Sudah Lunas?": { Ya: HIJAU, Tidak: MERAH_MUDA },
    Komplain: { Ya: MERAH_PEKAT },
  };
  const palLayanan = {
    "Kategori Produk": PALETTE_LINI,
    "Kategori Layanan": PALETTE_JENIS_ITEM,
    "Status Nego": { "Di bawah standard": MERAH_MUDA, "Dalam batas": HIJAU },
  };
  const ubahKeBaris = (data, kolom) => data.map((r) => kolom.map((k) => r[k.key] ?? ""));
  const kolomOrder = susunKolom(sheetOrder[0], ATURAN_ORDER, palOrder);
  const sheets = [{ nama: "Order", judul: "Daftar Order", kolom: kolomOrder, baris: ubahKeBaris(sheetOrder, kolomOrder), bendera }];
  if (sheetLayanan.length > 0) {
    const kolomLayanan = susunKolom(sheetLayanan[0], ATURAN_LAYANAN, palLayanan);
    sheets.push({ nama: "Rincian Layanan", judul: "Rincian per Item Layanan", kolom: kolomLayanan, baris: ubahKeBaris(sheetLayanan, kolomLayanan), bendera: benderaLayanan });
  }
  return {
    judul: "Laporan Order",
    filterLabel,
    pengekspor,
    sheets,
    ringkasan: {
      kunciNilai: "Nilai",
      kelompok: [
        { judul: "Kategori", kunci: "Kategori" },
        { judul: "Status", kunci: "Status" },
        { judul: "Pembayaran", kunci: "Pembayaran" },
        { judul: "Sales Person", kunci: "Sales Person" },
      ],
      kunciLunas: "Sudah Lunas?",
      nilaiLunas: "Ya",
    },
  };
}

/** Bendera tampilan untuk satu order: komplain aktif & mandek (fungsi penentunya disuplai pemanggil agar sama dengan layar). */
export function benderaOrder(order, { punyaKomplainAktif, isMandek }) {
  const b = [];
  if (punyaKomplainAktif(order)) b.push("komplain");
  if (isMandek(order)) b.push("mandek");
  return b;
}
