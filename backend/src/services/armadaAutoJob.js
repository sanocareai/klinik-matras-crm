// Jembatan otomatis Sales CRM -> Delivery Hub (24 Agustus 2026).
//
// KONTEKS: sebelum file ini ada, unit yang baru lahir ber-status
// AWAITING_PICKUP HANYA terlihat dispatcher lewat daftar "unit belum
// terjadwal" di GET /armada/board — dispatcher tetap harus klik "Buat Job"
// secara manual sebelum unit itu punya wujud sebagai Job. Untuk order yang
// sales sudah tandai butuh pengambilan, langkah manual itu murni pekerjaan
// administratif (tidak ada keputusan dispatcher yang sesungguhnya di situ
// selain "ya, buat"), jadi dipindah jadi otomatis di sini.
//
// PRINSIP: cuma buat KERANGKA job (status UNSCHEDULED, tanpa driver/tanggal/
// kendaraan) — bukan menjadwalkan sungguhan. deriveStatus(false,false) di
// armada.js akan menghasilkan status yang SAMA persis kalau job ini dibuat
// manual tanpa driver+tanggal, jadi tidak ada jalur job yang "beda kelas".
// Customer TIDAK dapat WA apa pun hanya karena sales input order —
// sejak 31 Agustus 2026 notifikasi "Driver menuju lokasi" (bekas "Pickup
// dijadwalkan") baru terpicu di POST /jobs/:id/start, jauh setelah job ini
// dibuat kerangkanya di sini (dan bahkan setelah dispatcher memberi
// tanggal+driver) — job auto-buat ini murni administratif, tidak pernah
// jadi alasan langsung customer dihubungi.
//
// DIPANGGIL DARI: services/unitProvisioning.js#createUnitsForOrder, DI DALAM
// transaksi yang sama dengan pembuatan unit — supaya order+unit+job lahir
// bersama, konsisten dengan filosofi file itu ("order tanpa unit adalah
// keadaan yang sedang kita perbaiki, jangan dibuat lagi").
//
// BELUM MENCAKUP sisi DELIVERY (unit jadi READY_FOR_DELIVERY lewat alur
// produksi) — itu dipicu dari titik yang beda (unit stage engine, bukan
// unitProvisioning.js) dan sengaja tidak digabung di sini supaya perubahan
// ini kecil & bisa diverifikasi jelas. Baik dijadikan langkah lanjutan
// terpisah, bukan tebakan diam-diam ditambahkan di sini.

import { ACTIVE_JOB_STATUSES } from "./jobStatus.js";

/**
 * Pastikan setiap unit AWAITING_PICKUP milik `orderId` yang belum terikat
 * job PICKUP aktif manapun punya rumah di sebuah Job (dibuat kalau belum
 * ada, digabung ke yang sudah ada kalau ada job PICKUP order ini yang masih
 * UNSCHEDULED — supaya TIDAK muncul dua job pickup paralel untuk order yang
 * sama, konsisten dengan PRD §5.2 "satu job = satu order").
 *
 * WAJIB dipanggil di dalam transaksi (`tx`) yang sama dengan penulisan
 * Unit.status — kalau dipanggil terpisah, ada jendela balapan (unit sempat
 * tanpa job) sekecil apa pun. Best-effort dari sisi pemanggil: kegagalan di
 * sini seharusnya tidak pernah terjadi (query sederhana, tidak ada I/O
 * eksternal), tapi kalau toh gagal, pemanggil tetap membiarkan errornya
 * naik — order+unit HARUS gagal bersama job-nya, bukan diam-diam kehilangan
 * job cuma karena panggilan ini gagal setengah jalan.
 *
 * Return: id job yang dipakai (baru atau existing), atau null kalau tidak
 * ada unit yang perlu diurus (order ini tidak punya unit AWAITING_PICKUP
 * yang masih bebas).
 */
export async function ensurePickupJobForOrder(tx, orderId) {
  const freeUnits = await tx.unit.findMany({
    where: {
      orderId,
      status: "AWAITING_PICKUP",
      // "Bebas" = tidak terikat job PICKUP mana pun yang statusnya masih
      // aktif. Unit.status TETAP AWAITING_PICKUP sepanjang job pickup-nya
      // berjalan (lihat catatan armada.js baris ~7-13) — jadi status unit
      // saja TIDAK CUKUP menandai "belum ada job", harus join ke job_units.
      jobUnits: { none: { job: { type: "PICKUP", status: { in: ACTIVE_JOB_STATUSES } } } },
    },
    select: { id: true },
  });
  if (freeUnits.length === 0) return null;

  const existing = await tx.job.findFirst({
    where: { orderId, type: "PICKUP", status: "UNSCHEDULED" },
    select: { id: true },
  });

  if (existing) {
    await tx.jobUnit.createMany({
      data: freeUnits.map((u) => ({ jobId: existing.id, unitId: u.id })),
      skipDuplicates: true,
    });
    return existing.id;
  }

  const job = await tx.job.create({
    data: {
      type: "PICKUP",
      orderId,
      status: "UNSCHEDULED",
      units: { create: freeUnits.map((u) => ({ unitId: u.id })) },
    },
    select: { id: true },
  });
  return job.id;
}
