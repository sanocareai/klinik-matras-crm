import { prisma } from "../db.js";

// Sinkronkan Customer.orderCount/orderValue (denormalized, lihat komentar
// panjang di schema.prisma) dari SUMBER KEBENARAN (tabel Order). WAJIB
// dipanggil setiap kali order milik seorang customer berubah — status,
// value (langsung ATAU lewat item layanan), atau dibuat/dihapus. CANCELLED
// dikecualikan, konsisten dengan definisi yang sudah dipakai di seluruh
// aplikasi (analytics.js, sales-report, GET /pipeline/board).
//
// Dihitung ULANG DARI NOL tiap kali (bukan tambah/kurang incremental) —
// sengaja: order per customer jumlahnya kecil (rata-rata <1, jarang >10),
// jadi biaya query aggregate ini jauh lebih murah daripada risiko bug
// aritmetika incremental yang perlahan meleset dari kenyataan tanpa ada
// yang sadar (kelas bug yang paling berbahaya karena tidak error, cuma
// diam-diam salah).
export async function syncCustomerOrderAggregate(customerId) {
  if (!customerId) return;
  const agg = await prisma.order.aggregate({
    where: { customerId, status: { not: "CANCELLED" } },
    _count: { _all: true },
    _sum: { value: true },
  });
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      orderCount: agg._count._all,
      orderValue: agg._sum.value || 0,
    },
  }).catch((err) => {
    // Customer bisa saja sudah terhapus di antara request ini dimulai dan
    // sync dipanggil (race jarang, tapi mungkin) — jangan sampai gagal sync
    // menjatuhkan response order yang sebenarnya sudah berhasil diproses.
    console.error(`[customerOrderAggregate] gagal sync customer ${customerId}:`, err.message);
  });
}
