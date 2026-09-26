// Logika murni Jenis Tagihan Supplier (B3.3) + metode persediaan (B3.5) — dipakai JenisTagihan.jsx dan dites langsung
// (tests/jenisTagihan.test.js). Aturan yang SEBENARNYA ditegakkan server (services/finance/inventoryMethod.js); di sini hanya agar
// layar menjelaskan jalurnya dan tidak membiarkan staf menyimpan tagihan yang pasti ditolak.

export const CATATAN_PERIODIK = "Metode periodik — nilai persediaan akhir ditentukan melalui stok opname.";

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function tanggalIndonesia(kunci) {
  const [y, m, d] = String(kunci || "").split("-");
  return y && m && d ? `${Number(d)} ${BULAN[Number(m) - 1]} ${y}` : "";
}

function hariIniKunci() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** info = respons GET /finance/inventory-method ({ sebelumCutover, cutover }). null = belum dimuat → server yang menegakkan. */
export function metodeUntukTanggal(info, tanggal) {
  if (!info) return null;
  const t = String(tanggal || hariIniKunci()).slice(0, 10);
  if (info.cutover && t >= info.cutover) return "PERPETUAL";
  return info.sebelumCutover === "PERPETUAL" ? "PERPETUAL" : "PERIODIK";
}

/** Bahan baku tanpa penerimaan Gudang pada metode PERPETUAL — pasti ditolak server. */
export function bahanBakuButuhPenerimaan(f, info) {
  return f.billType === "BAHAN_BAKU" && !f.goodsReceiptId && metodeUntukTanggal(info, f.billDate) === "PERPETUAL";
}

export const JENIS_TAGIHAN = [
  { kode: "BAHAN_BAKU", label: "Bahan Baku / Stok", ket: "Kain, busa, per, dan bahan lain yang disimpan sebagai stok. Sebelum tanggal cutover (metode periodik) tanpa penerimaan Gudang dicatat ke Beban Bahan Baku / Pemakaian Bahan (5-1100); mulai cutover (perpetual) wajib menaut Penerimaan Barang Gudang." },
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

export function jenisLengkap(f, info = null) {
  if (!f.billType) return false;
  if (f.billType === "BAHAN_BAKU") return !bahanBakuButuhPenerimaan(f, info);
  if (["JASA_OPERASIONAL", "BIAYA_PRODUKSI_NON_STOK"].includes(f.billType)) return !!f.expenseCategoryId;
  return !!f.purchaseCategoryId;
}
