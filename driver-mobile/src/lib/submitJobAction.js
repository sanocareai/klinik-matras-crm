// Port dari frontend/src/utils/submitJobAction.js. SISA SATU jalur di sini
// sekarang: "Lapor Revisi di Lokasi" (18 September 2026), lihat catatan
// panjang di backend routes/armada.js POST /jobs/:id/report-revision.
//
// REFAKTOR (audit Slice 2, 23 September 2026) — cabang start/arrive/
// complete/fail yang dulu ada di sini sudah DIHAPUS: sejak antrean offline
// (context/ExecutionSyncContext.js + lib/executionQueue.js) dipasang,
// JobCard.js/RouteStartCard.js memanggil keempat aksi itu lewat
// useExecutionSync().submit() — cabang di file ini tidak pernah tereksekusi
// lagi (dead code), dan membiarkannya berarti dua implementasi paralel
// yang bisa diam-diam menyimpang (cuma satu yang tersambung ke antrean
// offline/idempotency-key/checkpoint upload). report-revision TIDAK
// dipindah ke antrean offline (belum ada kebutuhan retry-nya) — jalur ini
// tetap dipanggil LANGSUNG seperti sebelumnya, tidak berubah.
import { api } from "../api";

export async function uploadPhotos(jobId, files) {
  if (!files || files.length === 0) return [];
  const { urls } = await api.uploadJobPhotos(jobId, files);
  return urls;
}

export async function performSubmit(jobId, action, payload, photoFiles = []) {
  if (action !== "report-revision") {
    throw new Error(`Aksi tidak dikenal: ${action}`);
  }
  const proofPhotoUrls = await uploadPhotos(jobId, photoFiles);
  return api.reportRevision(jobId, { complaint: payload.complaint, photoUrls: proofPhotoUrls, unitId: payload.unitId });
}
