// Test antrean eksekusi offline (audit Slice 2, 23 September 2026) — pakai
// createExecutionQueue({storage, fs, api}) dengan fake in-memory, BUKAN
// AsyncStorage/expo-file-system/api asli (keduanya butuh runtime RN
// sungguhan, tidak jalan di bawah `node --test` biasa). LOGIKA yang diuji
// (mutex per user, dedupe, reconcile 409, checkpoint upload) PERSIS SAMA
// dengan yang jalan di HP — lihat komentar di kepala executionQueue.js.
import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionQueue } from "./executionQueue.js";

function createFakeStorage() {
  const store = new Map();
  return {
    async getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
  };
}

function createFakeFs() {
  const files = new Set();
  const deleted = [];
  return {
    documentDirectory: "file:///doc/",
    async makeDirectoryAsync() {},
    async copyAsync({ to }) {
      files.add(to);
    },
    async deleteAsync(path) {
      deleted.push(path);
      for (const f of [...files]) if (f.startsWith(path)) files.delete(f);
    },
    _files: files,
    _deleted: deleted,
  };
}

function createFakeApi(overrides = {}) {
  const calls = [];
  const base = {
    async uploadJobPhoto(jobId, file) {
      calls.push(["uploadJobPhoto", jobId, file.name]);
      return { url: `/media/job-photos/${file.name}` };
    },
    async startRoute(routeId, data, key, meta) {
      calls.push(["startRoute", routeId, data, key, meta]);
      return { started: 1 };
    },
    async startArmadaJob(jobId, data, key, meta) {
      calls.push(["startArmadaJob", jobId, data, key, meta]);
      return { id: jobId, status: "EN_ROUTE" };
    },
    async arriveArmadaJob(jobId, data, key, meta) {
      calls.push(["arriveArmadaJob", jobId, data, key, meta]);
      return { id: jobId, status: "ARRIVED" };
    },
    async completeArmadaJob(jobId, data, key, meta) {
      calls.push(["completeArmadaJob", jobId, data, key, meta]);
      return { id: jobId, status: "COMPLETED" };
    },
    async failArmadaJob(jobId, data, key, meta) {
      calls.push(["failArmadaJob", jobId, data, key, meta]);
      return { id: jobId, status: "FAILED" };
    },
    async getMyJobs() {
      return { jobs: [], routes: [] };
    },
  };
  const merged = { ...base, ...overrides };
  merged._calls = calls;
  return merged;
}

function makeQueue(overrides = {}) {
  return createExecutionQueue({
    storage: createFakeStorage(),
    fs: createFakeFs(),
    api: createFakeApi(overrides.apiOverrides),
    ...overrides,
  });
}

test("double-tap/enqueue paralel untuk job+aksi sama menghasilkan satu item dan satu key", async () => {
  const q = makeQueue();
  const input = { userId: "u1", jobId: "j1", action: "complete", payload: { recipientName: "Budi" }, photos: [] };
  const [a, b] = await Promise.all([q.enqueueExecution(input), q.enqueueExecution(input)]);
  assert.equal(a.idempotencyKey, b.idempotencyKey);
  const queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 1);
});

test("enqueue paralel untuk job berbeda tidak saling menimpa (serialisasi per user)", async () => {
  const q = makeQueue();
  const jobs = ["j1", "j2", "j3", "j4", "j5"];
  await Promise.all(jobs.map((jobId) => q.enqueueExecution({ userId: "u1", jobId, action: "start", payload: {}, photos: [] })));
  const queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 5);
  assert.deepEqual(new Set(queue.map((i) => i.jobId)), new Set(jobs));
});

test("flush sukses: item terkirim dan hilang dari antrean", async () => {
  const api = createFakeApi();
  const q = createExecutionQueue({ storage: createFakeStorage(), fs: createFakeFs(), api });
  await q.enqueueExecution({ userId: "u1", jobId: "j1", action: "arrive", payload: { location: null }, photos: [] });
  const result = await q.flushExecutionQueue("u1");
  assert.equal(result.synced, 1);
  assert.equal((await q.readExecutionQueue("u1")).length, 0);
  assert.ok(api._calls.some((c) => c[0] === "arriveArmadaJob"));
});

test("checkpoint upload: foto yang sudah sukses tidak diunggah ulang setelah gagal di tengah", async () => {
  let uploadCallCount = 0;
  let failIndex1 = true;
  const api = createFakeApi({
    async uploadJobPhoto(jobId, file) {
      uploadCallCount += 1;
      if (file.name.includes("-1") && failIndex1) throw Object.assign(new Error("Koneksi timeout"), {});
      return { url: `/media/job-photos/${file.name}` };
    },
  });
  const q = createExecutionQueue({ storage: createFakeStorage(), fs: createFakeFs(), api });
  await q.enqueueExecution({
    userId: "u1",
    jobId: "j1",
    action: "complete",
    payload: { recipientName: "Budi" },
    photos: [{ uri: "file:///cam/a.jpg" }, { uri: "file:///cam/b.jpg" }],
  });

  const first = await q.flushExecutionQueue("u1");
  assert.equal(first.synced, 0);
  let queue = await q.readExecutionQueue("u1");
  assert.equal(queue[0].uploadedUrls.length, 1); // foto ke-0 sudah checkpoint sukses
  assert.equal(queue[0].blocked, false); // timeout = retry, bukan blocked
  assert.equal(uploadCallCount, 2); // foto-0 sukses, foto-1 gagal

  failIndex1 = false;
  const second = await q.flushExecutionQueue("u1");
  assert.equal(second.synced, 1);
  assert.equal(uploadCallCount, 3); // TIDAK mengunggah ulang foto-0, cuma foto-1
});

test("401, jaringan, dan 5xx tetap pending (tidak blocked)", async () => {
  const errors = [
    Object.assign(new Error("Sesi berakhir"), { status: 401 }),
    Object.assign(new Error("Server error: boom"), { status: 502 }),
    Object.assign(new Error("Koneksi timeout — coba lagi"), {}),
  ];
  for (const err of errors) {
    const api = createFakeApi({ async startArmadaJob() { throw err; } });
    const q = createExecutionQueue({ storage: createFakeStorage(), fs: createFakeFs(), api });
    await q.enqueueExecution({ userId: "u1", jobId: "j1", action: "start", payload: {}, photos: [] });
    const result = await q.flushExecutionQueue("u1");
    assert.equal(result.synced, 0);
    const queue = await q.readExecutionQueue("u1");
    assert.equal(queue.length, 1);
    assert.equal(queue[0].blocked, false);
    assert.equal(queue[0].attempts, 1);
  }
});

test("409 state-conflict tapi status server sudah sesuai target -> dianggap selesai", async () => {
  const api = createFakeApi({
    async completeArmadaJob() {
      throw Object.assign(new Error("Job berstatus COMPLETED, tidak bisa menjalankan aksi COMPLETE"), { status: 409 });
    },
    async getMyJobs() {
      return { jobs: [{ id: "j1", status: "COMPLETED" }], routes: [] };
    },
  });
  const q = createExecutionQueue({ storage: createFakeStorage(), fs: createFakeFs(), api });
  await q.enqueueExecution({ userId: "u1", jobId: "j1", action: "complete", payload: { recipientName: "Budi" }, photos: [] });
  const result = await q.flushExecutionQueue("u1");
  assert.equal(result.synced, 1);
  assert.equal((await q.readExecutionQueue("u1")).length, 0);
});

test("409 state-conflict dan status server TIDAK sesuai target -> blocked dengan alasan jelas", async () => {
  const api = createFakeApi({
    async completeArmadaJob() {
      throw Object.assign(new Error("Job berstatus EN_ROUTE, tidak bisa menjalankan aksi COMPLETE"), { status: 409 });
    },
    async getMyJobs() {
      return { jobs: [{ id: "j1", status: "FAILED" }], routes: [] };
    },
  });
  const q = createExecutionQueue({ storage: createFakeStorage(), fs: createFakeFs(), api });
  await q.enqueueExecution({ userId: "u1", jobId: "j1", action: "complete", payload: { recipientName: "Budi" }, photos: [] });
  const result = await q.flushExecutionQueue("u1");
  assert.equal(result.synced, 0);
  const queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].blocked, true);
  assert.match(queue[0].lastError, /Gagal/);
});

test("409 gerbang Checklist Persiapan Perjalanan (CHECKLIST_BELUM_LENGKAP) saat route-start -> RETRY (bukan blocked permanen dgn pesan generik menyesatkan)", async () => {
  // Bug nyata 10 Oktober 2026 (laporan Difa, rute RTE-101026-01): SEBELUM
  // perbaikan ini, 409 CHECKLIST_BELUM_LENGKAP jatuh ke klasifikasi
  // "reconcile" generik -> reconcileItem cuma mengecek Route.status, yang
  // TIDAK PERNAH berubah selama checklist belum diisi (penolakan terjadi
  // SEBELUM Route.status di-update) -> item blocked SELAMANYA dengan pesan
  // "Rute masih berstatus PUBLISHED..." yang menyesatkan (precondisi
  // sebenarnya bisa berubah lewat tindakan driver sendiri). Sekarang
  // diklasifikasi "retry": antrean MENCOBA ULANG MUTASI aslinya (bukan GET
  // reconcile) tiap kembali ke app, sampai MAX_RETRY_ATTEMPTS — kalau
  // checklist akhirnya diisi, percobaan berikutnya sukses TANPA driver
  // perlu tahu detailnya. Kalau benar-benar tidak pernah diisi, item
  // akhirnya blocked dengan pesan ASLI dari server (jelas "lengkapi dulu"),
  // bukan pesan generik status rute.
  const chk = Object.assign(
    new Error("Checklist persiapan belum lengkap: Bukti Kelengkapan (foto plastik/tali/tools, dll) — lengkapi dulu sebelum memulai perjalanan"),
    { status: 409, code: "CHECKLIST_BELUM_LENGKAP" },
  );
  const api = createFakeApi({
    async startRoute() { throw chk; },
    async getMyJobs() {
      return { jobs: [], routes: [{ id: "r1", status: "PUBLISHED" }] };
    },
  });
  const q = makeQueue({ apiOverrides: api });
  await q.enqueueExecution({ userId: "u1", jobId: "j1", routeId: "r1", action: "route-start", payload: {}, photos: [] });

  const result = await q.flushExecutionQueue("u1");
  assert.equal(result.synced, 0);
  let queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].blocked, false, "percobaan pertama TIDAK blocked -- precondisi masih bisa berubah");
  assert.equal(queue[0].lastErrorCode, "CHECKLIST_BELUM_LENGKAP");
  assert.match(queue[0].lastError, /Checklist persiapan belum lengkap/, "pesan ASLI dari server, bukan pesan generik status rute");

  // Habiskan sisa percobaan otomatis (checklist tidak pernah diisi di test
  // ini) -- pada titik ini (dan HANYA pada titik ini) item boleh blocked.
  for (let i = 1; i < 5; i += 1) await q.flushExecutionQueue("u1");
  queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].blocked, true, "setelah MAX_RETRY_ATTEMPTS percobaan otomatis dihentikan, baru blocked");
  assert.equal(queue[0].syncState, "RETRY_EXHAUSTED");
  assert.match(queue[0].lastError, /Checklist persiapan belum lengkap/, "pesan akhir tetap pesan ASLI server, bukan status rute");
});

test("409 gerbang Checklist Persiapan Perjalanan: setelah driver mengisi checklist, percobaan otomatis berikutnya sukses tanpa intervensi", async () => {
  let sudahDiisi = false;
  const api = createFakeApi({
    async startRoute() {
      if (!sudahDiisi) {
        throw Object.assign(new Error("Checklist persiapan belum lengkap: lengkapi dulu sebelum memulai perjalanan"), { status: 409, code: "CHECKLIST_BELUM_LENGKAP" });
      }
      return { started: 1 };
    },
    async getMyJobs() {
      return { jobs: [], routes: [{ id: "r1", status: "PUBLISHED" }] };
    },
  });
  const q = makeQueue({ apiOverrides: api });
  await q.enqueueExecution({ userId: "u1", jobId: "j1", routeId: "r1", action: "route-start", payload: {}, photos: [] });

  await q.flushExecutionQueue("u1");
  let queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].blocked, false);

  sudahDiisi = true; // driver mengisi Bukti Kelengkapan di layar lain
  const result = await q.flushExecutionQueue("u1");
  assert.equal(result.synced, 1, "percobaan otomatis berikutnya langsung sukses, tanpa driver perlu tahu detailnya");
  queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 0);
});

test("route-start blocked ('Tidak ada job Siap Dimulai' 409) tapi SEMUA job rute itu sudah diproses satu-satu lewat jalur job lepas -> moot, dianggap selesai", async () => {
  // Route.status TIDAK PERNAH di-update kalau target.length===0 (lihat
  // POST /routes/:id/start, throw terjadi SEBELUM tx.route.update) --
  // reconcile LAMA cuma mengecek Route.status (tetap PUBLISHED selamanya)
  // -> item blocked SELAMANYA walau aksi batch ini sudah tidak relevan
  // (tidak ada stop ASSIGNED tersisa untuk ditempeli foto muatan, semua
  // sudah jalan individual lewat POST /jobs/:id/start yang memang tidak
  // pernah butuh route-start sukses lebih dulu).
  const api = createFakeApi({
    async startRoute() {
      throw Object.assign(new Error("Tidak ada job 'Siap Dimulai' di rute ini"), { status: 409 });
    },
    async getMyJobs() {
      return {
        jobs: [
          { id: "j1", routeId: "r1", status: "COMPLETED" },
          { id: "j2", routeId: "r1", status: "EN_ROUTE" },
        ],
        routes: [{ id: "r1", status: "PUBLISHED" }],
      };
    },
  });
  const q = makeQueue({ apiOverrides: api });
  await q.enqueueExecution({ userId: "u1", jobId: "j1", routeId: "r1", action: "route-start", payload: {}, photos: [] });
  const result = await q.flushExecutionQueue("u1");
  assert.equal(result.synced, 1, "moot -- dibuang tanpa dikirim ulang, bukan blocked");
  assert.equal((await q.readExecutionQueue("u1")).length, 0);
});

test("route-start blocked ('Tidak ada job Siap Dimulai' 409) dan MASIH ada job ASSIGNED di rute itu -> tetap blocked (bukan moot sungguhan)", async () => {
  const api = createFakeApi({
    async startRoute() {
      throw Object.assign(new Error("Tidak ada job 'Siap Dimulai' di rute ini"), { status: 409 });
    },
    async getMyJobs() {
      return {
        jobs: [{ id: "j1", routeId: "r1", status: "ASSIGNED" }],
        routes: [{ id: "r1", status: "PUBLISHED" }],
      };
    },
  });
  const q = makeQueue({ apiOverrides: api });
  await q.enqueueExecution({ userId: "u1", jobId: "j1", routeId: "r1", action: "route-start", payload: {}, photos: [] });
  const result = await q.flushExecutionQueue("u1");
  assert.equal(result.synced, 0);
  const queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].blocked, true);
});

test("item blocked bisa di-refresh (reconcileOne) dan di-discard, tidak mengunci job permanen", async () => {
  const api = createFakeApi({
    async arriveArmadaJob() {
      throw Object.assign(new Error("Bukan job Anda"), { status: 403 });
    },
    async getMyJobs() {
      return { jobs: [{ id: "j1", status: "ASSIGNED" }], routes: [] };
    },
  });
  const q = createExecutionQueue({ storage: createFakeStorage(), fs: createFakeFs(), api });
  await q.enqueueExecution({ userId: "u1", jobId: "j1", action: "arrive", payload: {}, photos: [] });
  await q.flushExecutionQueue("u1");
  let queue = await q.readExecutionQueue("u1");
  assert.equal(queue[0].blocked, true);

  // "Periksa Status Terbaru" -- status server masih ASSIGNED (arrive belum
  // tercapai) -> tetap blocked, tapi TIDAK crash dan item tetap ada (bisa
  // dicoba lagi), bukan hilang diam-diam.
  const check = await q.reconcileOne("u1", queue[0].idempotencyKey);
  assert.equal(check.resolved, false);
  assert.equal(check.verified, true);
  queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 1);

  // "Batalkan Antrean Ini" -- job ini sekarang bebas untuk aksi baru.
  await q.removeExecution("u1", queue[0].idempotencyKey);
  queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 0);
});

test("antrean terisolasi per user", async () => {
  const q = makeQueue();
  await q.enqueueExecution({ userId: "u1", jobId: "j1", action: "start", payload: {}, photos: [] });
  await q.enqueueExecution({ userId: "u2", jobId: "j1", action: "start", payload: {}, photos: [] });
  const q1 = await q.readExecutionQueue("u1");
  const q2 = await q.readExecutionQueue("u2");
  assert.equal(q1.length, 1);
  assert.equal(q2.length, 1);
  assert.notEqual(q1[0].idempotencyKey, q2[0].idempotencyKey);
});

test("discard/removeExecution menghapus hanya file item itu, item lain aman", async () => {
  const fs = createFakeFs();
  const q = createExecutionQueue({ storage: createFakeStorage(), fs, api: createFakeApi() });
  const a = await q.enqueueExecution({ userId: "u1", jobId: "j1", action: "complete", payload: {}, photos: [{ uri: "file:///cam/1.jpg" }] });
  const b = await q.enqueueExecution({ userId: "u1", jobId: "j2", action: "complete", payload: {}, photos: [{ uri: "file:///cam/2.jpg" }] });
  await q.removeExecution("u1", a.idempotencyKey);
  const queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].idempotencyKey, b.idempotencyKey);
  assert.ok(fs._deleted.some((d) => d.includes(a.idempotencyKey)));
  assert.ok(!fs._deleted.some((d) => d.includes(b.idempotencyKey)));
});

test("clearBlocked hanya membuang item blocked, item pending valid lainnya aman", async () => {
  const api = createFakeApi({
    async startArmadaJob(jobId) {
      if (jobId === "j1") throw Object.assign(new Error("Bukan job Anda"), { status: 403 });
      throw Object.assign(new Error("Koneksi timeout"), {});
    },
  });
  const q = createExecutionQueue({ storage: createFakeStorage(), fs: createFakeFs(), api });
  await q.enqueueExecution({ userId: "u1", jobId: "j1", action: "start", payload: {}, photos: [] });
  await q.enqueueExecution({ userId: "u1", jobId: "j2", action: "start", payload: {}, photos: [] });
  await q.flushExecutionQueue("u1");

  let queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 2);
  assert.equal(queue.find((i) => i.jobId === "j1").blocked, true);
  assert.equal(queue.find((i) => i.jobId === "j2").blocked, false);

  const result = await q.clearBlocked("u1");
  assert.equal(result.removed, 1);
  queue = await q.readExecutionQueue("u1");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].jobId, "j2");
});

test("queue V2 menyimpan device/revision dan meneruskannya ke command", async () => {
  const api = createFakeApi();
  const q = createExecutionQueue({ storage: createFakeStorage(), fs: createFakeFs(), api });
  await q.enqueueExecution({
    userId: "u1", deviceId: "device-1", readerMode: "V2", baseRevision: 7,
    jobId: "j1", action: "start", payload: {}, photos: [],
  });
  const queued = await q.readExecutionQueue("u1");
  assert.equal(queued[0].deviceId, "device-1");
  assert.equal(queued[0].baseRevision, 7);
  await q.flushExecutionQueue("u1");
  const call = api._calls.find((item) => item[0] === "startArmadaJob");
  assert.equal(call[4].readerMode, "V2");
  assert.equal(call[4].baseRevision, 7);
});

test("queue V2 menolak revision/device kosong dan membatasi retry otomatis", async () => {
  const transient = Object.assign(new Error("Koneksi timeout"), {});
  const api = createFakeApi({ async startArmadaJob() { throw transient; } });
  const q = createExecutionQueue({ storage: createFakeStorage(), fs: createFakeFs(), api });
  await assert.rejects(q.enqueueExecution({ userId: "u1", readerMode: "V2", baseRevision: 1, jobId: "j1", action: "start" }), /Device ID/);
  await assert.rejects(q.enqueueExecution({ userId: "u1", deviceId: "d1", readerMode: "V2", jobId: "j1", action: "start" }), /Revision/);
  await q.enqueueExecution({ userId: "u1", deviceId: "d1", readerMode: "V2", baseRevision: 1, jobId: "j1", action: "start" });
  for (let i = 0; i < 5; i += 1) await q.flushExecutionQueue("u1");
  const [item] = await q.readExecutionQueue("u1");
  assert.equal(item.blocked, true);
  assert.equal(item.syncState, "RETRY_EXHAUSTED");
  assert.equal(item.attempts, 5);
});

test("histori waktu: waktu KEJADIAN dari antrean (saat tombol ditekan) ikut terkirim walau baru tersinkron belakangan; retry memakai waktu yang sama", async () => {
  const api = createFakeApi();
  const q = createExecutionQueue({ storage: createFakeStorage(), fs: createFakeFs(), api });
  const item = await q.enqueueExecution({ userId: "u1", jobId: "j1", action: "arrive", payload: { location: null }, photos: [] });
  await new Promise((r) => setTimeout(r, 15)); // simulasi: terkirim belakangan (offline)
  await q.flushExecutionQueue("u1");
  const call = api._calls.find((c) => c[0] === "arriveArmadaJob");
  assert.equal(call[4].occurredAt, item.createdAt, "waktu kejadian = createdAt item antrean, bukan waktu kirim");
  assert.ok(new Date(call[4].occurredAt).getTime() < Date.now(), "tidak memakai waktu sekarang");
});
