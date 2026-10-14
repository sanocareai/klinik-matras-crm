// IDENTITAS CUSTOMER KANONIS ORDER PENJUALAN KARYAWAN — SATU read-model yang dipakai semua workspace (Sales CRM, Produksi, Delivery/Driver, Finance, Gudang, laporan).
//
// Jangan membentuk label sendiri-sendiri di pembaca lain; panggil identitasPkr() lalu tampilkan. Aturan:
//   • Customer/pembeli utama = Order.customer (Bpk. Indra). Karyawan penjual (Kemal) hanya SUMBER — tidak pernah menjadi nama customer.
//   • Order LEGACY (masih menunjuk profil internal karyawan penjual dan pembeli bukan karyawan itu sendiri): tampilkan snapshot nama pembeli dari PKR sebagai identitas
//     sementara + penanda "Data customer belum lengkap". Tidak ada nomor telepon yang ditebak.
//   • Pembeli adalah karyawan (jalur eksplisit, notes.pembeliKaryawan = true): profil karyawan itu SAH sebagai customer — bukan legacy.
//   • Penerima = Order.recipientName/recipientPhone bila diisi, selain itu sama dengan customer.
//   • Tidak ada harga/pembayaran/piutang di sini (itu hanya Finance/Admin lewat ringkasOrderPkr dengan izin).
import { bacaNotesOrder } from "./pkrSpesifikasi.js";
import { penerimaBerbeda } from "./pkrPembeli.js";

const teks = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Kolom Order yang dibutuhkan identitasPkr (tambahkan ke select pembaca). */
export const PKR_IDENTITAS_SELECT = Object.freeze({
  penjualanKaryawanId: true, customerId: true, notes: true, recipientName: true, recipientPhone: true, deliveryAddress: true, deliveryCity: true, locationUrl: true, deliveryLandmark: true,
  productionNote: true, deliveryNote: true, pickupEstimate: true, deliveryEstimate: true,
  customer: { select: { id: true, name: true, phone: true, staffUserId: true, leadSource: true } },
  penjualanKaryawan: { select: { nomor: true, buyerName: true, seller: { select: { id: true, name: true, customerInternal: { select: { id: true } } } } } },
});

/**
 * @param order  baris Order (select PKR_IDENTITAS_SELECT). Order biasa (tanpa penjualanKaryawanId) → null.
 * @returns {null | {
 *   nomorPkr: string|null,
 *   karyawanPenjual: { id: string|null, nama: string|null },
 *   customer: { id: string|null, nama: string|null, telepon: string|null, aktual: boolean },
 *   pembeliAdalahKaryawan: boolean,
 *   legacy: boolean,
 *   perluDilengkapi: boolean,
 *   penerima: { nama: string|null, telepon: string|null, berbeda: boolean },
 *   alamat: { teks: string|null, kota: string|null, lokasiUrl: string|null, patokan: string|null },
 * }}
 */
export function identitasPkr(order) {
  if (!order?.penjualanKaryawanId) return null;
  const pkr = order.penjualanKaryawan ?? null;
  const penjual = pkr?.seller ?? null;
  const c = order.customer ?? null;
  const notes = bacaNotesOrder(order.notes);
  const pembeliKaryawan = notes.pembeliKaryawan === true;
  // Profil internal karyawan penjual: dikenali lewat Customer.staffUserId (bila customer dimuat) ATAU lewat relasi balik User.customerInternal (bila hanya customerId yang ada).
  const profilKaryawan = (Boolean(c?.staffUserId) && (!penjual?.id || c.staffUserId === penjual.id))
    || Boolean(order.customerId && penjual?.customerInternal?.id && order.customerId === penjual.customerInternal.id);
  const legacy = profilKaryawan && !pembeliKaryawan;

  const customerNama = legacy ? (teks(pkr?.buyerName) ?? teks(c?.name)) : (teks(c?.name) ?? teks(pkr?.buyerName));
  const customerTelepon = legacy ? null : teks(c?.phone);
  const penerimaNama = teks(order.recipientName);
  const penerimaTelepon = teks(order.recipientPhone);
  const berbeda = penerimaBerbeda({ penerimaNama, penerimaTelepon, customerNama, customerTelepon });

  return {
    nomorPkr: pkr?.nomor ?? null,
    karyawanPenjual: { id: penjual?.id ?? null, nama: teks(penjual?.name) },
    customer: { id: c?.id ?? null, nama: customerNama, telepon: customerTelepon, aktual: !legacy },
    pembeliAdalahKaryawan: pembeliKaryawan,
    legacy,
    perluDilengkapi: legacy,
    penerima: {
      nama: penerimaNama ?? customerNama,
      telepon: penerimaTelepon ?? customerTelepon,
      berbeda,
    },
    alamat: {
      teks: teks(order.deliveryAddress), kota: teks(order.deliveryCity), lokasiUrl: teks(order.locationUrl), patokan: teks(order.deliveryLandmark),
    },
    catatan: { keluhan: teks(notes.keluhanCustomer), order: teks(notes.catatanOrder), produksi: teks(order.productionNote), delivery: teks(order.deliveryNote) },
    waktu: { pickup: teks(order.pickupEstimate), kirim: teks(order.deliveryEstimate) },
  };
}

/**
 * Proyeksi identitas per AUDIENS (privasi): satu read-model, isi disaring menurut kebutuhan kerja.
 *   CRM/FINANCE : seluruhnya (harga/pembayaran tetap di ringkasOrderPkr dengan izin Finance — bukan di sini).
 *   PRODUKSI    : nama customer, keluhan, catatan order & Produksi. TANPA telepon, alamat, Maps, penerima.
 *   DELIVERY    : nama penerima/customer, telepon penerima, alamat, Maps, patokan, catatan Delivery. TANPA keluhan/catatan Produksi.
 * Karyawan penjual selalu ikut sebagai referensi internal. Tidak pernah ada nominal.
 */
export function proyeksiIdentitas(id, audiens = "CRM") {
  if (!id) return null;
  const dasar = { nomorPkr: id.nomorPkr, karyawanPenjual: id.karyawanPenjual, legacy: id.legacy, perluDilengkapi: id.perluDilengkapi, pembeliAdalahKaryawan: id.pembeliAdalahKaryawan };
  if (audiens === "PRODUKSI") {
    return { ...dasar, customer: { id: id.customer.id, nama: id.customer.nama, aktual: id.customer.aktual }, catatan: { keluhan: id.catatan.keluhan, order: id.catatan.order, produksi: id.catatan.produksi } };
  }
  if (audiens === "DELIVERY") {
    return {
      ...dasar, customer: { id: id.customer.id, nama: id.customer.nama, telepon: id.customer.telepon, aktual: id.customer.aktual },
      penerima: id.penerima, alamat: id.alamat, catatan: { delivery: id.catatan.delivery }, waktu: id.waktu, waktu: id.waktu,
    };
  }
  return { ...dasar, customer: id.customer, penerima: id.penerima, alamat: id.alamat, catatan: id.catatan, waktu: id.waktu };
}

/** Nama customer yang BENAR untuk ditampilkan di kolom "Pelanggan" (legacy → snapshot pembeli, bukan nama karyawan). Order biasa: nama customer apa adanya. */
export function namaCustomerOrder(order) {
  const id = identitasPkr(order);
  if (!id) return teks(order?.customer?.name);
  return id.customer.nama;
}
