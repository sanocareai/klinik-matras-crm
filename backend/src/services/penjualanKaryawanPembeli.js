// CUSTOMER AKTUAL UNTUK PENJUALAN KARYAWAN — pencarian + pembuatan Customer pembeli (BUKAN karyawan penjual) lewat nomor telepon ternormalisasi.
//
// Aturan (jangan dilanggar):
//   • Dedupe SATU-SATUNYA lewat Customer.phone (UNIQUE). Nama sama tanpa nomor bukan bukti orang yang sama → tidak pernah digabung berdasarkan nama.
//   • Pembuatan di bawah KUNCI penasihat (advisory lock) per nomor + cek-ulang, sehingga permintaan paralel menghasilkan SATU Customer (yang kalah memakai yang sudah ada)
//     — tidak ada P2002 yang menggagalkan transaksi.
//   • Customer yang sudah ada TIDAK diubah (nama/kota tidak ditimpa diam-diam). Ketidakcocokan nama dilaporkan (namaBeda) supaya UI/audit bisa menampilkannya.
//   • Customer lahir dengan sumber PENJUALAN_KARYAWAN: tidak punya Sales pemegang, tidak punya percakapan, tidak masuk funnel/pipeline/komisi Sales.
//   • Nomor milik staf internal / profil karyawan / SPAM ditolak dengan arahan (jalur "Pembeli adalah karyawan" atau nomor lain).
import { PembeliPkrError, normalisasiNomorTelepon } from "../lib/domain/pkrPembeli.js";

export const TAG_PKR_CUSTOMER = "Penjualan Karyawan";
const gagal = (m, c, s = 409, e = null) => new PembeliPkrError(m, c, s, e);

const ringkasCustomer = (c, jumlahOrder = 0) => ({
  id: c.id, nama: c.name ?? null, telepon: c.phone ?? null, kota: c.city ?? null,
  sumber: c.leadSource ?? null, jumlahOrder, internal: Boolean(c.isInternalStaff || c.staffUserId), spam: c.pipelineStage === "SPAM",
});

/** Alasan customer ini TIDAK boleh dipakai sebagai pembeli PKR, atau null. */
export function alasanCustomerTidakBisa(c) {
  if (c.staffUserId) return { kode: "PEMBELI_PROFIL_KARYAWAN", pesan: "Nomor ini milik profil internal karyawan. Pilih \"Pembeli adalah karyawan\" bila memang karyawan itu yang membeli, atau isi nomor pembeli yang sebenarnya." };
  if (c.isInternalStaff) return { kode: "PEMBELI_NOMOR_INTERNAL", pesan: "Nomor ini terdaftar sebagai nomor staf internal. Pilih \"Pembeli adalah karyawan\" bila karyawan itu yang membeli, atau isi nomor pembeli yang sebenarnya." };
  if (c.pipelineStage === "SPAM") return { kode: "PEMBELI_SPAM", pesan: "Nomor ini ditandai SPAM di CRM. Periksa nomor pembeli atau minta Admin meninjau tandanya." };
  return null;
}

/**
 * Cari Customer lewat nomor (tanpa menulis). Dipakai pratinjau/lookup di form PKR.
 * @returns {{ nomor: string, ditemukan: boolean, bisaDipakai: boolean, alasan: string|null, kode: string|null, customer: object|null }}
 */
export async function cariCustomerTelepon(db, teleponMentah) {
  const nomor = normalisasiNomorTelepon(teleponMentah);
  const c = await db.customer.findUnique({ where: { phone: nomor } });
  if (!c) return { nomor, ditemukan: false, bisaDipakai: true, alasan: null, kode: null, customer: null };
  const jumlahOrder = await db.order.count({ where: { customerId: c.id, status: { not: "CANCELLED" } } });
  const tidak = alasanCustomerTidakBisa(c);
  return { nomor, ditemukan: true, bisaDipakai: !tidak, alasan: tidak?.pesan ?? null, kode: tidak?.kode ?? null, customer: ringkasCustomer(c, jumlahOrder) };
}

/**
 * Pakai ulang Customer bernomor itu, atau buat baru. Dipanggil di DALAM transaksi pemanggil.
 * @returns {{ customer: object, dibuat: boolean, namaBeda: string|null }}
 */
export async function customerAktualUntukPkr(tx, { nama, telepon, kota = null, userId = null }) {
  const nomor = normalisasiNomorTelepon(telepon);
  const namaBersih = String(nama ?? "").replace(/\s+/g, " ").trim();
  if (namaBersih.length < 2) throw new PembeliPkrError("Nama pembeli wajib diisi", "NAMA_WAJIB", 400);
  // Kunci per nomor: dua permintaan paralel untuk nomor yang sama diserialkan di sini; yang kedua menemukan baris yang dibuat yang pertama.
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `pkr-customer:${nomor}`);
  const ada = await tx.customer.findUnique({ where: { phone: nomor } });
  if (ada) {
    const tidak = alasanCustomerTidakBisa(ada);
    if (tidak) throw gagal(tidak.pesan, tidak.kode);
    const sama = (ada.name ?? "").trim().toLowerCase() === namaBersih.toLowerCase();
    return { customer: ada, dibuat: false, namaBeda: sama || !ada.name ? null : ada.name };
  }
  const customer = await tx.customer.create({
    data: {
      name: namaBersih.slice(0, 200), phone: nomor, city: kota ? String(kota).slice(0, 100) : null,
      tags: [TAG_PKR_CUSTOMER], leadSource: "PENJUALAN_KARYAWAN", leadSourceDetail: "Penjualan Karyawan (pembeli aktual)", leadSourceConfirmed: true,
      pipelineStage: "TRANSACTION", assignedSalesId: null, nameManuallyEdited: true,
    },
  });
  void userId;
  return { customer, dibuat: true, namaBeda: null };
}
