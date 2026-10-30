// Antrean pembacaan Marketing: berurutan, coba ulang 429 TERBATAS, pekerjaan basi dilewati (tidak menumpuk, tidak menimpa hasil terbaru).
import test from "node:test";
import assert from "node:assert/strict";
import { berurutan, COBA_BAWAAN, galatDibatalkan } from "../src/features/laporan/marketingData.js";

const e429 = () => Object.assign(new Error("sedang dihitung"), { status: 429 });
const tunda = (ms) => new Promise((r) => setTimeout(r, ms));

test("berurutan: pekerjaan dijalankan satu per satu sesuai urutan masuk (tidak paralel)", async () => {
  let aktif = 0, puncak = 0; const urutan = [];
  const kerja = (id, ms) => async () => { aktif++; puncak = Math.max(puncak, aktif); await tunda(ms); aktif--; urutan.push(id); return id; };
  const hasil = await Promise.all([berurutan(kerja("a", 20)), berurutan(kerja("b", 5)), berurutan(kerja("c", 1))]);
  assert.deepEqual(hasil, ["a", "b", "c"]); assert.deepEqual(urutan, ["a", "b", "c"]); assert.equal(puncak, 1);
});

test("429 dicoba ulang TERBATAS: tepat COBA_BAWAAN percobaan lalu galat 429 diteruskan (tidak ada loop tanpa batas)", async () => {
  let panggilan = 0;
  await assert.rejects(berurutan(async () => { panggilan++; throw e429(); }, { jeda: 1 }), (e) => e.status === 429);
  assert.equal(panggilan, COBA_BAWAAN);
  assert.equal(COBA_BAWAAN, 4);
  panggilan = 0;
  const ok = await berurutan(async () => { panggilan++; if (panggilan < 3) throw e429(); return "ok"; }, { jeda: 1 });
  assert.equal(ok, "ok"); assert.equal(panggilan, 3, "berhenti begitu berhasil");
});

test("galat selain 429 tidak diulang", async () => {
  let panggilan = 0;
  await assert.rejects(berurutan(async () => { panggilan++; throw Object.assign(new Error("boom"), { status: 500 }); }, { jeda: 1 }), (e) => e.status === 500);
  assert.equal(panggilan, 1);
});

test("antrean tetap jalan setelah satu pekerjaan gagal", async () => {
  const a = berurutan(async () => { throw Object.assign(new Error("x"), { status: 500 }); }); a.catch(() => {});
  assert.equal(await berurutan(async () => "lanjut"), "lanjut");
});

test("pekerjaan basi (periode berganti) dilewati: tidak menjalankan kerja, tidak menunda yang terbaru", async () => {
  let basi = false; let jalan = 0;
  const penahan = berurutan(async () => { await tunda(30); return "penahan"; });
  const lama = berurutan(async () => { jalan++; return "lama"; }, { batal: () => basi });
  basi = true;                                        // pengguna ganti periode saat 'lama' masih mengantre
  const baru = berurutan(async () => { jalan++; return "baru"; });
  assert.equal(await penahan, "penahan");
  await assert.rejects(lama, (e) => e.dibatalkan === true);
  assert.equal(await baru, "baru"); assert.equal(jalan, 1, "hanya permintaan terbaru yang benar-benar dikirim");
});

test("pekerjaan yang menjadi basi di tengah coba-ulang 429 berhenti (tidak mengulang permintaan lama)", async () => {
  let basi = false; let panggilan = 0;
  const p = berurutan(async () => { panggilan++; basi = true; throw e429(); }, { jeda: 1, batal: () => basi });
  await assert.rejects(p, (e) => e.dibatalkan === true);
  assert.equal(panggilan, 1);
  assert.equal(galatDibatalkan().dibatalkan, true);
});

test("antrean tidak tumbuh tanpa batas: 200 permintaan basi selesai tanpa satu pun dikirim", async () => {
  let jalan = 0; const penahan = berurutan(async () => { await tunda(20); });
  const semua = Array.from({ length: 200 }, () => berurutan(async () => { jalan++; }, { batal: () => true }).catch((e) => e.dibatalkan));
  await penahan; const hasil = await Promise.all(semua);
  assert.ok(hasil.every(Boolean)); assert.equal(jalan, 0);
});
