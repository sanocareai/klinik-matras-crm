// Antrean offline untuk aksi driver (Phase 2 — PWA offline queue).
//
// KENAPA IndexedDB, bukan localStorage: aksi yang diantre membawa Blob foto
// & tanda tangan (bisa beberapa MB), localStorage cuma bisa simpan string
// dan kapasitasnya kecil (~5-10MB total). IndexedDB satu-satunya storage
// browser yang bisa simpan Blob langsung tanpa base64-encode (yang bikin
// ukurannya +33% dan lambat di-encode/decode untuk foto).
//
// KENAPA ditulis manual (bukan library seperti idb/Dexie): CLAUDE.md —
// "jangan menambah dependency tanpa bertanya dulu". Kebutuhan di sini kecil
// (satu object store, operasi CRUD dasar), tidak butuh library.
//
// Satu entri antrean = SATU aksi driver yang GAGAL terkirim karena offline:
// { id, jobId, action: "complete"|"fail"|"payment", payload: {...field
// primitif...}, photoBlobs: Blob[], signatureBlob: Blob|null, createdAt }
// Foto/tanda tangan BELUM di-upload saat masuk antrean — itu terjadi saat
// diproses (processQueue), supaya urutan upload-lalu-submit tetap benar
// walau proses sempat terputus di tengah jalan.

const DB_NAME = "sano-offline-queue";
const DB_VERSION = 1;
const STORE = "actions";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function enqueueAction(entry) {
  return withStore("readwrite", (store) => {
    store.add({ ...entry, createdAt: Date.now(), lastError: null });
  });
}

export async function getQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });
}

export async function removeAction(id) {
  return withStore("readwrite", (store) => store.delete(id));
}

export async function markActionError(id, message) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result;
      if (entry) {
        entry.lastError = message;
        store.put(entry);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function queueCount() {
  const all = await getQueue();
  return all.length;
}

// Error jaringan (offline/timeout/DNS) vs error API (validasi, permission,
// dst) — HARUS dibedakan. Error jaringan → antre & coba lagi nanti. Error
// API → sudah pasti akan gagal lagi kalau diulang mentah-mentah (mis. "foto
// wajib diisi"), jadi TIDAK diantre, langsung ditampilkan ke driver supaya
// dia perbaiki di tempat, bukan menumpuk di antrean dan gagal diam-diam
// nanti. `request()` di api.js melempar TypeError murni dari fetch() kalau
// jaringan gagal total (fetch reject sebelum sempat dapat response), beda
// dari Error biasa yang dilempar setelah response JSON diterima.
export function isNetworkError(err) {
  if (!navigator.onLine) return true;
  if (err instanceof TypeError) return true; // fetch() gagal total sebelum ada response
  // api.js membungkus AbortError timeout jadi Error biasa dengan pesan ini
  // (lihat request()/requestFormData() di api.js) — di jaringan jelek,
  // request lebih sering menggantung sampai timeout daripada langsung
  // ditolak, jadi ini sinyal offline yang SAMA pentingnya dengan TypeError.
  if (err.message === "Koneksi timeout — coba lagi") return true;
  return false;
}
