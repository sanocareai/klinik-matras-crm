// Pemroses antrean offline (Phase 2). Dipanggil saat browser kembali online
// dan secara berkala sebagai fallback (event 'online' tidak selalu bisa
// diandalkan di semua browser mobile — lihat pemakaian di DriverJobs.jsx).
//
// URUTAN PENTING: entri diproses FIFO (paling lama dulu) — kalau job A
// selesai lalu job B selesai selagi driver offline, keduanya harus terkirim
// dalam urutan yang sama supaya createdAt/completedAt di server masuk akal.

import { getQueue, removeAction, markActionError, isNetworkError } from "./offlineQueue.js";
import { performSubmit } from "./submitJobAction.js";

// Return { sent, failed, stillOffline } — dipakai UI untuk pesan status.
// STOP di error jaringan pertama (urutan harus terjaga, dan kalau satu
// gagal karena offline, sisanya juga pasti gagal — percuma dicoba semua).
// Error API (bukan jaringan) BEDA: entri TETAP di antrean (bukan dibuang
// diam-diam — itu berarti kehilangan data driver tanpa jejak) dengan
// lastError terisi, ditampilkan di UI dengan tombol dismiss manual. Driver/
// admin yang memutuskan aksi itu boleh dibuang, bukan sistem yang menebak.
export async function processQueue() {
  const queue = await getQueue();
  let sent = 0;
  let failed = 0;
  for (const entry of queue) {
    try {
      await performSubmit(entry.jobId, entry.action, entry.payload, entry.photoBlobs, entry.signatureBlob);
      await removeAction(entry.id);
      sent++;
    } catch (err) {
      if (isNetworkError(err)) {
        return { sent, failed, stillOffline: true };
      }
      await markActionError(entry.id, err.message);
      failed++;
    }
  }
  return { sent, failed, stillOffline: false };
}
