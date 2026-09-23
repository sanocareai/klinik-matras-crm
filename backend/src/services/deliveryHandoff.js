import { executeDeliveryCrossBoundaryCommand } from "./deliveryCrossBoundaryCommandService.js";

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

// Alamat sales (Order.deliveryAddress/deliveryCity) diisi LANGSUNG ke job
// baru — sama alasan & pola dengan D-040 (alamatDariOrder() di
// armadaAutoJob.js untuk job PICKUP otomatis): tanpa ini, job DELIVERY yang
// lahir di sini SELALU addressText null, memaksa dispatcher klik "Pakai
// alamat order" satu-satu di JobDetailDrawer. Ditemukan 14 September 2026
// saat membetulkan D-168 (job auto SEWA) — celah ini SEBENARNYA sudah ada
// sejak fungsi ini pertama dibuat (24 Agustus 2026), untuk SEMUA jalur yang
// memanggilnya (unit tuntas produksi, dropdown status manual "Siap Kirim"),
// bukan cuma SEWA — diperbaiki di sini sekali untuk semua pemanggil.
function alamatDariOrder(order) {
  return [order?.deliveryAddress, order?.deliveryCity].filter(Boolean).join(", ") || null;
}

export async function suggestDeliveryJob(tx, unitId) {
  const unit = await tx.unit.findUnique({
    where: { id: unitId },
    select: { id: true, orderId: true, order: { select: { deliveryAddress: true, deliveryCity: true } } },
  });
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
    select: { id: true, addressText: true, routeId: true },
  });

  if (existing) {
    return executeDeliveryCrossBoundaryCommand(tx, {
      commandType: "PRODUCTION_DELIVERY_HANDOFF_EXTEND",
      aggregateHint: existing.id,
      request: { unitId, orderId: unit.orderId },
      mutate: async (commandTx) => {
        await commandTx.jobUnit.create({ data: { jobId: existing.id, unitId } });
        if (!existing.addressText) {
          const alamat = alamatDariOrder(unit.order);
          if (alamat) await commandTx.job.update({ where: { id: existing.id }, data: { addressText: alamat } });
        }
        return { value: undefined, jobIds: [existing.id], routeIds: [existing.routeId] };
      },
    });
  }

  return executeDeliveryCrossBoundaryCommand(tx, {
    commandType: "PRODUCTION_DELIVERY_HANDOFF_CREATE",
    aggregateHint: unit.orderId,
    request: { unitId, orderId: unit.orderId },
    mutate: async (commandTx) => {
      const job = await commandTx.job.create({
        data: {
          type: "DELIVERY",
          orderId: unit.orderId,
          status: "UNSCHEDULED",
          addressText: alamatDariOrder(unit.order),
          units: { create: [{ unitId }] },
        },
        select: { id: true },
      });
      return { value: undefined, jobIds: [job.id] };
    },
  });
}
