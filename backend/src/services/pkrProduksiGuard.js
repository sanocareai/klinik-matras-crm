// GERBANG PRODUKSI UNTUK ORDER PENJUALAN KARYAWAN — satu tempat untuk semua pintu Produksi (jadwal Rencana, buka Run, penetapan PIC, mulai/rekam tahap).
//
// Order yang lahir dari PKR boleh dibuat sebelum spesifikasinya diketahui (merk, ukuran, dikirim/diambil sendiri, alamat). Selama belum lengkap, order itu tampil sebagai
// "Perlu dilengkapi" dan TIDAK boleh dijadwalkan, dimulai, atau direkam tahapnya. Status dihitung dari isi order (lib/domain/pkrSpesifikasi.js) — tidak ada kolom yang bisa
// tidak sinkron. Setelah dilengkapi, pintu yang sama langsung terbuka TANPA membuat Order atau Unit baru (gerbang hanya membaca).
//
// KELENGKAPAN PER ITEM (keputusan Owner, Okt 2026): untuk order multi-item, gerbang menilai ITEM milik unit yang bersangkutan (kelengkapan kontekstual per kategori: kasur P×L×T,
// divan ukuran + tipe, sandaran lebar × tinggi, custom spesifikasi). Item yang belum lengkap tidak menahan unit milik item lain yang sudah lengkap. Tanpa unit (gerbang tingkat
// order) atau untuk order lama, penilaian tetap seluruh order seperti sebelumnya.
//
// Modul ini sengaja kecil: hanya membaca order dan mengembalikan pesan; pemanggil melempar galat sesuai jenisnya (StageTransitionError, planError, rencanaError).
import { bacaSpesifikasiPkr, PESAN_SPEK_BELUM_LENGKAP } from "../lib/domain/pkrSpesifikasi.js";
import { bacaItemsDariNotes, kelengkapanItem } from "../lib/domain/pkrItem.js";

/** Kolom Order yang dibutuhkan untuk menilai kelengkapan + menampilkan rujukan PKR. Dipakai ulang oleh select bacaan (backlog, daftar, Unit 360). */
export const PKR_ORDER_SELECT = Object.freeze({
  penjualanKaryawanId: true, notes: true, pkrPerluDikirim: true, deliveryAddress: true, deliveryCity: true,
  penjualanKaryawan: { select: { nomor: true, buyerName: true, seller: { select: { id: true, name: true } } } },
});

/** Relasi Unit -> item PKR (untuk kelengkapan per item). Tambahkan ke select unit di pembaca yang menilai kelengkapan per unit. */
export const PKR_UNIT_ITEM_SELECT = Object.freeze({ pkrItemUnit: { select: { item: { select: { seq: true } } } } });

const noItemUnit = (unit) => unit?.pkrItemUnit?.item?.seq ?? null;
const teksAtauNull = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * Kelengkapan yang berlaku untuk SATU unit: item miliknya bila order multi-item dan unit tertaut ke item; selain itu kelengkapan seluruh order.
 * @returns {{ lengkap: boolean, kurang: string[], perluDikirim: boolean|null, perItem: boolean }}
 */
export function kelengkapanUntukUnit(order, unit = null) {
  const spek = bacaSpesifikasiPkr(order);
  const no = noItemUnit(unit);
  const items = bacaItemsDariNotes(order?.notes);
  if (no !== null && items) {
    const k = kelengkapanItem(items, no, { alamat: teksAtauNull(order?.deliveryAddress) });
    if (k) return { lengkap: k.lengkap, kurang: k.kurang, perluDikirim: k.perluDikirim, perItem: true };
  }
  return { lengkap: spek.lengkap, kurang: spek.kurang, perluDikirim: spek.perluDikirim, perItem: false };
}

/**
 * Rujukan PKR ringkas dari baris Order (select PKR_ORDER_SELECT). null untuk order biasa. TIDAK membawa nominal.
 * `unit` (opsional, dengan PKR_UNIT_ITEM_SELECT) = nilai kelengkapan untuk unit itu (per item); tanpa unit = seluruh order.
 * @returns {null | { penjualanId: string, nomor: string, karyawan: string|null, pembeli: string|null, perluDikirim: boolean|null, kirimLabel: string, lengkap: boolean, kurang: string[] }}
 */
export function rujukanPkrDariOrder(order, { unit = null } = {}) {
  if (!order?.penjualanKaryawanId) return null;
  const spek = bacaSpesifikasiPkr(order);
  const u = kelengkapanUntukUnit(order, unit);
  return {
    penjualanId: order.penjualanKaryawanId, nomor: order.penjualanKaryawan?.nomor ?? null, karyawan: order.penjualanKaryawan?.seller?.name ?? null,
    pembeli: order.penjualanKaryawan?.buyerName ?? null, perluDikirim: u.perluDikirim,
    kirimLabel: u.perluDikirim === true ? "Dikirim" : u.perluDikirim === false ? "Ambil sendiri" : "Belum ditentukan",
    lengkap: u.lengkap, kurang: u.kurang, perItem: u.perItem, lengkapOrder: spek.lengkap,
    // Order multi-item: ringkasan item (dari cerminan Order.notes.pkrItems). null untuk order lama satu-spesifikasi.
    items: (bacaItemsDariNotes(order.notes) || null)?.map((i) => ({ no: i.no, kategori: i.kategoriNama, produk: i.produkNama, jumlah: i.jumlah, ukuran: i.ukuranLabel || null, kirim: i.perluDikirim, kurang: i.kurang })) ?? null,
  };
}

/** Pesan Indonesia bila order PKR belum lengkap (menyebut data yang kurang), selain itu null. `db` = prisma atau tx. `aksi` = akibat yang ditegaskan di pesan. `unitId` = nilai per item. */
export async function pesanPkrBelumLengkap(db, orderId, aksi, { unitId = null } = {}) {
  if (!orderId) return null;
  const o = await db.order.findUnique({ where: { id: orderId }, select: PKR_ORDER_SELECT });
  if (!o?.penjualanKaryawanId) return null;
  let unit = null;
  if (unitId) unit = await db.unit.findUnique({ where: { id: unitId }, select: PKR_UNIT_ITEM_SELECT });
  const r = rujukanPkrDariOrder(o, { unit });
  return r && !r.lengkap ? PESAN_SPEK_BELUM_LENGKAP(r.nomor, r.kurang, aksi) : null;
}

/** Sama, dicari lewat unit (kelengkapan ITEM unit itu). */
export async function pesanPkrBelumLengkapUnit(db, unitId, aksi) {
  const u = await db.unit.findUnique({ where: { id: unitId }, select: { orderId: true } });
  return u ? pesanPkrBelumLengkap(db, u.orderId, aksi, { unitId }) : null;
}
