// State job "Sinkronisasi Riwayat Chat" — disimpan di memori (module-level),
// BUKAN tabel DB, karena sifatnya ephemeral (progress sementara, bukan data
// permanen) dan backend cuma 1 proses (tidak perlu shared state lintas
// instance). Kalau backend restart di tengah job, job dianggap hilang —
// dampaknya cuma perlu klik "Sinkronisasi" ulang, bukan kehilangan data
// (Message yang sudah tersimpan tetap ada, idempotent by externalId).
//
// Root cause bug yang diperbaiki modul ini: endpoint sync-history LAMA
// menahan request HTTP sampai SELURUH proses selesai (bisa berapa menit
// utk ratusan chat) — frontend timeout 30 detik duluan, user lihat "Gagal:
// Koneksi timeout" padahal sync-nya sendiri BERHASIL jalan terus di
// belakang layar. Sekarang: start job → langsung return 202, job jalan di
// background, progress dipoll/di-emit terpisah.

let currentJob = null;

export function getJob() {
  return currentJob;
}

export function isJobRunning() {
  return currentJob?.status === "running";
}

// runner: async function(job) — terima objek job supaya bisa update
// job.progress langsung dari dalam loop. TIDAK di-await oleh caller
// (start-and-forget) — itu inti dari fix ini.
export function startJob(runner, { onDone, onError } = {}) {
  const jobId = `sync-${Date.now()}`;
  currentJob = {
    jobId,
    status: "running", // running | done | failed
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: {
      totalChats: 0,
      processedChats: 0,
      newMessages: 0,
      failedChats: 0,
      unsupportedMessages: 0,
      currentChat: null,
    },
    error: null,
  };
  const job = currentJob;

  runner(job)
    .then(() => {
      job.status = "done";
      job.finishedAt = new Date().toISOString();
      onDone?.(job);
    })
    .catch((err) => {
      console.error("[sync-history-job] Gagal:", err.message);
      job.status = "failed";
      job.finishedAt = new Date().toISOString();
      job.error = err.message;
      onError?.(job);
    });

  return job;
}
