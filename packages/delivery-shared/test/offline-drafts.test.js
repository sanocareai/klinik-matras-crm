import test from "node:test";
import assert from "node:assert/strict";
import { createOfflineDraftStore } from "../src/biayaArmada/offlineDrafts.js";

const memStorage = () => { const m = new Map(); return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, removeItem: async (k) => { m.delete(k); }, _m: m }; };
const CFG = { expenseTypes: [{ code: "TOL" }], metadataFields: { TOL: [] } };
const DRAFT = { expenseType: "TOL", amount: 25000, date: "2026-09-24" };
const err = (status, message) => Object.assign(new Error(message), { status });

function fakeApi(over = {}) {
  const calls = [];
  const api = {
    calls,
    create: async (d, k) => { calls.push(["create", k]); return { id: "srv-1" }; },
    uploadBukti: async (id) => { calls.push(["foto", id]); return {}; },
    ajukan: async (id, k) => { calls.push(["ajukan", id, k]); return {}; },
    ...over,
  };
  return api;
}

test("antrean dipisah per pengguna & memakai kunci penyimpanan sendiri", async () => {
  const st = memStorage();
  const a = createOfflineDraftStore({ storage: st, userId: "u1" });
  const b = createOfflineDraftStore({ storage: st, userId: "u2" });
  await a.save(DRAFT);
  assert.equal((await a.list()).length, 1);
  assert.equal((await b.list()).length, 0);
  assert.deepEqual([...st._m.keys()], ["biayaArmada:drafts:u1"]);
  assert.throws(() => createOfflineDraftStore({ storage: st }), /userId wajib/);
});

test("sync sukses: create -> foto -> ajukan, tiap kunci idempotensi dipakai, item SELESAI", async () => {
  const s = createOfflineDraftStore({ storage: memStorage(), userId: "u1" });
  await s.save(DRAFT, { photo: { uri: "file://struk.jpg" } });
  const api = fakeApi();
  const r = await s.sync(api, CFG);
  assert.equal(r[0].ok, true);
  assert.deepEqual(api.calls.map((c) => c[0]), ["create", "foto", "ajukan"]);
  assert.equal((await s.list())[0].status, "SELESAI");
});

test("koneksi putus setelah create: retry MELANJUTKAN (tidak create kedua) dengan kunci yang sama", async () => {
  const s = createOfflineDraftStore({ storage: memStorage(), userId: "u1" });
  await s.save(DRAFT);
  let gagalSekali = true;
  const api = fakeApi({ ajukan: async (id, k) => { api.calls.push(["ajukan", id, k]); if (gagalSekali) { gagalSekali = false; throw err(503, "down"); } return {}; } });
  const r1 = await s.sync(api, CFG);
  assert.equal(r1[0].ok, false);
  assert.equal(r1[0].permanent, false, "5xx boleh dicoba lagi");
  const r2 = await s.sync(api, CFG);
  assert.equal(r2[0].ok, true);
  assert.equal(api.calls.filter((c) => c[0] === "create").length, 1, "create hanya sekali");
  const kunciAjukan = api.calls.filter((c) => c[0] === "ajukan").map((c) => c[2]);
  assert.equal(new Set(kunciAjukan).size, 1, "kunci ajukan sama di kedua percobaan");
});

test("ditolak server 4xx = GAGAL permanen (tidak diulang otomatis), pesan tersimpan", async () => {
  const s = createOfflineDraftStore({ storage: memStorage(), userId: "u1" });
  await s.save(DRAFT);
  const api = fakeApi({ create: async () => { throw err(422, "Kategori belum dipasang"); } });
  await s.sync(api, CFG);
  const item = (await s.list())[0];
  assert.equal(item.status, "GAGAL");
  assert.equal(item.permanent, true);
  assert.equal(item.lastError, "Kategori belum dipasang");
  const before = api.calls.length;
  await s.sync(api, CFG);
  assert.equal(api.calls.length, before, "tidak dicoba lagi");
});

test("draf tidak valid tidak pernah dikirim ke server", async () => {
  const s = createOfflineDraftStore({ storage: memStorage(), userId: "u1" });
  await s.save({ expenseType: "TOL", amount: 0, date: "2026-09-24" });
  const api = fakeApi();
  const r = await s.sync(api, CFG);
  assert.equal(r[0].ok, false);
  assert.equal(api.calls.length, 0);
});

test("401 menghentikan sinkronisasi (sesi berakhir), draf tetap aman di antrean", async () => {
  const s = createOfflineDraftStore({ storage: memStorage(), userId: "u1" });
  await s.save(DRAFT); await s.save(DRAFT);
  const api = fakeApi({ create: async () => { throw err(401, "Sesi berakhir"); } });
  const r = await s.sync(api, CFG);
  assert.equal(r.length, 1, "berhenti di 401");
  assert.equal((await s.list()).length, 2);
  assert.equal((await s.list())[0].permanent, false);
});
