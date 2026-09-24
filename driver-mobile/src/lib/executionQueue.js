import {
  classifyExecutionError,
  createIdempotencyKey,
  dedupeKey,
  isJobActionSatisfied,
  isRouteStartSatisfied,
  jobActionSupersededReason,
  queueStorageKey,
} from "./executionCore.js";

// Antrean eksekusi offline — dibungkus sebagai FACTORY (audit Slice 2, 23
// September 2026), SENGAJA TANPA import AsyncStorage/expo-file-system/api
// asli di file ini (ketiganya butuh runtime RN sungguhan, gagal di-resolve
// `node --test` biasa — persis alasan kenapa controlTowerRules.js di web
// tidak boleh mengimpor file .jsx, lihat catatan di sana). Instance
// PRODUKSI (storage=AsyncStorage, fs=expo-file-system, api=api.js asli)
// dibuat satu kali di context/ExecutionSyncContext.js — SATU-SATUNYA
// pemanggil createExecutionQueue() di luar test, lihat komentar di sana.
// Test membuat instance TERPISAH dengan storage/fs/api palsu in-memory —
// LOGIKA yang diuji (mutex per user, dedupe, reconcile 409, checkpoint
// upload) PERSIS SAMA dengan yang jalan di HP, bukan simulasi kasar.
export function createExecutionQueue({ storage, fs, api: client }) {
  const MAX_RETRY_ATTEMPTS = 5;
  const listeners = new Set();
  const userLocks = new Map();

  function emit(userId, queue) {
    for (const listener of listeners) listener(userId, queue);
  }

  function subscribeExecutionQueue(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // Serialisasi SEMUA mutasi antrean per user (temuan HIGH audit: enqueue
  // ganda hampir bersamaan bisa saling menimpa lewat read-modify-write
  // AsyncStorage biasa — "lost update"). Setiap enqueue/flush/discard/
  // reconcile untuk userId yang SAMA dirangkai jadi satu antrean promise
  // berurutan; userId BEDA tidak saling menunggu. `next` (yang dikembalikan
  // ke pemanggil) boleh reject seperti biasa, tapi EKOR yang disimpan di
  // `userLocks` sengaja ditelan supaya satu operasi gagal tidak mem-block
  // operasi berikutnya untuk user yang sama selamanya.
  function withUserLock(userId, fn) {
    const prior = userLocks.get(userId) || Promise.resolve();
    const next = prior.then(fn, fn);
    userLocks.set(
      userId,
      next.then(
        () => {},
        () => {}
      )
    );
    return next;
  }

  async function readExecutionQueue(userId) {
    const raw = await storage.getItem(queueStorageKey(userId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeQueue(userId, queue) {
    await storage.setItem(queueStorageKey(userId), JSON.stringify(queue));
    emit(userId, queue);
  }

  async function stagePhotos(userId, idempotencyKey, photos) {
    if (!photos?.length) return [];
    const root = `${fs.documentDirectory}driver-execution/${encodeURIComponent(userId)}/${idempotencyKey}/`;
    await fs.makeDirectoryAsync(root, { intermediates: true });
    const staged = [];
    for (let i = 0; i < photos.length; i += 1) {
      const source = photos[i];
      const target = `${root}${i}.jpg`;
      await fs.copyAsync({ from: source.uri, to: target });
      staged.push({ uri: target, type: "image/jpeg", name: `${idempotencyKey}-${i}.jpg` });
    }
    return staged;
  }

  async function cleanupItem(item) {
    const first = item.photos?.[0]?.uri;
    if (!first) return;
    const dir = first.slice(0, first.lastIndexOf("/") + 1);
    try {
      await fs.deleteAsync(dir, { idempotent: true });
    } catch {}
  }

  async function enqueueExecution({
    userId, deviceId, readerMode = "V1", baseRevision = null, baseRouteRevision = null,
    jobId = null, routeId = null, action, payload = {}, photos = [],
  }) {
    return withUserLock(userId, async () => {
      // Entri V1 lama (dibuat build sebelum field deviceId ada) tetap dapat
      // direplay. Semua enqueue runtime baru menyuntik deviceId dari Auth;
      // V2 menolaknya keras bila metadata perangkat tidak tersedia.
      if (readerMode === "V2" && !deviceId) throw new Error("Device ID wajib untuk antrean offline V2");
      if (readerMode === "V2" && action !== "route-start" && !Number.isInteger(baseRevision)) {
        throw Object.assign(new Error("Revision job V2 tidak tersedia; refresh data sebelum mengirim aksi"), { code: "BASE_REVISION_REQUIRED" });
      }
      if (readerMode === "V2" && action === "route-start" && !Number.isInteger(baseRouteRevision)) {
        throw Object.assign(new Error("Revision route V2 tidak tersedia; refresh data sebelum memulai rute"), { code: "BASE_REVISION_REQUIRED" });
      }
      const queue = await readExecutionQueue(userId);
      const key = dedupeKey({ action, jobId, routeId });
      const existing = queue.find((entry) => dedupeKey(entry) === key);
      // Duplikat aksi yang sama masih di antrean (mis. double-tap sebelum UI
      // sempat menyembunyikan tombol, atau AppState listener dan tap manual
      // hampir bersamaan) — pakai entri PERTAMA apa adanya, JANGAN buat
      // idempotency key baru (itu akar penyebab item dobel yang ditemukan
      // di audit code review). Foto pada percobaan kedua tidak pernah
      // di-stage ke disk (dibuang begitu saja) — entri pertama sudah
      // membawa foto yang sama, form belum berubah antar dua tap.
      if (existing) return existing;

      const idempotencyKey = createIdempotencyKey(userId.slice(0, 8));
      const staged = await stagePhotos(userId, idempotencyKey, photos);
      const item = {
        idempotencyKey,
        jobId,
        routeId,
        action,
        readerMode,
        deviceId,
        baseRevision,
        baseRouteRevision,
        payload,
        photos: staged,
        uploadedUrls: [],
        createdAt: new Date().toISOString(),
        attempts: 0,
        lastError: null,
        blocked: false,
        syncState: "PENDING",
      };
      queue.push(item);
      await writeQueue(userId, queue);
      return item;
    });
  }

  async function uploadRemaining(userId, item, queue) {
    for (let i = item.uploadedUrls.length; i < item.photos.length; i += 1) {
      const result = await client.uploadJobPhoto(item.jobId, item.photos[i]);
      const url = result.urls?.[0] || result.url;
      if (!url) throw new Error("Server tidak mengembalikan URL foto");
      item.uploadedUrls.push(url);
      await writeQueue(userId, queue); // checkpoint setelah tiap file; retry tidak upload ulang file yang sudah sukses.
    }
  }

  async function sendItem(item) {
    const locationPayload = item.payload.location ? { location: item.payload.location } : {};
    const meta = {
      readerMode: item.readerMode || "V1",
      deviceId: item.deviceId,
      baseRevision: item.baseRevision,
      baseRouteRevision: item.baseRouteRevision,
    };
    if (item.action === "route-start") {
      return client.startRoute(item.routeId, { proofPhotoUrls: item.uploadedUrls }, item.idempotencyKey, meta);
    }
    if (item.action === "start") return client.startArmadaJob(item.jobId, { proofPhotoUrls: item.uploadedUrls }, item.idempotencyKey, meta);
    if (item.action === "arrive") return client.arriveArmadaJob(item.jobId, locationPayload, item.idempotencyKey, meta);
    if (item.action === "complete") {
      return client.completeArmadaJob(
        item.jobId,
        {
          proofPhotoUrls: item.uploadedUrls,
          recipientName: item.payload.recipientName,
          note: item.payload.note,
          ...locationPayload,
        },
        item.idempotencyKey,
        meta
      );
    }
    if (item.action === "fail") {
      return client.failArmadaJob(
        item.jobId,
        {
          failureReason: item.payload.failureReason,
          failurePhotoUrls: item.uploadedUrls,
          note: item.payload.note,
          ...locationPayload,
        },
        item.idempotencyKey,
        meta
      );
    }
    throw Object.assign(new Error(`Aksi antrean tidak dikenal: ${item.action}`), { status: 400 });
  }

  // Cocokkan status TERBARU di server (snapshot route-centric yang SAMA
  // dipakai seluruh app, GET /armada/my-jobs — BUKAN sumber data kedua)
  // dengan target aksi item ini.
  // { resolved: true }              -> aksi sudah efektif tercapai (lewat
  //                                     perangkat/replay lain), aman dibuang
  //                                     dari antrean tanpa mengirim ulang.
  // { resolved: false, reason }     -> benar-benar tidak valid lagi, blocked
  //                                     dengan alasan yang bisa dibaca.
  // { resolved: false, reason:null }-> verifikasi ke server sendiri gagal
  //                                     (mis. offline lagi) — BUKAN bukti
  //                                     aksi tidak valid, jangan blocked
  //                                     berdasarkan dugaan.
  async function reconcileItem(item) {
    let snapshot;
    try {
      if (item.readerMode === "V2") {
        const routes = [];
        let cursor = null;
        do {
          const page = await client.getDriverV2Snapshot(cursor, 25);
          routes.push(...(page.items || []));
          cursor = page.hasMore ? page.nextSnapshotCursor : null;
        } while (cursor);
        snapshot = {
          routes: routes.map((route) => ({ id: route.routeId, status: route.routeStatus })),
          jobs: routes.flatMap((route) => route.jobs || []),
        };
      } else {
        snapshot = await client.getMyJobs();
      }
    } catch {
      return { resolved: false, reason: null };
    }
    if (item.action === "route-start") {
      const route = (snapshot?.routes || []).find((r) => r.id === item.routeId);
      if (!route) return { resolved: false, reason: "Rute tidak ditemukan di data terbaru — periksa manual di Route Planner." };
      if (isRouteStartSatisfied(route.status)) return { resolved: true };
      return { resolved: false, reason: `Rute masih berstatus ${route.status} di server — belum bisa dikonfirmasi otomatis.` };
    }
    const job = (snapshot?.jobs || []).find((j) => j.id === item.jobId);
    if (!job) return { resolved: false, reason: "Job tidak ditemukan di data terbaru (mungkin di luar rentang tanggal aktif) — periksa manual." };
    if (isJobActionSatisfied(item.action, job.status)) return { resolved: true };
    return { resolved: false, reason: jobActionSupersededReason(item.action, job.status) };
  }

  async function flushExecutionQueue(userId) {
    if (!userId) return { synced: 0, pending: 0 };
    return withUserLock(userId, async () => {
      let synced = 0;
      const queue = await readExecutionQueue(userId);
      let index = 0;
      while (index < queue.length) {
        const item = queue[index];
        if (item.blocked) {
          // Blocked bukan lagi status permanen (audit HIGH) — tiap flush
          // (otomatis maupun tombol "Kirim Ulang") mencoba VERIFIKASI ulang
          // ke server dulu (GET, tidak mengirim ulang mutasinya) sebelum
          // menyerah lagi. Kalau ternyata sudah tercapai (mis. dispatcher
          // membetulkan dari web), item ini beres sendiri tanpa driver
          // perlu tahu detailnya.
          const outcome = await reconcileItem(item);
          if (outcome.resolved) {
            await cleanupItem(item);
            queue.splice(index, 1);
            synced += 1;
            await writeQueue(userId, queue);
            continue;
          }
          if (outcome.reason != null && outcome.reason !== item.lastError) {
            queue[index] = { ...item, lastError: outcome.reason };
            await writeQueue(userId, queue);
          }
          index += 1;
          continue;
        }
        try {
          await uploadRemaining(userId, item, queue);
          await sendItem(item);
          await cleanupItem(item);
          queue.splice(index, 1);
          synced += 1;
          await writeQueue(userId, queue);
        } catch (error) {
          const verdict = classifyExecutionError(error);
          if (verdict.kind === "retry") {
            const attempts = item.attempts + 1;
            const exhausted = attempts >= MAX_RETRY_ATTEMPTS;
            queue[index] = {
              ...item,
              attempts,
              lastError: exhausted ? `Percobaan otomatis dihentikan setelah ${MAX_RETRY_ATTEMPTS} kali: ${error.message || "Gagal sinkronisasi"}` : (error.message || "Gagal sinkronisasi"),
              blocked: exhausted,
              syncState: exhausted ? "RETRY_EXHAUSTED" : "PENDING",
            };
            await writeQueue(userId, queue);
            // 401/token kedaluwarsa, jaringan, timeout, 5xx, atau lock
            // sementara krn perangkat lain: hentikan batch di sini,
            // pertahankan URUTAN antrean untuk percobaan berikutnya —
            // item SETELAH ini mungkin bergantung urutan (mis. start lalu
            // arrive job yang sama).
            break;
          }
          if (verdict.kind === "reconcile") {
            const outcome = await reconcileItem(item);
            if (outcome.resolved) {
              await cleanupItem(item);
              queue.splice(index, 1);
              synced += 1;
              await writeQueue(userId, queue);
              continue;
            }
            if (outcome.reason == null) {
              // Verifikasi sendiri gagal (mis. jaringan putus lagi tepat
              // setelah respons 409 pertama) — bukan bukti aksi tidak
              // valid, perlakukan seperti retry biasa, JANGAN blocked
              // berdasarkan dugaan.
              queue[index] = { ...item, attempts: item.attempts + 1, lastError: error.message || "Gagal sinkronisasi", blocked: false, syncState: "PENDING" };
              await writeQueue(userId, queue);
              break;
            }
            queue[index] = { ...item, attempts: item.attempts + 1, blocked: true, syncState: "CONFLICT", lastError: outcome.reason };
            await writeQueue(userId, queue);
            // Konflik status utk item ini SUDAH final (blocked dengan
            // alasan jelas) — bukan error transien yang butuh menghentikan
            // seluruh batch, lanjut proses item lain.
            index += 1;
            continue;
          }
          // kind === "block" — 403 otorisasi, tabrakan idempotency key,
          // atau validasi 4xx: benar-benar tidak valid lagi, reconciliation
          // status tidak relevan.
          queue[index] = { ...item, attempts: item.attempts + 1, blocked: true, syncState: "CONFLICT", lastError: verdict.reason || error.message || "Gagal sinkronisasi" };
          await writeQueue(userId, queue);
          index += 1;
        }
      }
      return { synced, pending: queue.length };
    });
  }

  async function removeExecution(userId, idempotencyKey) {
    return withUserLock(userId, async () => {
      const queue = await readExecutionQueue(userId);
      const item = queue.find((entry) => entry.idempotencyKey === idempotencyKey);
      if (item) await cleanupItem(item);
      const next = queue.filter((entry) => entry.idempotencyKey !== idempotencyKey);
      await writeQueue(userId, next);
    });
  }

  // "Periksa status terbaru" (tombol per-item saat blocked, JobCard/
  // RouteStartCard) — cek ULANG satu item terhadap server tanpa mengirim
  // ulang aksi mutasinya sendiri. Membalas `verified:false` kalau
  // pengecekannya sendiri gagal (mis. offline) supaya UI bisa bilang "coba
  // lagi" alih-alih menampilkan alasan blocked lama seolah baru diperiksa.
  async function reconcileOne(userId, idempotencyKey) {
    return withUserLock(userId, async () => {
      const queue = await readExecutionQueue(userId);
      const idx = queue.findIndex((entry) => entry.idempotencyKey === idempotencyKey);
      if (idx === -1) return { resolved: true, verified: true };
      const item = queue[idx];
      const outcome = await reconcileItem(item);
      if (outcome.resolved) {
        await cleanupItem(item);
        queue.splice(idx, 1);
        await writeQueue(userId, queue);
        return { resolved: true, verified: true };
      }
      if (outcome.reason == null) {
        return { resolved: false, verified: false, reason: item.lastError };
      }
      queue[idx] = { ...item, blocked: true, syncState: "CONFLICT", lastError: outcome.reason };
      await writeQueue(userId, queue);
      return { resolved: false, verified: true, reason: outcome.reason };
    });
  }

  // "Bersihkan antrean bermasalah" (Akun, audit poin 6) — buang HANYA item
  // blocked + file temporernya. Item pending yang masih sah (menunggu
  // sinyal/token/5xx server) TIDAK disentuh sama sekali.
  async function clearBlocked(userId) {
    return withUserLock(userId, async () => {
      const queue = await readExecutionQueue(userId);
      const blocked = queue.filter((entry) => entry.blocked);
      if (blocked.length === 0) return { removed: 0 };
      const remaining = queue.filter((entry) => !entry.blocked);
      for (const item of blocked) await cleanupItem(item);
      await writeQueue(userId, remaining);
      return { removed: blocked.length };
    });
  }

  return {
    subscribeExecutionQueue,
    readExecutionQueue,
    enqueueExecution,
    flushExecutionQueue,
    removeExecution,
    reconcileOne,
    clearBlocked,
  };
}
