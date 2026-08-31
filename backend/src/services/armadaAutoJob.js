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
// D-040 (31 Agustus 2026, laporan owner: "alamat udah ada semua [di
// Order], masukkan ke sini juga") — job pickup yang lahir di sini
// sebelumnya SELALU addressText null, memaksa dispatcher klik "Pakai
// alamat order" satu-satu di JobDetailDrawer untuk tiap job baru. Alamat
// sales (Order.deliveryAddress/deliveryCity, D-027/D-032) sudah PASTI ada
// duluan (order dibuat sebelum unit/job-nya), jadi diisi LANGSUNG di sini
// — bukan lagi cuma "saran" yang menunggu diklik.
//
// SENGAJA TIDAK geocode (isi lat/lng) di sini — geocodeAddress() adalah
// panggilan HTTP eksternal (Nominatim/Google), dan fungsi ini jalan DI
// DALAM transaksi Postgres (tx) yang sama dengan penulisan Unit — menahan
// transaksi terbuka menunggu jaringan luar berisiko timeout/lock lama
// kalau geocode lambat/gagal. Lat/lng untuk alamat yang baru diisi di sini
// diurus scripts/backfill-job-address-geocode.mjs (dijalankan terpisah,
// di luar transaksi apa pun, dengan jeda hormat rate-limit Nominatim).
function alamatDariOrder(order) {
  return [order.deliveryAddress, order.deliveryCity].filter(Boolean).join(", ") || null;
}

export async function ensurePickupJobForOrder(tx, order) {
  const orderId = order.id;
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
    select: { id: true, addressText: true },
  });

  if (existing) {
    await tx.jobUnit.createMany({
      data: freeUnits.map((u) => ({ jobId: existing.id, unitId: u.id })),
      skipDuplicates: true,
    });
    // Job existing yang belum sempat punya alamat (dibuat sebelum fix ini,
    // atau dispatcher belum sempat isi manual) — lengkapi juga, konsisten
    // dengan job baru di bawah. Job yang SUDAH punya alamat (manual/
    // otomatis sebelumnya) TIDAK ditimpa.
    if (!existing.addressText) {
      const alamat = alamatDariOrder(order);
      if (alamat) await tx.job.update({ where: { id: existing.id }, data: { addressText: alamat } });
    }
    return existing.id;
  }

  const job = await tx.job.create({
    data: {
      type: "PICKUP",
      orderId,
      status: "UNSCHEDULED",
      addressText: alamatDariOrder(order),
      units: { create: freeUnits.map((u) => ({ unitId: u.id })) },
    },
    select: { id: true },
  });
  return job.id;
}
