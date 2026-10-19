// Aturan waktu acuan Stock Opname sesi model 2 (murni, tanpa DB).
import test from "node:test";
import assert from "node:assert/strict";
import { klasifikasiPergerakan, hitungPembanding, ringkasProgres, bangunCakupan, memenuhiCakupan, bahanDiLuarCakupan, MAKS_BAHAN_CYCLE_COUNT } from "../src/services/opnameSesi.js";

const T = new Date("2026-11-01T10:00:00Z"); const menit = (n) => new Date(T.getTime() + n * 60_000);

test("klasifikasi pergerakan terhadap waktu hitung: sebelum (≥30 mnt), jendela ragu (<30 mnt sebelum), sesudah; bahan belum dihitung tidak diklasifikasi", () => {
  assert.equal(klasifikasiPergerakan(menit(-31), T), "SEBELUM_HITUNG"); assert.equal(klasifikasiPergerakan(menit(-30), T), "SEBELUM_HITUNG", "tepat 30 menit = sebelum (batas eksklusif)");
  assert.equal(klasifikasiPergerakan(menit(-29), T), "JENDELA_RAGU"); assert.equal(klasifikasiPergerakan(menit(0), T), "JENDELA_RAGU", "tepat saat hitung = jendela ragu");
  assert.equal(klasifikasiPergerakan(menit(1), T), "SETELAH_HITUNG"); assert.equal(klasifikasiPergerakan(menit(1), null), "BAHAN_BELUM_DIHITUNG");
});

test("pembanding = saldo sampai hitung − jendela-ragu yang ditandai BELUM; sesudah hitung tidak mempengaruhi; tanpa tanda menahan; tanda SUDAH ikut pembanding", () => {
  const p = (id, m, qty, tanda = null) => ({ id, at: menit(m), qty, tanda });
  const dasar = { saldoSampaiHitung: 105, countedAt: T, countedQty: 100 };
  const h = hitungPembanding({ ...dasar, pergerakanBahan: [p("a", -60, 10), p("b", 15, 20), p("c", -10, 5)] });
  assert.equal(h.pembanding, 105); assert.equal(h.belumDitandai.length, 1, "jendela ragu tanpa tanda"); assert.equal(h.setelah.length, 1); assert.equal(h.sebelum.length, 1);
  assert.equal(hitungPembanding({ ...dasar, pergerakanBahan: [p("c", -10, 5, "BELUM_TERHITUNG")] }).pembanding, 100, "belum tercermin di fisik → dikeluarkan dari pembanding");
  const s = hitungPembanding({ ...dasar, pergerakanBahan: [p("c", -10, 5, "SUDAH_TERHITUNG")] }); assert.equal(s.pembanding, 105); assert.equal(s.selisih, -5); assert.equal(s.berselisih, true); assert.equal(s.belumDitandai.length, 0);
  assert.equal(hitungPembanding({ saldoSampaiHitung: 3, countedAt: T, countedQty: 3 }).berselisih, false);
  assert.equal(hitungPembanding({ saldoSampaiHitung: 0.1 + 0.2, countedAt: T, countedQty: 0.3 }).berselisih, false, "pembulatan desimal tidak membuat selisih palsu");
});

test("progres: kosong ≠ 0, dikeluarkan tidak dihitung, perlu diperiksa per kelompok", () => {
  const r = ringkasProgres([{ kelompokKode: "BUSA", counted: 0 }, { kelompokKode: "BUSA", counted: null }, { kelompokKode: "KAIN", counted: 5, perluPeriksa: true }, { kelompokKode: "KAIN", counted: null, excluded: true }]);
  assert.equal(r.total, 3); assert.equal(r.dihitung, 2, "0 eksplisit terhitung"); assert.equal(r.belum, 1); assert.equal(r.dikeluarkan, 1); assert.equal(r.perluPeriksa, 1); assert.equal(r.persen, 66.7);
  assert.deepEqual(r.perKelompok.map((k) => [k.kode, k.total, k.dihitung]), [["BUSA", 2, 1], ["KAIN", 1, 1]]);
});

test("cakupan: penuh = semua aktif (tanpa kelompok ikut), pengecualian beralasan, Cycle Count dibatasi, nonaktif ditolak; di luar cakupan hanya yang memenuhi kriteria", () => {
  const mk = (i, itemGroup, extra = {}) => ({ id: `id${i}`, code: `M${i}`, name: `B${i}`, unit: "PCS", active: true, category: "RAW_MATERIAL", itemGroup, ...extra });
  const bahan = [mk(1, "REBONDED"), mk(2, "KAIN"), mk(3, null), mk(4, "SUPPORT KAIN"), mk(5, "KAIN", { active: false }), mk(6, "KAIN", { category: "CONSUMABLE" })];
  const penuh = bangunCakupan(bahan, { mode: "FULL" }); assert.equal(penuh.materialIds.length, 5); assert.equal(penuh.ringkasan.belumDikelompokkan.masuk, 2); assert.equal(penuh.ringkasan.nonaktif.jumlah, 1);
  assert.equal(bangunCakupan(bahan, { mode: "FULL", excludeJenis: ["CONSUMABLE"] }).materialIds.length, 4);
  assert.throws(() => bangunCakupan(bahan, { mode: "FULL", excludeMaterialIds: ["id1"] }), /Alasan pengecualian/);
  assert.equal(bangunCakupan(bahan, { mode: "GROUP", groups: ["KAIN"] }).materialIds.length, 2, "aktif saja: id2 + id6");
  assert.throws(() => bangunCakupan(bahan, { mode: "ITEMS", materialIds: ["id5"] }), /nonaktif/);
  assert.throws(() => bangunCakupan(bahan, { mode: "ITEMS", materialIds: Array.from({ length: MAKS_BAHAN_CYCLE_COUNT + 1 }, (_, i) => `x${i}`) }), /dibatasi/);
  assert.equal(memenuhiCakupan(mk(9, "KAIN"), { mode: "GROUP", groups: ["KAIN"] }), true); assert.equal(memenuhiCakupan(mk(9, "KAIN"), { mode: "ITEMS" }), false);
  const sesi = { modelVersion: 2, scopeMode: "FULL", scopeInfo: { excludeJenis: ["CONSUMABLE"] }, lines: [{ materialId: "id1" }, { materialId: "id2" }] };
  assert.deepEqual(bahanDiLuarCakupan(bahan, sesi).map((m) => m.id), ["id3", "id4"], "bahan aktif yang tak ada di sesi; consumable dikecualikan; nonaktif tidak");
  assert.deepEqual(bahanDiLuarCakupan(bahan, sesi, new Set(["id3"])).map((m) => m.id), ["id4"], "yang sudah diputuskan diabaikan tidak muncul lagi");
  assert.deepEqual(bahanDiLuarCakupan(bahan, { ...sesi, scopeMode: "ITEMS" }), []); assert.deepEqual(bahanDiLuarCakupan(bahan, { ...sesi, modelVersion: 1 }), []);
});
