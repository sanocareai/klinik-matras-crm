// Test lifecycle/race background GPS (audit crash Android 3-4 Okt 2026) — pakai
// createTrackingLifecycle({...}) dengan fake yang BISA DIKENDALIKAN kapan resolve
// (deferred promises), BUKAN expo-location/expo-task-manager asli (keduanya butuh
// runtime RN, tidak jalan di `node --test` biasa — lihat komentar di kepala
// trackingLifecycle.js). LOGIKA yang diuji (gerbang AppState, cek-sebelum-minta
// izin, serialisasi, abaikan hasil basi, status jujur) PERSIS SAMA dengan yang
// jalan di HP, pola sama dengan executionQueue.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { createTrackingLifecycle, STATUS } from "./trackingLifecycle.js";

function defer() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function createFakeDeps(overrides = {}) {
  const calls = [];
  let appState = "active";
  let tersedia = true;
  let berjalan = false; // status FGS "nyata" di fake ini
  let fgGranted = false;
  let bgGranted = false;
  let statuses = [];

  const base = {
    backgroundTrackingTersedia: () => { calls.push(["tersedia"]); return tersedia; },
    sudahBerjalanBackgroundTracking: async () => { calls.push(["sudahBerjalan"]); return berjalan; },
    mulaiBackgroundTracking: async (jobIds) => { calls.push(["mulai", [...jobIds]]); berjalan = true; return true; },
    hentikanBackgroundTracking: async () => { calls.push(["hentikan"]); berjalan = false; },
    getForegroundPermission: async () => { calls.push(["getFg"]); return { status: fgGranted ? "granted" : "denied" }; },
    requestForegroundPermission: async () => { calls.push(["requestFg"]); fgGranted = true; return { status: "granted" }; },
    getBackgroundPermission: async () => { calls.push(["getBg"]); return { status: bgGranted ? "granted" : "denied" }; },
    requestBackgroundPermission: async () => { calls.push(["requestBg"]); bgGranted = true; return { status: "granted" }; },
    getAppState: () => appState,
    onStatusChange: (s) => statuses.push(s),
  };
  const deps = { ...base, ...overrides };
  return {
    deps,
    calls,
    statuses,
    setAppState: (s) => { appState = s; },
    setTersedia: (v) => { tersedia = v; },
    setBerjalan: (v) => { berjalan = v; },
    setFgGranted: (v) => { fgGranted = v; },
    setBgGranted: (v) => { bgGranted = v; },
    isBerjalan: () => berjalan,
  };
}

test("izin SUDAH granted: start langsung jalan TANPA pernah memanggil request* (cek dulu, jangan minta ulang)", async () => {
  const f = createFakeDeps();
  f.setFgGranted(true);
  f.setBgGranted(true);
  const lc = createTrackingLifecycle(f.deps);
  await lc.update({ isOnline: true, activeJobIds: ["j1"] });

  assert.equal(lc.getStatus(), STATUS.BACKGROUND);
  assert.ok(f.calls.some((c) => c[0] === "mulai"));
  assert.ok(!f.calls.some((c) => c[0] === "requestFg"), "requestForegroundPermission TIDAK BOLEH dipanggil kalau sudah granted");
  assert.ok(!f.calls.some((c) => c[0] === "requestBg"), "requestBackgroundPermission TIDAK BOLEH dipanggil kalau sudah granted");
});

test("app di BACKGROUND saat job jadi EN_ROUTE: tidak minta izin, tidak start FGS — status waiting-for-active", async () => {
  const f = createFakeDeps();
  f.setAppState("background");
  const lc = createTrackingLifecycle(f.deps);
  await lc.update({ isOnline: true, activeJobIds: ["j1"] });

  assert.equal(lc.getStatus(), STATUS.WAITING_FOR_ACTIVE);
  assert.ok(!f.calls.some((c) => c[0] === "getFg" || c[0] === "requestFg"), "tidak boleh menyentuh izin sama sekali selagi background");
  assert.ok(!f.calls.some((c) => c[0] === "mulai"), "tidak boleh memulai FGS selagi background");
});

test("app kembali ke foreground setelah menunggu: tracking baru benar-benar mulai saat itu, bukan sebelumnya", async () => {
  const f = createFakeDeps();
  f.setAppState("background");
  f.setFgGranted(true);
  f.setBgGranted(true);
  const lc = createTrackingLifecycle(f.deps);
  await lc.update({ isOnline: true, activeJobIds: ["j1"] });
  assert.equal(lc.getStatus(), STATUS.WAITING_FOR_ACTIVE);

  f.setAppState("active");
  await lc.appStateMenjadiAktif();

  assert.equal(lc.getStatus(), STATUS.BACKGROUND);
  assert.ok(f.calls.some((c) => c[0] === "mulai"));
});

test("izin lokasi ditolak permanen: status error, bukan diam-diam dianggap jalan", async () => {
  const f = createFakeDeps(); // fgGranted tetap false, requestForegroundPermission TIDAK di-override jadi granted
  const lc = createTrackingLifecycle({
    ...f.deps,
    requestForegroundPermission: async () => { f.calls.push(["requestFg"]); return { status: "denied" }; },
  });
  await lc.update({ isOnline: true, activeJobIds: ["j1"] });

  assert.equal(lc.getStatus(), STATUS.ERROR);
  assert.ok(!f.calls.some((c) => c[0] === "mulai"));
});

test("izin background ditolak (foreground granted): jalur cadangan foreground-only, BUKAN error", async () => {
  const f = createFakeDeps();
  f.setFgGranted(true); // foreground sudah ada
  const lc = createTrackingLifecycle({
    ...f.deps,
    requestBackgroundPermission: async () => { f.calls.push(["requestBg"]); return { status: "denied" }; },
  });
  await lc.update({ isOnline: true, activeJobIds: ["j1"] });

  assert.equal(lc.getStatus(), STATUS.FOREGROUND_ONLY);
  assert.ok(!f.calls.some((c) => c[0] === "mulai"), "tidak boleh start FGS kalau izin background ditolak");
});

test("mulaiBackgroundTracking gagal (native start error): status error jujur, bukan background palsu", async () => {
  const f = createFakeDeps();
  f.setFgGranted(true);
  f.setBgGranted(true);
  const lc = createTrackingLifecycle({
    ...f.deps,
    mulaiBackgroundTracking: async () => { f.calls.push(["mulai"]); return false; },
  });
  await lc.update({ isOnline: true, activeJobIds: ["j1"] });

  assert.equal(lc.getStatus(), STATUS.ERROR);
});

test("tracking yang SUDAH jalan: update job list TANPA pernah menyentuh izin sama sekali", async () => {
  const f = createFakeDeps();
  f.setBerjalan(true); // FGS sudah aktif dari sebelumnya (mis. resume dari background)
  const lc = createTrackingLifecycle(f.deps);
  await lc.update({ isOnline: true, activeJobIds: ["j1", "j2"] });

  assert.equal(lc.getStatus(), STATUS.BACKGROUND);
  assert.ok(!f.calls.some((c) => c[0] === "getFg" || c[0] === "requestFg" || c[0] === "getBg" || c[0] === "requestBg"));
  assert.ok(f.calls.some((c) => c[0] === "mulai" && c[1].includes("j2")), "daftar job tetap diperbarui");
});

test("tracking yang sudah jalan TETAP lanjut saat AppState background — Home ditekan tidak menghentikannya", async () => {
  const f = createFakeDeps();
  f.setFgGranted(true);
  f.setBgGranted(true);
  const lc = createTrackingLifecycle(f.deps);
  await lc.update({ isOnline: true, activeJobIds: ["j1"] });
  assert.equal(lc.getStatus(), STATUS.BACKGROUND);
  assert.ok(f.isBerjalan());

  // Driver menekan Home — AppState berubah, TAPI isOnline/job TIDAK berubah.
  f.setAppState("background");
  // Tidak ada pemicu update()/appStateMenjadiAktif() di sini secara sengaja:
  // AppState berubah sendiri TIDAK PERNAH memicu stop — hanya isOnline/job yang bisa.
  assert.equal(lc.getStatus(), STATUS.BACKGROUND, "status tidak boleh berubah hanya karena AppState berubah");
  assert.ok(f.isBerjalan(), "FGS tidak boleh dihentikan hanya karena app di background");
  assert.ok(!f.calls.some((c) => c[0] === "hentikan"));
});

test("offline mid-flight: start yang sudah terlanjur berjalan (menunggu dialog izin) diabaikan begitu diketahui basi", async () => {
  const f = createFakeDeps();
  const gateFg = defer();
  const reachedGate = defer();
  const lc = createTrackingLifecycle({
    ...f.deps,
    requestForegroundPermission: async () => {
      f.calls.push(["requestFg:mulai"]);
      reachedGate.resolve(); // sinyal ke test: BENAR-BENAR sudah sampai menunggu dialog izin
      await gateFg.promise; // disimulasikan driver lama menjawab dialog sistem
      f.calls.push(["requestFg:selesai"]);
      return { status: "granted" };
    },
  });

  const p = lc.update({ isOnline: true, activeJobIds: ["j1"] });
  await reachedGate.promise; // tunggu sampai jalankanEnsure() SUNGGUH di titik menunggu dialog
  assert.equal(lc.getStatus(), STATUS.STARTING);

  // BARU SEKARANG driver mematikan Online (atau logout) — selagi dialog izin masih menggantung.
  lc.update({ isOnline: false, activeJobIds: [] });

  gateFg.resolve(); // driver akhirnya menjawab dialog izin LAMA
  await p;
  await new Promise((r) => setTimeout(r, 0)); // biarkan sisa chain (update kedua) jalan

  assert.equal(lc.getStatus(), STATUS.IDLE, "hasil izin yang basi tidak boleh menghasilkan BACKGROUND setelah driver sudah offline");
  assert.ok(!f.calls.some((c) => c[0] === "mulai"), "start FGS tidak boleh terjadi sama sekali untuk niat yang sudah basi");
  assert.ok(f.calls.some((c) => c[0] === "hentikan"), "harus benar-benar memastikan tracking berhenti untuk state offline yang terbaru");
});

test("job tidak lagi EN_ROUTE mid-flight (reschedule/selesai): start yang sudah berjalan diabaikan", async () => {
  const f = createFakeDeps();
  f.setFgGranted(true);
  f.setBgGranted(true);
  const gateMulai = defer();
  const reachedGate = defer();
  const lc = createTrackingLifecycle({
    ...f.deps,
    mulaiBackgroundTracking: async (jobIds) => {
      f.calls.push(["mulai:mulai", [...jobIds]]);
      reachedGate.resolve(); // sinyal: sudah benar-benar memulai FGS (bukan sekadar terjadwal)
      await gateMulai.promise;
      f.calls.push(["mulai:selesai"]);
      return true;
    },
  });

  const p = lc.update({ isOnline: true, activeJobIds: ["j1"] });
  await reachedGate.promise; // tunggu sampai start FGS SUNGGUH sedang berlangsung
  assert.equal(lc.getStatus(), STATUS.STARTING);

  // BARU SEKARANG job tersebut berubah status (selesai/di-reschedule) — SELAGI start masih berlangsung.
  lc.update({ isOnline: true, activeJobIds: [] });
  gateMulai.resolve();
  await p;
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(lc.getStatus(), STATUS.IDLE, "job yang sudah tidak EN_ROUTE lagi tidak boleh berakhir BACKGROUND");
});

test("serialisasi: dua update() beruntun TIDAK PERNAH overlap (operasi kedua menunggu operasi pertama tuntas)", async () => {
  const f = createFakeDeps();
  f.setFgGranted(true);
  f.setBgGranted(true);
  let sedangJalan = 0;
  let overlapTerdeteksi = false;
  const lc = createTrackingLifecycle({
    ...f.deps,
    sudahBerjalanBackgroundTracking: async () => {
      sedangJalan += 1;
      if (sedangJalan > 1) overlapTerdeteksi = true;
      await new Promise((r) => setTimeout(r, 5));
      sedangJalan -= 1;
      return false;
    },
  });

  await Promise.all([
    lc.update({ isOnline: true, activeJobIds: ["j1"] }),
    lc.update({ isOnline: true, activeJobIds: ["j1", "j2"] }),
    lc.update({ isOnline: false, activeJobIds: [] }),
  ]);

  assert.equal(overlapTerdeteksi, false, "dua jalankanEnsure() tidak boleh berjalan bersamaan");
});

test("destroy() (unmount/logout) menghentikan tracking walau pemicu TERAKHIR masih \"online + ada job\"", async () => {
  const f = createFakeDeps();
  f.setFgGranted(true);
  f.setBgGranted(true);
  const lc = createTrackingLifecycle(f.deps);
  await lc.update({ isOnline: true, activeJobIds: ["j1"] });
  assert.equal(lc.getStatus(), STATUS.BACKGROUND);

  await lc.destroy();
  assert.equal(lc.getStatus(), STATUS.IDLE);
  assert.ok(f.calls.some((c) => c[0] === "hentikan"));
});

test("destroy() di tengah start yang masih menunggu dialog izin: start basi tidak pernah dianggap sukses", async () => {
  const f = createFakeDeps();
  const gateFg = defer();
  const lc = createTrackingLifecycle({
    ...f.deps,
    requestForegroundPermission: async () => { await gateFg.promise; return { status: "granted" }; },
  });

  const p = lc.update({ isOnline: true, activeJobIds: ["j1"] });
  const d = lc.destroy(); // logout terjadi SELAGI dialog izin masih menggantung
  gateFg.resolve();
  await Promise.all([p, d]);

  assert.equal(lc.getStatus(), STATUS.IDLE);
  assert.ok(!f.calls.some((c) => c[0] === "mulai"));
});

test("update() setelah destroy() diabaikan (tidak membangunkan tracking lagi)", async () => {
  const f = createFakeDeps();
  f.setFgGranted(true);
  f.setBgGranted(true);
  const lc = createTrackingLifecycle(f.deps);
  await lc.destroy();
  await lc.update({ isOnline: true, activeJobIds: ["j1"] });

  assert.equal(lc.getStatus(), STATUS.IDLE);
  assert.ok(!f.calls.some((c) => c[0] === "mulai"), "update() pasca-destroy tidak boleh memulai apa pun");
});

test("modul native belum tersedia (APK lama, OTA duluan): langsung foreground-only, tidak pernah menyentuh izin", async () => {
  const f = createFakeDeps();
  f.setTersedia(false);
  const lc = createTrackingLifecycle(f.deps);
  await lc.update({ isOnline: true, activeJobIds: ["j1"] });

  assert.equal(lc.getStatus(), STATUS.FOREGROUND_ONLY);
  assert.ok(!f.calls.some((c) => c[0] === "getFg" || c[0] === "sudahBerjalan"));
});
