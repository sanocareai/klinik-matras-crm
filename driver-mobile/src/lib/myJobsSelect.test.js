// Regresi audit 29 Okt 2026, target 2 & 4: blank/spinner tab Aktif.
// selectMyJobsState adalah fungsi murni (tanpa react-query/React) hasil
// ekstraksi dari hooks/useMyJobs.js — lihat komentar kronologi bug di
// lib/myJobsSelect.js. 7 skenario di sini PERSIS daftar yang diminta:
// 1. refetch gagal + cache tersedia -> job tetap tampil
// 2. reader-config gagal -> tidak spinner permanen
// 3. error tanpa cache -> error state dengan tombol coba lagi (data tetap undefined)
// 4-7. variasi readerMode/userId berubah, config settle, dst.
import test from "node:test";
import assert from "node:assert/strict";
import { INITIAL_MY_JOBS_STATE, selectMyJobsState } from "./myJobsSelect.js";

function baseInput(overrides = {}) {
  return {
    principalReady: true,
    userId: "u1",
    configData: { readerMode: "V1" },
    configError: null,
    configLoading: false,
    configFetching: false,
    configRefetching: false,
    v1: { data: undefined, error: null, isLoading: false, isFetching: false, isRefetching: false, dataUpdatedAt: 0 },
    v2: { data: undefined, error: null, isLoading: false, isFetching: false, isRefetching: false, dataUpdatedAt: 0 },
    ...overrides,
  };
}

test("refetch gagal TAPI cache valid tersedia -> data cache tetap tampil, bukan undefined", () => {
  const first = selectMyJobsState(INITIAL_MY_JOBS_STATE, baseInput({
    v1: { data: { jobs: [{ id: "j1" }] }, error: null, isLoading: false, isFetching: false, isRefetching: false, dataUpdatedAt: 100 },
  }));
  assert.deepEqual(first.result.data, { jobs: [{ id: "j1" }] });
  assert.equal(first.result.error, null);

  // Refetch berikutnya GAGAL (timeout/5xx) -- react-query v1Query.data TETAP
  // berisi cache lama (perilaku bawaannya), tapi SEBELUM fix ini useMyJobs
  // sendiri yang membuang data jadi undefined hanya karena ada error.
  const second = selectMyJobsState(first.state, baseInput({
    v1: { data: { jobs: [{ id: "j1" }] }, error: new Error("Request timeout"), isLoading: false, isFetching: false, isRefetching: true, dataUpdatedAt: 100 },
  }));
  assert.deepEqual(second.result.data, { jobs: [{ id: "j1" }] }, "cache lama tetap tampil walau refetch gagal");
  assert.ok(second.result.error, "error tetap diteruskan supaya UI bisa tampilkan indikator non-blocking");
  assert.equal(second.result.isLoading, false, "TIDAK fullscreen spinner -- sudah pernah ada data");
  assert.equal(second.result.hasEverLoaded, true);
});

test("reader-config gagal permanen (settled ke error) -> tidak spinner permanen", () => {
  // Config query sudah selesai mencoba dan gagal -- isLoading/isFetching
  // SAMA-SAMA false (settled), readerMode tidak pernah terisi.
  const result = selectMyJobsState(INITIAL_MY_JOBS_STATE, baseInput({
    configData: undefined,
    configError: new Error("Gagal memuat konfigurasi"),
    configLoading: false,
    configFetching: false,
  })).result;
  assert.equal(result.readerMode, null);
  assert.equal(result.isLoading, false, "config sudah settled ke error -- tidak boleh macet loading selamanya");
  assert.ok(result.error);
  assert.equal(result.data, undefined, "belum pernah ada data sama sekali -- error state penuh, bukan cache palsu");
});

test("error TANPA cache sama sekali -> error state murni (data tetap undefined, bukan dipaksa kosong diam-diam)", () => {
  const result = selectMyJobsState(INITIAL_MY_JOBS_STATE, baseInput({
    v1: { data: undefined, error: new Error("Network request failed"), isLoading: false, isFetching: false, isRefetching: false, dataUpdatedAt: 0 },
  })).result;
  assert.equal(result.data, undefined);
  assert.ok(result.error);
  assert.equal(result.hasEverLoaded, false);
  assert.equal(result.isLoading, false, "sudah settled (bukan isLoading) -- UI menampilkan layar error + tombol coba lagi, bukan spinner");
});

test("belum pernah ada data & config masih fetching -> isLoading true (fullscreen spinner wajar, belum ada apa-apa)", () => {
  const result = selectMyJobsState(INITIAL_MY_JOBS_STATE, baseInput({
    configData: undefined,
    configLoading: true,
    configFetching: true,
    v1: { data: undefined, error: null, isLoading: false, isFetching: false, isRefetching: false, dataUpdatedAt: 0 },
  })).result;
  assert.equal(result.isLoading, true);
  assert.equal(result.hasEverLoaded, false);
});

test("readerMode persisten lintas render -- config berikutnya error tidak mereset ke null", () => {
  const first = selectMyJobsState(INITIAL_MY_JOBS_STATE, baseInput({
    configData: { readerMode: "V2" },
    v2: { data: { jobs: [] }, error: null, isLoading: false, isFetching: false, isRefetching: false, dataUpdatedAt: 50 },
  }));
  assert.equal(first.result.readerMode, "V2");

  const second = selectMyJobsState(first.state, baseInput({
    configData: undefined, // config refetch gagal, data hilang
    configError: new Error("timeout"),
    v2: { data: { jobs: [] }, error: null, isLoading: false, isFetching: false, isRefetching: false, dataUpdatedAt: 50 },
  }));
  assert.equal(second.result.readerMode, "V2", "readerMode yang sudah diperoleh TIDAK reset ke null hanya karena config berikutnya error");
});

test("ganti user (logout/login akun lain) -> cache lama DIBUANG walau belum ada error", () => {
  const first = selectMyJobsState(INITIAL_MY_JOBS_STATE, baseInput({
    userId: "u1",
    v1: { data: { jobs: [{ id: "j1" }] }, error: null, isLoading: false, isFetching: false, isRefetching: false, dataUpdatedAt: 10 },
  }));
  assert.ok(first.result.data);

  const second = selectMyJobsState(first.state, baseInput({
    userId: "u2",
    v1: { data: undefined, error: null, isLoading: true, isFetching: true, isRefetching: false, dataUpdatedAt: 0 },
  }));
  assert.equal(second.result.data, undefined, "data user lama tidak boleh bocor ke sesi user baru");
  assert.equal(second.result.hasEverLoaded, false);
});

test("V2_RECOVERY_REQUIRED tetap dilaporkan saat V2 error, cache (jika ada) tetap tampil berbarengan", () => {
  const first = selectMyJobsState(INITIAL_MY_JOBS_STATE, baseInput({
    configData: { readerMode: "V2" },
    v2: { data: { jobs: [{ id: "j1" }] }, error: null, isLoading: false, isFetching: false, isRefetching: false, dataUpdatedAt: 10 },
  }));
  const second = selectMyJobsState(first.state, baseInput({
    configData: { readerMode: "V2" },
    v2: { data: { jobs: [{ id: "j1" }] }, error: Object.assign(new Error("snapshot rusak"), { code: "V2_SNAPSHOT_INVALID" }), isLoading: false, isFetching: false, isRefetching: true, dataUpdatedAt: 10 },
  }));
  assert.equal(second.result.recoveryState, "V2_RECOVERY_REQUIRED");
  assert.deepEqual(second.result.data, { jobs: [{ id: "j1" }] }, "recovery state tidak menyembunyikan cache yang masih valid");
});
