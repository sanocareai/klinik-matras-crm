// ITEM PENJUALAN & PEMENUHAN (Penjualan Karyawan) — aturan MURNI (tanpa DB).
//
// Satu baris item penjualan (fin_penjualan_karyawan_items) adalah SUMBER KANONIS: kategori/produk katalog, nama, jumlah, harga satuan, ukuran, spesifikasi, cara pemenuhan, dan
// dikirim/diambil sendiri. Dari baris yang sama Finance menghitung total/piutang/jurnal, Order CRM membuat item operasional, Produksi membuat unit, dan Delivery/Pickup mengikuti
// cara pemenuhan. Tidak ada input ganda: layar hanya punya SATU daftar item.
//
// CARA PEMENUHAN (dipilih eksplisit — tidak pernah ditebak dari kategori):
//   PRODUKSI_BARU      : dibuat Produksi dari nol -> unit langsung di workshop (kategori BARU).
//   SERVICE_PICKUP     : barang customer diambil lalu dikerjakan (Service/Upgrade) -> unit menunggu pengambilan + job pickup (kategori LAYANAN).
//   AMBIL_STOK         : barang jadi dari stok. Tidak ada unit Produksi dan tidak ada job pengiriman (unit tidak ada); hanya tercatat di penjualan + catatan order.
//   TANPA_OPERASIONAL  : tidak memerlukan pekerjaan operasional (mis. biaya jasa). Hanya tercatat di penjualan.
export const PEMENUHAN = Object.freeze({
  PRODUKSI_BARU: { kode: "PRODUKSI_BARU", label: "Produksi Baru", unit: true, jenisKerja: "BARU" },
  SERVICE_PICKUP: { kode: "SERVICE_PICKUP", label: "Service / Pickup", unit: true, jenisKerja: "LAYANAN" },
  AMBIL_STOK: { kode: "AMBIL_STOK", label: "Ambil dari Stok", unit: false, jenisKerja: null },
  TANPA_OPERASIONAL: { kode: "TANPA_OPERASIONAL", label: "Tidak Memerlukan Operasional", unit: false, jenisKerja: null },
});
export const PEMENUHAN_KODE = Object.freeze(Object.keys(PEMENUHAN));
export const labelPemenuhan = (k) => PEMENUHAN[k]?.label ?? null;
/** Pemenuhan yang melahirkan unit (pekerjaan Produksi/Pickup) -> membentuk item operasional di Order CRM. */
export const punyaUnit = (k) => Boolean(PEMENUHAN[k]?.unit);

export const NAMA_ITEM_MAKS = 160; // = lebar kolom nama item operasional (pkr_order_items.product_name); dipakai SEMUA baris supaya nama selalu bisa disalin persis

export class PenjualanItemError extends Error {
  constructor(message, code = "ITEM_PENJUALAN_TIDAK_VALID", extra = null) { super(message); this.name = "PenjualanItemError"; this.statusCode = 400; this.code = code; if (extra) this.extra = extra; }
}
const gagal = (m, c, e) => new PenjualanItemError(m, c, e);

/** Jalur terpadu dipakai bila SALAH SATU item membawa pemenuhan/kategori; item lama hanya {name, quantity, unitPrice}. */
export function adaModeTerpadu(items) {
  return Array.isArray(items) && items.some((i) => i && typeof i === "object" && (i.pemenuhan !== undefined || i.kategori !== undefined || i.kategoriId !== undefined));
}

/**
 * Pastikan cara pemenuhan sah dan konsisten dengan jenis kerja kategori hasil katalog. `jenisKerja` = BARU | LAYANAN dari katalog (null bila tanpa kategori).
 * Tidak menebak: pemenuhan wajib dipilih; pasangan yang tidak cocok ditolak dengan arahan.
 */
export function periksaPemenuhan({ no, pemenuhan, jenisKerja, kategoriNama = null, adaKategori }) {
  const awal = `Item ${no}: `;
  if (!PEMENUHAN[pemenuhan]) {
    throw gagal(`${awal}pilih cara pemenuhan — Produksi Baru, Service/Pickup, Ambil dari Stok, atau Tidak Memerlukan Operasional`, "PEMENUHAN_WAJIB");
  }
  const p = PEMENUHAN[pemenuhan];
  if (p.unit && !adaKategori) throw gagal(`${awal}pilih kategori item untuk ${p.label} (rute Produksi dihitung dari kategori)`, "KATEGORI_WAJIB");
  if (p.unit && jenisKerja && jenisKerja !== p.jenisKerja) {
    const sebaliknya = jenisKerja === "LAYANAN" ? PEMENUHAN.SERVICE_PICKUP : PEMENUHAN.PRODUKSI_BARU;
    throw gagal(`${awal}kategori "${kategoriNama ?? "?"}" adalah pekerjaan ${jenisKerja === "LAYANAN" ? "Service/Upgrade" : "produk baru"} — pilih cara pemenuhan "${sebaliknya.label}", bukan "${p.label}"`, "PEMENUHAN_TIDAK_SESUAI");
  }
  return p;
}

/** Nama item di tagihan: nama produk katalog / ketikan, atau — bila bentuknya tidak mewajibkan produk — nama kategori. Mengembalikan null bila nama wajib tetapi belum ada. */
export function namaItem({ produkNama, kategoriNama, produkWajib }) {
  const t = String(produkNama ?? "").trim().replace(/\s+/g, " ");
  if (t) return t.slice(0, NAMA_ITEM_MAKS);
  if (produkWajib) return null;
  const k = String(kategoriNama ?? "").trim();
  return k ? k.slice(0, NAMA_ITEM_MAKS) : null;
}

/** Ringkasan label untuk tampilan: "Produksi Baru · Dikirim". */
export function labelPemenuhanLengkap(pemenuhan, perluDikirim) {
  const l = labelPemenuhan(pemenuhan);
  if (!l) return null;
  if (!punyaUnit(pemenuhan)) return l;
  return `${l} · ${perluDikirim === true ? "Dikirim" : perluDikirim === false ? "Diambil sendiri" : "Dikirim/diambil belum ditentukan"}`;
}
