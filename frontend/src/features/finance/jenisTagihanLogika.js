// Logika murni Jenis Tagihan Supplier (B3.3) — dipakai JenisTagihan.jsx dan dites langsung (tests/jenisTagihan.test.js).

export const JENIS_TAGIHAN = [
  { kode: "BAHAN_BAKU", label: "Bahan Baku / Stok", ket: "Kain, busa, per, dan bahan lain yang disimpan sebagai stok — masuk Persediaan Bahan Baku (1-1400), bukan beban." },
  { kode: "JASA_OPERASIONAL", label: "Jasa / Operasional", ket: "Jasa, sewa, perlengkapan, dan biaya operasional kantor — masuk akun beban operasional." },
  { kode: "BIAYA_PRODUKSI_NON_STOK", label: "Biaya Produksi Non-Stok", ket: "Maklon, perawatan mesin, overhead produksi yang bukan bahan stok — masuk beban pokok produksi." },
  { kode: "MESIN_PERALATAN", label: "Mesin / Peralatan", ket: "Pembelian mesin, peralatan, atau kendaraan — dicatat sebagai aset tetap." },
  { kode: "UANG_MUKA_PEMBELIAN", label: "Uang Muka Pembelian", ket: "DP ke supplier sebelum barang diterima — dicatat sebagai aset Uang Muka Pembelian (1-1500)." },
];
const BAHAN = "BAHAN_BAKU_MANUAL";

export function opsiKategori(jenis, { kategori = [], kategoriBeli = [] }) {
  if (jenis === "JASA_OPERASIONAL") return kategori.filter((k) => k.account?.type === "BEBAN" && k.code !== BAHAN);
  if (jenis === "BIAYA_PRODUKSI_NON_STOK") return kategori.filter((k) => k.account?.type === "BEBAN_POKOK" && k.code !== BAHAN);
  if (jenis === "MESIN_PERALATAN") return kategoriBeli.filter((k) => ["ASET_PERALATAN", "ASET_KENDARAAN"].includes(k.code));
  if (jenis === "UANG_MUKA_PEMBELIAN") return kategoriBeli.filter((k) => k.code === "UANG_MUKA_PEMBELIAN");
  return [];
}

/** Isian body API untuk jenis terpilih (yang tidak relevan dikosongkan agar server tidak menolak kombinasi yang salah). */
export function bodyJenis(f) {
  const aset = ["MESIN_PERALATAN", "UANG_MUKA_PEMBELIAN"].includes(f.billType);
  const biaya = ["JASA_OPERASIONAL", "BIAYA_PRODUKSI_NON_STOK"].includes(f.billType);
  return {
    billType: f.billType || undefined,
    goodsReceiptId: f.billType === "BAHAN_BAKU" ? (f.goodsReceiptId || null) : null,
    expenseCategoryId: biaya ? (f.expenseCategoryId || null) : null,
    purchaseCategoryId: aset ? (f.purchaseCategoryId || null) : null,
  };
}

export function jenisLengkap(f) {
  if (!f.billType) return false;
  if (f.billType === "BAHAN_BAKU") return true;
  if (["JASA_OPERASIONAL", "BIAYA_PRODUKSI_NON_STOK"].includes(f.billType)) return !!f.expenseCategoryId;
  return !!f.purchaseCategoryId;
}
