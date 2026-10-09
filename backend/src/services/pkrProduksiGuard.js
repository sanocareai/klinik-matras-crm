// GERBANG PRODUKSI UNTUK ORDER PENJUALAN KARYAWAN — satu tempat untuk semua pintu Produksi (jadwal Rencana, buka Run, penetapan PIC, mulai/rekam tahap).
//
// Order yang lahir dari PKR boleh dibuat sebelum spesifikasinya diketahui (merk, ukuran, dikirim/diambil sendiri, alamat). Selama belum lengkap, order itu tampil sebagai
// "Perlu dilengkapi" dan TIDAK boleh dijadwalkan, dimulai, atau direkam tahapnya. Status dihitung dari isi order (lib/domain/pkrSpesifikasi.js) — tidak ada kolom yang bisa
// tidak sinkron. Setelah dilengkapi, pintu yang sama langsung terbuka TANPA membuat Order atau Unit baru (gerbang hanya membaca).
//
// Modul ini sengaja kecil: hanya membaca order dan mengembalikan pesan; pemanggil melempar galat sesuai jenisnya (StageTransitionError, planError, rencanaError).
import { bacaSpesifikasiPkr, PESAN_SPEK_BELUM_LENGKAP } from "../lib/domain/pkrSpesifikasi.js";

/** Kolom Order yang dibutuhkan untuk menilai kelengkapan + menampilkan rujukan PKR. Dipakai ulang oleh select bacaan (backlog, daftar, Unit 360). */
export const PKR_ORDER_SELECT = Object.freeze({
  penjualanKaryawanId: true, notes: true, pkrPerluDikirim: true, deliveryAddress: true, deliveryCity: true,
  penjualanKaryawan: { select: { nomor: true, buyerName: true, seller: { select: { id: true, name: true } } } },
});

/**
 * Rujukan PKR ringkas dari baris Order (select PKR_ORDER_SELECT). null untuk order biasa. TIDAK membawa nominal.
 * @returns {null | { penjualanId: string, nomor: string, karyawan: string|null, pembeli: string|null, perluDikirim: boolean|null, kirimLabel: string, lengkap: boolean, kurang: string[] }}
 */
export function rujukanPkrDariOrder(order) {
  if (!order?.penjualanKaryawanId) return null;
  const spek = bacaSpesifikasiPkr(order);
  return {
    penjualanId: order.penjualanKaryawanId, nomor: order.penjualanKaryawan?.nomor ?? null, karyawan: order.penjualanKaryawan?.seller?.name ?? null,
    pembeli: order.penjualanKaryawan?.buyerName ?? null, perluDikirim: spek.perluDikirim,
    kirimLabel: spek.perluDikirim === true ? "Dikirim" : spek.perluDikirim === false ? "Ambil sendiri" : "Belum ditentukan",
    lengkap: spek.lengkap, kurang: spek.kurang,
  };
}

/** Pesan Indonesia bila order PKR belum lengkap (menyebut data yang kurang), selain itu null. `db` = prisma atau tx. `aksi` = akibat yang ditegaskan di pesan. */
export async function pesanPkrBelumLengkap(db, orderId, aksi) {
  if (!orderId) return null;
  const o = await db.order.findUnique({ where: { id: orderId }, select: PKR_ORDER_SELECT });
  const r = rujukanPkrDariOrder(o);
  return r && !r.lengkap ? PESAN_SPEK_BELUM_LENGKAP(r.nomor, r.kurang, aksi) : null;
}

/** Sama, dicari lewat unit. */
export async function pesanPkrBelumLengkapUnit(db, unitId, aksi) {
  const u = await db.unit.findUnique({ where: { id: unitId }, select: { orderId: true } });
  return u ? pesanPkrBelumLengkap(db, u.orderId, aksi) : null;
}
