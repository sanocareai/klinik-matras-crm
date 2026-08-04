// Integrasi Fase 1 (lanjutan D-006) — jembatan Produksi -> Armada.
//
// Sebelum ini: unit yang READY_FOR_DELIVERY cuma memicu WhatsApp ke
// customer (customerNotifications.js) — dispatcher harus INGAT membuka
// papan Armada sendiri untuk melihat unit mana yang sudah siap, lalu
// membuat Job dari nol. Tidak ada yang menghubungkan "produksi selesai"
// dengan "pengiriman perlu dijadwalkan" di sisi sistem.
//
// Fungsi ini TIDAK menjadwalkan apa pun (tidak menebak driver/tanggal —
// itu keputusan dispatcher). Yang dilakukan cuma membuat/menambah baris
// Job berstatus UNSCHEDULED (status awal yang SUDAH ada di JobStatus,
// cuma belum pernah diisi otomatis) supaya unit yang siap kirim langsung
// muncul di halaman Jadwal & Penugasan sebagai job yang tinggal
// dijadwalkan, bukan tercecer sebagai unit yang harus "ditemukan" dulu.
//
// Aturan sama dengan pembuatan job manual (armada.js POST /jobs): satu
// job cuma boleh berisi unit dari SATU order. Kalau order itu sudah punya
// job DELIVERY yang MASIH UNSCHEDULED (belum disentuh dispatcher sama
// sekali), unit baru ini ditambahkan ke situ — meniru cara dispatcher
// sungguhan membatch beberapa kasur dari order yang sama jadi satu
// pengiriman. Begitu job sudah dijadwalkan (dapat tanggal/driver), unit
// yang baru ready TIDAK ikut disisipkan diam-diam — itu akan mengubah
// muatan job yang sudah dikomit dispatcher tanpa sepengetahuannya; unit
// berikutnya mulai job UNSCHEDULED baru.

export async function suggestDeliveryJob(tx, unitId) {
  const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, orderId: true } });
  if (!unit) return;

  // Jaring pengaman: unit ini sudah pernah dimasukkan ke job DELIVERY
  // mana pun sebelumnya (mis. QC rework yang membuat unit "ready" dua
  // kali) — jangan dobel, JobUnit.[jobId,unitId] unique tapi ini
  // mencegah unit yang sama nyangkut di DUA job DELIVERY berbeda.
  const already = await tx.jobUnit.findFirst({
    where: { unitId, job: { type: "DELIVERY" } },
    select: { id: true },
  });
  if (already) return;

  const existing = await tx.job.findFirst({
    where: { orderId: unit.orderId, type: "DELIVERY", status: "UNSCHEDULED" },
    select: { id: true },
  });

  if (existing) {
    await tx.jobUnit.create({ data: { jobId: existing.id, unitId } });
    return;
  }

  await tx.job.create({
    data: {
      type: "DELIVERY",
      orderId: unit.orderId,
      status: "UNSCHEDULED",
      units: { create: [{ unitId }] },
    },
  });
}
