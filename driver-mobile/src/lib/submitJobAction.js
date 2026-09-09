// Port dari frontend/src/utils/submitJobAction.js — kontrak endpoint SAMA
// PERSIS (start/arrive butuh proofPhotoUrls, complete butuh proofPhotoUrls+
// signatureUrl+note opsional, fail butuh failureReason+failurePhotoUrls+
// note opsional). Offline queue (enqueueAction/isNetworkError di versi web)
// BELUM diport di sini — menyusul milestone berikutnya (lihat plan), untuk
// sekarang performSubmit() dipanggil LANGSUNG, gagal jaringan = error apa
// adanya ke UI, bukan diam-diam hilang.
import { api } from "../api";

export async function uploadPhotos(jobId, files) {
  if (!files || files.length === 0) return [];
  const { urls } = await api.uploadJobPhotos(jobId, files);
  return urls;
}

export async function performSubmit(jobId, action, payload, photoFiles = []) {
  if (action === "start") {
    const startPhotoUrls = await uploadPhotos(jobId, photoFiles);
    return api.startArmadaJob(jobId, { proofPhotoUrls: startPhotoUrls });
  }
  if (action === "arrive") {
    const arrivalPhotoUrls = await uploadPhotos(jobId, photoFiles);
    return api.arriveArmadaJob(jobId, { proofPhotoUrls: arrivalPhotoUrls });
  }

  const proofPhotoUrls = await uploadPhotos(jobId, photoFiles);

  if (action === "complete") {
    return api.completeArmadaJob(jobId, { proofPhotoUrls, note: payload.note });
  }
  if (action === "fail") {
    return api.failArmadaJob(jobId, {
      failureReason: payload.failureReason, failurePhotoUrls: proofPhotoUrls, note: payload.note,
    });
  }
  throw new Error(`Aksi tidak dikenal: ${action}`);
}
