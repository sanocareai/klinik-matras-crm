export function createIdempotencyKey(prefix = "driver") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isRetryableExecutionError(error) {
  if (!error) return true;
  // Token kedaluwarsa ditahan sampai user login ulang; payload tidak boleh
  // dibuang atau ditandai invalid permanen.
  if (error.status === 401) return true;
  if (Number.isInteger(error.status)) return error.status >= 500;
  const text = String(error.message || error).toLowerCase();
  return text.includes("network") || text.includes("koneksi") || text.includes("timeout") || text.includes("fetch");
}

export function retryDelay(attempt) {
  return Math.min(60_000, 2_000 * (2 ** Math.max(0, attempt)));
}

export function queueStorageKey(userId) {
  if (!userId) throw new Error("userId wajib untuk antrean sinkronisasi");
  return `driver-execution-queue:v1:${userId}`;
}

export function pendingForJob(queue, jobId) {
  return (queue || []).find((item) => item.jobId === jobId) || null;
}

// Kunci de-dupe (audit Slice 2, 23 September 2026) — SATU identitas per
// "job+aksi" (route-start diidentifikasi lewat routeId, bukan jobId, karena
// beberapa job berbagi satu aksi mulai-rute). Dipakai enqueueExecution
// untuk menolak entri kedua kalau entri pertama utk job+aksi yang sama
// masih di antrean (double-tap sebelum tombol sempat disembunyikan UI) —
// akar penyebab item dobel dengan idempotency key berbeda yang ditemukan
// di audit code review.
export function dedupeKey({ action, jobId, routeId }) {
  return action === "route-start" ? `route:${routeId}:${action}` : `job:${jobId}:${action}`;
}

const JOB_SETTLED_STATUSES = ["COMPLETED", "FAILED", "RESCHEDULED"];

// Cocokkan status TERBARU job (dari snapshot GET /armada/my-jobs, sumber
// SAMA yang dipakai seluruh app — bukan endpoint kedua) dengan target aksi
// offline ini. true = aksi sudah efektif tercapai (mis. lewat perangkat
// lain / replay yang lebih dulu sukses) -> aman dibuang dari antrean TANPA
// mengirim ulang mutasinya.
export function isJobActionSatisfied(action, status) {
  if (!status) return false;
  if (action === "start") return status !== "ASSIGNED";
  if (action === "arrive") return status === "ARRIVED" || JOB_SETTLED_STATUSES.includes(status);
  if (action === "complete") return status === "COMPLETED";
  if (action === "fail") return status === "FAILED" || status === "RESCHEDULED";
  return false;
}

const ACTION_LABEL = { start: "Mulai", arrive: "Tiba", complete: "Selesai", fail: "Gagal" };

// Alasan yang bisa dibaca manusia ketika status server TIDAK sesuai target
// aksi — dipakai sebagai lastError item blocked. Selalu dari PERBANDINGAN
// status nyata, tidak pernah menebak (prinsip kejujuran yang sama dipakai
// lastAppSyncAt/"Terakhir ambil data" di tempat lain di app ini).
export function jobActionSupersededReason(action, status) {
  if (action === "complete" && (status === "FAILED" || status === "RESCHEDULED")) {
    return `Job sudah berstatus ${status === "FAILED" ? "Gagal" : "Dijadwalkan Ulang"} di server — tidak bisa ditandai Selesai lagi.`;
  }
  if (action === "fail" && status === "COMPLETED") {
    return "Job sudah berstatus Selesai di server — tidak bisa ditandai Gagal lagi.";
  }
  if (action === "arrive" && status === "ASSIGNED") {
    return "Job masih berstatus Ditugaskan di server — aksi Mulai belum tercatat, coba mulai ulang.";
  }
  return `Status job di server sekarang ${status} — aksi "${ACTION_LABEL[action] || action}" tidak bisa dikonfirmasi otomatis, periksa manual.`;
}

export function isRouteStartSatisfied(status) {
  return status != null && status !== "PUBLISHED";
}

// Klasifikasi 3-arah untuk error pengiriman antrean (audit Slice 2):
// - "retry": transien (401/timeout/jaringan/5xx/lock sementara perangkat
//   lain) — coba lagi nanti, JANGAN blocked.
// - "reconcile": konflik status (409 state-transition atau 409 generik
//   lain) — status job/rute BISA SAJA sudah berubah via sumber lain,
//   verifikasi dulu ke server sebelum memutuskan blocked.
// - "block": benar-benar tidak valid lagi (403 otorisasi, tabrakan
//   idempotency key dgn aksi lain, atau 4xx validasi) — reconciliation
//   status tidak relevan, harus blocked dengan alasan dari server.
export function classifyExecutionError(error) {
  const status = error?.status;
  const message = String(error?.message || error || "");
  if (status === 409) {
    if (message.includes("sedang diproses di perangkat lain")) return { kind: "retry" };
    if (message.includes("Idempotency-Key sudah dipakai")) return { kind: "block", reason: message };
    // Gerbang Checklist Persiapan Perjalanan (bug nyata 10 Oktober 2026,
    // laporan Difa rute RTE-101026-01) — SEBELUM ini jatuh ke "reconcile"
    // generik: reconcileItem route-start cuma mengecek Route.status, yang
    // TIDAK PERNAH berubah selama gerbang checklist menolak (penolakan
    // terjadi SEBELUM Route.status di-update, lihat POST /routes/:id/start)
    // — hasilnya item blocked SELAMANYA dengan pesan "masih PUBLISHED" yang
    // menyesatkan (checklist bisa saja sudah diisi detik berikutnya, server
    // tidak pernah dicoba lagi). Precondisi ini SEPENUHNYA bisa berubah
    // lewat tindakan driver sendiri (isi Bukti Kelengkapan lalu kembali ke
    // app) — persis definisi "retry": antrean otomatis mencoba ulang MUTASI
    // aslinya (bukan cuma GET reconcile) tiap kembali ke foreground/jeda
    // backoff, sampai MAX_RETRY_ATTEMPTS — kalau benar-benar tidak pernah
    // diisi, item akhirnya blocked dengan pesan ASLI dari server (jelas
    // "Checklist ... lengkapi dulu"), bukan pesan generik ini.
    if (error?.code === "CHECKLIST_BELUM_LENGKAP") return { kind: "retry" };
    return { kind: "reconcile" };
  }
  if (status === 403) return { kind: "block", reason: message };
  if (isRetryableExecutionError(error)) return { kind: "retry" };
  return { kind: "block", reason: message || "Gagal sinkronisasi" };
}
