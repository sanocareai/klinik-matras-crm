// Antrean ping GPS driver (D-034) — SENGAJA TERPISAH dari offlineQueue.js.
//
// offlineQueue.js pakai IndexedDB karena aksi driver (complete/fail/payment)
// membawa Blob foto/tanda tangan yang bisa beberapa MB. Ping GPS cuma
// beberapa angka (~50 byte/entri) dan datang tiap 2 menit selama job
// aktif (PRD FR-L-06) — localStorage jauh lebih sederhana untuk beban itu,
// dan tidak butuh skema async IndexedDB untuk data sekecil ini.
//
// CAP jumlah entri (MAX_QUEUED): driver bisa saja offline berjam-jam di
// area sinyal buruk (skenario yang sudah disebut di komentar
// KirimLokasiModal soal driver & sinyal). Tanpa batas, antrean bisa tumbuh
// ribuan entri dan mendekati kuota localStorage (~5-10MB) — begitu dibatasi,
// yang dibuang adalah entri PALING LAMA (riwayat rute berkurang presisinya,
// tapi tidak pernah membuat localStorage penuh/error).

const KEY = "sano-position-queue";
const MAX_QUEUED = 500;

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return []; // localStorage rusak/diblokir (mode privat) — mulai kosong, jangan crash
  }
}

function writeAll(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* kuota penuh/mode privat — ping ini hilang, tapi aplikasi tetap jalan */
  }
}

export function enqueuePosition(jobId, { lat, lng, accuracy, recordedAt }) {
  const entries = readAll();
  entries.push({ jobId, lat, lng, accuracy: accuracy ?? null, recordedAt });
  // Buang yang PALING LAMA kalau melebihi cap — lihat catatan MAX_QUEUED.
  while (entries.length > MAX_QUEUED) entries.shift();
  writeAll(entries);
}

// Kirim SEMUA ping yang tertunda, dikelompokkan per job (satu request per
// job, isinya banyak ping — lihat POST /armada/jobs/:id/positions).
// Kosongkan antrean HANYA untuk job yang berhasil terkirim; job yang
// requestnya gagal (jaringan putus di tengah) tetap di antrean untuk
// dicoba lagi nanti.
export async function flushPositions(sendFn) {
  const entries = readAll();
  if (entries.length === 0) return { sent: 0, failed: 0 };

  const byJob = new Map();
  for (const e of entries) {
    if (!byJob.has(e.jobId)) byJob.set(e.jobId, []);
    byJob.get(e.jobId).push(e);
  }

  let sent = 0, failed = 0;
  const stillQueued = [];
  for (const [jobId, pings] of byJob) {
    try {
      await sendFn(jobId, pings);
      sent += pings.length;
    } catch {
      stillQueued.push(...pings);
      failed += pings.length;
    }
  }
  writeAll(stillQueued);
  return { sent, failed };
}
