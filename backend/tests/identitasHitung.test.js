import test from "node:test";
import assert from "node:assert/strict";
import { turunkanIdentitas, AKSI_PERIKSA_HITUNGAN } from "../src/services/identitasHitung.js";
import { gabungStockCount, hitungPreview } from "../src/services/opnameCutover.js";

const t = (menit) => new Date(Date.UTC(2026, 9, 20, 2, menit));
const isi = (actorId, lineId, qty, m) => ({ actorId, createdAt: t(m), metadata: { aksi: "HASIL_HITUNG_DIISI", lineId, countedQtyBaru: qty } });
const serah = (actorId, m) => ({ actorId, createdAt: t(m), metadata: { aksi: "HITUNGAN_DISERAHKAN" } });
const periksa = (actorId, m) => ({ actorId, createdAt: t(m), metadata: { aksi: AKSI_PERIKSA_HITUNGAN } });
const reset = (m, materialId = "mat-1") => ({ actorId: "x", createdAt: t(m), metadata: { aksi: "TANDA_DIRESET", materialId } });

test("penghitung = akun yang memasukkan angka/menyerahkan; pemeriksa = akun lain sesudah diserahkan", () => {
  const r = turunkanIdentitas([isi("A", "L1", 10, 1), isi("A", "L2", 5, 2), serah("A", 3), periksa("B", 4)]);
  assert.deepEqual(r.penghitung, ["A"]);
  assert.deepEqual([...r.pemeriksa.keys()], ["B"]);
  assert.deepEqual([...r.penghitungPerBaris.get("L1")], ["A"]);
});

test("penghitung atau penugas tidak sah sebagai pemeriksa", () => {
  const ev = [isi("A", "L1", 10, 1), serah("A", 2), periksa("A", 3), periksa("P", 4)];
  const r = turunkanIdentitas(ev, { assignedToId: "P" });
  assert.equal(r.pemeriksa.size, 0);
});

test("pemeriksaan sebelum hitungan diserahkan tidak berlaku", () => {
  const r = turunkanIdentitas([isi("A", "L1", 10, 1), periksa("B", 2), serah("A", 3)]);
  assert.equal(r.pemeriksa.size, 0);
});

test("angka diubah atau hitung ulang sesudah diperiksa → pemeriksaan basi; pemeriksaan baru berlaku", () => {
  const dasar = [isi("A", "L1", 10, 1), serah("A", 2), periksa("B", 3)];
  assert.equal(turunkanIdentitas(dasar).pemeriksa.size, 1);
  const berubah = [...dasar, isi("A", "L1", 11, 4), reset(4), serah("A", 5)];
  assert.equal(turunkanIdentitas(berubah).pemeriksa.size, 0, "angka berubah sesudah diperiksa");
  const ulang = [...berubah, periksa("C", 6)];
  assert.deepEqual([...turunkanIdentitas(ulang).pemeriksa.keys()], ["C"]);
});

test("pemeriksa yang kemudian ikut memasukkan angka menjadi penghitung → tidak sah lagi", () => {
  const ev = [isi("A", "L1", 10, 1), serah("A", 2), periksa("B", 3), isi("B", "L1", 12, 4), reset(4)];
  assert.equal(turunkanIdentitas(ev).pemeriksa.size, 0);
});

const mat = { id: "m1", code: "KODE-1", name: "Bahan", unit: "PCS" };
const lineStock = { id: "L1", materialId: "m1", countedQty: 8, material: { code: "KODE-1", unit: "PCS" } };
const count = { lines: [lineStock], startedAt: t(0), submittedAt: t(10) };

test("gabungStockCount memakai identitas aplikasi menggantikan nama lembar; preview memperingatkan beda nama", () => {
  const lembar = [{ baris: 2, materialId: "m1", kode: "KODE-1", satuan: "PCS", status: "BELUM_DIHITUNG", penghitung: "Budi", pemeriksa: "Sari", lokasi: "GUDANG_UTAMA", bukti: "F1" }];
  const identitas = { penghitung: [{ nama: "Nadya Marsha" }], penghitungPerBaris: { L1: ["Nadya Marsha"] }, pemeriksa: [{ nama: "Gulam" }] };
  const out = gabungStockCount(lembar, { count, selesaiPerLine: new Map([["L1", t(5)]]), identitas });
  assert.equal(out[0].penghitung, "Nadya Marsha"); assert.equal(out[0].pemeriksa, "Gulam");
  assert.equal(out[0].penghitungLembar, "Budi");
  const prev = hitungPreview({ materials: [{ ...mat, active: true }], baris: out, ledger: new Map([["m1", [{ id: "x", qty: 10, createdAt: t(-60), type: "RECEIPT" }]]]), pending: [] });
  const isu = prev.materials.find((h) => h.kode === "KODE-1").isu.map((i) => i.kode);
  assert.ok(isu.includes("NAMA_LEMBAR_BEDA_APLIKASI"));
  assert.ok(!isu.includes("PENGHITUNG_KOSONG") && !isu.includes("PEMERIKSA_KOSONG"));
});

test("tanpa pemeriksa di aplikasi → PEMERIKSA_KOSONG walau lembar menulis nama", () => {
  const lembar = [{ baris: 2, materialId: "m1", kode: "KODE-1", satuan: "PCS", status: "BELUM_DIHITUNG", penghitung: "Budi", pemeriksa: "Sari", lokasi: "GUDANG_UTAMA", bukti: "F1" }];
  const identitas = { penghitung: [{ nama: "Nadya Marsha" }], penghitungPerBaris: { L1: ["Nadya Marsha"] }, pemeriksa: [] };
  const out = gabungStockCount(lembar, { count, selesaiPerLine: new Map([["L1", t(5)]]), identitas });
  const prev = hitungPreview({ materials: [{ ...mat, active: true }], baris: out, ledger: new Map([["m1", []]]), pending: [] });
  assert.ok(prev.materials[0].isu.some((i) => i.kode === "PEMERIKSA_KOSONG" && i.level === "BLOCKER"));
});
