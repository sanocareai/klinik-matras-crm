// Konfirmasi muat unit di aplikasi driver: antrean offline (digabung, urut sebelum Selesai), replay idempoten, gerbang 3/3 · 2/3 · pengecualian beralasan.
// Server dimodelkan in-memory dengan aturan yang SAMA seperti backend (unik per job+unit; gate menolak 409 UNIT_BELUM_DIKONFIRMASI bila ada unit belum dan tanpa alasan ≥5).
import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionQueue } from "./executionQueue.js";
import { classifyExecutionError, isJobActionSatisfied } from "./executionCore.js";
import { progresMuatEfektif, izinSelesai, muatTertunda, bolehKonfirmasiMuat, produkRingkasKartu, labelPenjualPkr } from "./manifestView.js";

const storage = () => { const m = new Map(); return { async getItem(k) { return m.has(k) ? m.get(k) : null; }, async setItem(k, v) { m.set(k, v); } }; };
const fs = () => ({ documentDirectory: "file:///doc/", async makeDirectoryAsync() {}, async copyAsync() {}, async deleteAsync() {} });

/** Server palsu: 3 unit pada job j1; gerbang aktif (mode ketat) bila gate=true. */
function serverPalsu({ gate = true, status = "ARRIVED" } = {}) {
  const dimuat = new Set();
  const unit = ["u1", "u2", "u3"];
  const log = [];
  const api = {
    _log: log, _dimuat: dimuat, _state: { status, selesai: 0, pengecualian: [] },
    async konfirmasiMuatUnit(jobId, data, key) {
      log.push(["unit-load", jobId, data, key]);
      for (const id of (data.semua ? unit : data.unitIds)) dimuat.add(id);
      return { jobId, muat: { dimuat: dimuat.size, total: 3 } };
    },
    async completeArmadaJob(jobId, data, key) {
      log.push(["complete", jobId, data, key]);
      const alasan = String(data.pengecualianUnit?.alasan ?? "").trim();
      if (gate && dimuat.size < 3 && alasan.length < 5) {
        throw Object.assign(new Error(`Barang dimuat ${dimuat.size}/3 unit: konfirmasi semua unit dimuat dulu.`), { status: 409, code: "UNIT_BELUM_DIKONFIRMASI" });
      }
      if (this._state.status === "COMPLETED") return { id: jobId, status: "COMPLETED", replay: true };
      if (gate && dimuat.size < 3) this._state.pengecualian.push(alasan);
      this._state.status = "COMPLETED"; this._state.selesai += 1;
      return { id: jobId, status: "COMPLETED" };
    },
    async getMyJobs() { return { jobs: [{ id: "j1", status: this._state.status }], routes: [] }; },
  };
  return api;
}
const makeQ = (api) => createExecutionQueue({ storage: storage(), fs: fs(), api });
const job = (extra = {}) => ({
  id: "j1", type: "DELIVERY", status: "ARRIVED",
  manifest: {
    stop: 1, unit: 3, jenisProduk: 1, ringkas: "1 stop • 3 unit • 1 jenis produk",
    baris: [{ qty: 3, nama: "Kasur Sorong 3in1 Custom", ukuran: "100 × 200 cm", spesifikasi: "", unit: [
      { id: "u1", label: "U1", dimuat: false }, { id: "u2", label: "U2", dimuat: false }, { id: "u3", label: "U3", dimuat: false }] }],
    sumber: { penjual: "Kemal", label: "Penjualan Karyawan — dijual oleh Kemal", picLead: "Rifki" },
    muat: { dimuat: 0, total: 3, lengkap: false, label: "Barang dimuat 0/3 unit" },
  },
  ...extra,
});

test("kartu: produk dari manifest ('3× … — 100 × 200 cm'), penjual 'Dijual oleh Kemal' (bukan Rifki)", () => {
  assert.equal(produkRingkasKartu(job()), "3× Kasur Sorong 3in1 Custom — 100 × 200 cm");
  assert.equal(labelPenjualPkr(job()), "Dijual oleh Kemal");
  assert.equal(labelPenjualPkr({}), null);
});

test("kasus 3/3: semua dikonfirmasi → selesai tanpa pengecualian, gerbang aktif", async () => {
  const api = serverPalsu({ gate: true });
  const q = makeQ(api);
  await q.enqueueExecution({ userId: "u", jobId: "j1", action: "unit-load", payload: { semua: true } });
  await q.enqueueExecution({ userId: "u", jobId: "j1", action: "complete", payload: { recipientName: "Pak Indra" } });
  const r = await q.flushExecutionQueue("u");
  assert.equal(r.synced, 2);
  assert.equal(api._state.status, "COMPLETED");
  assert.deepEqual(api._log.map((l) => l[0]), ["unit-load", "complete"], "urutan antrean: muat dulu, baru selesai");
  assert.equal(api._state.pengecualian.length, 0);
});

test("kasus 2/3: gerbang menolak → item BLOCKED dengan pesan server (bukan konflik status), job tetap ARRIVED", async () => {
  const api = serverPalsu({ gate: true });
  const q = makeQ(api);
  await q.enqueueExecution({ userId: "u", jobId: "j1", action: "unit-load", payload: { unitIds: ["u1", "u2"] } });
  await q.enqueueExecution({ userId: "u", jobId: "j1", action: "complete", payload: { recipientName: "Pak Indra" } });
  await q.flushExecutionQueue("u");
  const sisa = await q.readExecutionQueue("u");
  assert.equal(sisa.length, 1);
  assert.equal(sisa[0].blocked, true);
  assert.match(sisa[0].lastError, /2\/3 unit/);
  assert.equal(api._state.status, "ARRIVED");
  assert.deepEqual(classifyExecutionError({ status: 409, code: "UNIT_BELUM_DIKONFIRMASI", message: "x" }).kind, "block");
});

test("pengecualian beralasan: 2/3 + alasan ≥5 → selesai dan alasan dikirim apa adanya (audit di server)", async () => {
  const api = serverPalsu({ gate: true });
  const q = makeQ(api);
  await q.enqueueExecution({ userId: "u", jobId: "j1", action: "unit-load", payload: { unitIds: ["u1", "u2"] } });
  await q.enqueueExecution({ userId: "u", jobId: "j1", action: "complete", payload: { recipientName: "Pak Indra", pengecualianUnit: { alasan: "U3 dititip di gudang, disepakati customer" } } });
  const r = await q.flushExecutionQueue("u");
  assert.equal(r.synced, 2);
  assert.equal(api._state.status, "COMPLETED");
  assert.deepEqual(api._state.pengecualian, ["U3 dititip di gudang, disepakati customer"]);
});

test("offline: konfirmasi muat bertahan di antrean saat jaringan putus, lalu terkirim; replay tidak menggandakan unit/job", async () => {
  const api = serverPalsu({ gate: true });
  let offline = true;
  const asli = api.konfirmasiMuatUnit.bind(api);
  api.konfirmasiMuatUnit = async (...a) => { if (offline) throw Object.assign(new Error("Network request failed"), {}); return asli(...a); };
  const q = makeQ(api);
  await q.enqueueExecution({ userId: "u", jobId: "j1", action: "unit-load", payload: { unitIds: ["u1"] } });
  await q.flushExecutionQueue("u");
  let sisa = await q.readExecutionQueue("u");
  assert.equal(sisa.length, 1);
  assert.equal(sisa[0].blocked, false, "gangguan jaringan = retry, bukan blocked");
  // progres efektif memperlihatkan unit tertunda sebagai tercentang
  const p = progresMuatEfektif(job(), sisa);
  assert.equal(p.dimuat, 1);
  assert.equal(p.tertunda, 1);
  assert.match(p.label, /Barang dimuat 1\/3 unit \(menunggu sinkron\)/);
  // konfirmasi lagi saat masih offline → DIGABUNG ke entri yang sama (satu kunci)
  const kunci = sisa[0].idempotencyKey;
  const gabung = await q.enqueueExecution({ userId: "u", jobId: "j1", action: "unit-load", payload: { unitIds: ["u2"] } });
  assert.equal(gabung.idempotencyKey, kunci);
  assert.deepEqual([...gabung.payload.unitIds].sort(), ["u1", "u2"]);
  offline = false;
  await q.flushExecutionQueue("u");
  assert.equal((await q.readExecutionQueue("u")).length, 0);
  assert.equal(api._dimuat.size, 2);
  // replay (kunci sama dikirim ulang oleh sinkronisasi ganda) → tetap 2 unit, tidak ada efek samping
  await api.konfirmasiMuatUnit("j1", { unitIds: ["u1", "u2"] }, kunci);
  assert.equal(api._dimuat.size, 2);
});

test("muat untuk job yang sudah SELESAI di server dianggap tuntas (antrean bersih, bukan macet)", async () => {
  assert.equal(isJobActionSatisfied("unit-load", "COMPLETED"), true);
  assert.equal(isJobActionSatisfied("unit-load", "ARRIVED"), false);
  const api = serverPalsu({ gate: true, status: "COMPLETED" });
  api.konfirmasiMuatUnit = async () => { throw Object.assign(new Error("Job berstatus COMPLETED — konfirmasi muat tidak diterima"), { status: 409, code: "STATUS_JOB_TIDAK_VALID" }); };
  const q = makeQ(api);
  await q.enqueueExecution({ userId: "u", jobId: "j1", action: "unit-load", payload: { semua: true } });
  const r = await q.flushExecutionQueue("u");
  assert.equal(r.synced, 1);
  assert.equal((await q.readExecutionQueue("u")).length, 0);
});

test("keputusan tombol Selesai (izinSelesai): gerbang tidak aktif → bebas; 3/3 → boleh; 2/3 → tolak; 2/3 + alasan → pengecualian", () => {
  const j = job();
  assert.equal(izinSelesai({ job: j, queue: [], gerbangAktif: false }).boleh, true);
  assert.equal(izinSelesai({ job: j, queue: [], gerbangAktif: true }).boleh, false);
  const semua = [{ jobId: "j1", action: "unit-load", payload: { semua: true } }];
  assert.equal(izinSelesai({ job: j, queue: semua, gerbangAktif: true }).boleh, true);
  const dua = [{ jobId: "j1", action: "unit-load", payload: { unitIds: ["u1", "u2"] } }];
  const tolak = izinSelesai({ job: j, queue: dua, gerbangAktif: true });
  assert.equal(tolak.boleh, false);
  assert.match(tolak.pesan, /2\/3 unit/);
  assert.match(tolak.pesan, /U3/);
  assert.equal(izinSelesai({ job: j, queue: dua, gerbangAktif: true, alasan: "abc" }).boleh, false, "alasan < 5 huruf ditolak");
  const ok = izinSelesai({ job: j, queue: dua, gerbangAktif: true, alasan: "  U3 dititip   di gudang " });
  assert.equal(ok.boleh, true);
  assert.equal(ok.pakaiPengecualian, true);
  assert.equal(ok.alasan, "U3 dititip di gudang");
  // PICKUP tidak terkena
  assert.equal(izinSelesai({ job: job({ type: "PICKUP" }), queue: [], gerbangAktif: true }).boleh, true);
});

test("muat tertunda mengabaikan item blocked dan job lain; konfirmasi hanya untuk DELIVERY berjalan", () => {
  const q = [
    { jobId: "j1", action: "unit-load", blocked: true, payload: { unitIds: ["u1"] } },
    { jobId: "j9", action: "unit-load", payload: { semua: true } },
  ];
  const t = muatTertunda(q, "j1");
  assert.equal(t.semua, false);
  assert.equal(t.unitIds.size, 0);
  assert.equal(bolehKonfirmasiMuat(job()), true);
  assert.equal(bolehKonfirmasiMuat(job({ status: "COMPLETED" })), false);
  assert.equal(bolehKonfirmasiMuat(job({ type: "PICKUP" })), false);
});
