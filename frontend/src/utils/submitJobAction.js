// Satu titik masuk untuk SEMUA aksi driver yang mungkin perlu diantre
// offline (Phase 2). Dipakai langsung oleh DriverJobs.jsx (percobaan
// pertama saat driver menekan tombol) DAN oleh syncQueue.js (saat antrean
// diproses ulang setelah online lagi) — supaya logika "apa yang sebenarnya
// dikirim ke server" cuma ada SATU tempat, tidak dua implementasi yang bisa
// diam-diam berbeda.

import { api } from "../api.js";
import { enqueueAction, isNetworkError } from "./offlineQueue.js";

export async function uploadBlobs(jobId, blobs) {
  if (!blobs || blobs.length === 0) return [];
  const fd = new FormData();
  blobs.forEach((b, i) => fd.append("photos", b, b.name || `foto-${Date.now()}-${i}.jpg`));
  const { urls } = await api.uploadJobPhotos(jobId, fd);
  return urls;
}

// Kirim SATU aksi ke server sungguhan — TIDAK ADA fallback antrean di sini,
// itu tanggung jawab pemanggil (submitOrQueue di bawah, atau syncQueue.js
// yang sudah tahu ini lagi memproses antrean).
export async function performSubmit(jobId, action, payload, photoFiles = [], signatureBlob = null) {
  if (action === "start") return api.startArmadaJob(jobId);
  if (action === "arrive") return api.arriveArmadaJob(jobId);

  const proofPhotoUrls = await uploadBlobs(jobId, photoFiles);
  let signatureUrl = null;
  if (signatureBlob) {
    const [url] = await uploadBlobs(jobId, [signatureBlob]);
    signatureUrl = url;
  }

  if (action === "complete") {
    return api.completeArmadaJob(jobId, { proofPhotoUrls, signatureUrl, note: payload.note });
  }
  if (action === "fail") {
    return api.failArmadaJob(jobId, {
      failureReason: payload.failureReason, failurePhotoUrls: proofPhotoUrls, note: payload.note,
    });
  }
  if (action === "payment") {
    return api.recordJobPayment(jobId, {
      amount: payload.amount, method: payload.method, proofPhotoUrl: proofPhotoUrls[0] || null,
    });
  }
  throw new Error(`Aksi tidak dikenal: ${action}`);
}

// Coba kirim langsung dulu. Kalau gagal karena JARINGAN (bukan validasi
// server — foto kosong, alasan gagal kosong, dst), antre untuk dikirim
// ulang otomatis begitu online lagi, supaya driver tetap bisa lanjut
// bekerja tanpa menunggu sinyal.
export async function submitOrQueue(jobId, action, payload, photoFiles = [], signatureBlob = null) {
  try {
    const result = await performSubmit(jobId, action, payload, photoFiles, signatureBlob);
    return { queued: false, result };
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueAction({ jobId, action, payload, photoBlobs: photoFiles, signatureBlob });
      return { queued: true };
    }
    throw err;
  }
}
