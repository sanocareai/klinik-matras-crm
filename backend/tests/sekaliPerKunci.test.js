// Anti-dobel file media webhook: unduhan per externalId dijalankan SEKALI.
// Modul murni (tanpa DB/WAHA/disk) → bisa diuji tanpa mock.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buatSekaliPerKunci } from "../src/utils/sekaliPerKunci.js";

const tunda = (ms) => new Promise((r) => setTimeout(r, ms));
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("dua pemanggil bersamaan (message + message.any) hanya menjalankan fn sekali dan dapat hasil sama", async () => {
  const jalan = buatSekaliPerKunci();
  let panggilan = 0;
  const unduh = async () => { panggilan++; await tunda(20); return "/uploads/1790000000000-abc.mp4"; };

  const [a, b] = await Promise.all([jalan("msg-1", unduh), jalan("msg-1", unduh)]);

  assert.equal(panggilan, 1, "fn tidak boleh jalan dua kali");
  assert.equal(a, "/uploads/1790000000000-abc.mp4");
  assert.equal(b, a, "kedua event memakai path file yang SAMA");
});

test("event kedua yang tiba sesudah unduhan selesai (dalam TTL) memakai hasil yang diingat", async () => {
  let t = 1_000;
  const jalan = buatSekaliPerKunci({ ttlMs: 60_000, sekarang: () => t });
  let panggilan = 0;
  const unduh = async () => { panggilan++; return "/uploads/x.jpg"; };

  assert.equal(await jalan("msg-2", unduh), "/uploads/x.jpg");
  t += 59_000;
  assert.equal(await jalan("msg-2", unduh), "/uploads/x.jpg");
  assert.equal(panggilan, 1);
});

test("sesudah TTL lewat, pekerjaan dijalankan lagi", async () => {
  let t = 0;
  const jalan = buatSekaliPerKunci({ ttlMs: 60_000, sekarang: () => t });
  let panggilan = 0;
  const unduh = async () => { panggilan++; return `/uploads/${panggilan}.jpg`; };

  assert.equal(await jalan("msg-3", unduh), "/uploads/1.jpg");
  t += 60_000;
  assert.equal(await jalan("msg-3", unduh), "/uploads/2.jpg");
  assert.equal(panggilan, 2);
});

test("hasil gagal (null) tidak diingat: unduh ulang saat forward tetap bisa mencoba lagi", async () => {
  const jalan = buatSekaliPerKunci();
  let panggilan = 0;
  const unduh = async () => { panggilan++; return panggilan === 1 ? null : "/uploads/ok.mp4"; };

  assert.equal(await jalan("msg-4", unduh), null);
  assert.equal(await jalan("msg-4", unduh), "/uploads/ok.mp4");
  assert.equal(panggilan, 2);
});

test("penolakan dibagikan ke semua yang menunggu, tidak diingat, dan pemanggil berikutnya mencoba lagi", async () => {
  const jalan = buatSekaliPerKunci();
  let panggilan = 0;
  const unduh = async () => { panggilan++; await tunda(10); if (panggilan === 1) throw new Error("WAHA 500"); return "/uploads/pulih.jpg"; };

  const [a, b] = await Promise.allSettled([jalan("msg-5", unduh), jalan("msg-5", unduh)]);
  assert.equal(a.status, "rejected");
  assert.equal(b.status, "rejected");
  assert.equal(panggilan, 1);

  assert.equal(await jalan("msg-5", unduh), "/uploads/pulih.jpg");
  assert.equal(panggilan, 2);
});

test("kunci berbeda berjalan terpisah", async () => {
  const jalan = buatSekaliPerKunci();
  let panggilan = 0;
  const unduh = (hasil) => async () => { panggilan++; await tunda(5); return hasil; };

  const [a, b] = await Promise.all([jalan("msg-a", unduh("/uploads/a.jpg")), jalan("msg-b", unduh("/uploads/b.jpg"))]);
  assert.equal(a, "/uploads/a.jpg");
  assert.equal(b, "/uploads/b.jpg");
  assert.equal(panggilan, 2);
});

test("kunci kosong tidak pernah di-dedupe", async () => {
  const jalan = buatSekaliPerKunci();
  let panggilan = 0;
  const unduh = async () => { panggilan++; return `/uploads/${panggilan}.jpg`; };

  await Promise.all([jalan(null, unduh), jalan(undefined, unduh), jalan("", unduh)]);
  assert.equal(panggilan, 3);
});

test("memori dibatasi: hasil yang diingat tidak melebihi maksEntri", async () => {
  const jalan = buatSekaliPerKunci({ maksEntri: 3, ttlMs: 60_000 });
  const hitung = {};
  const unduh = (k) => async () => { hitung[k] = (hitung[k] || 0) + 1; return `/uploads/${k}.jpg`; };

  for (const k of ["a", "b", "c", "d", "e"]) await jalan(k, unduh(k));
  await jalan("e", unduh("e")); // masih diingat
  await jalan("a", unduh("a")); // sudah tergusur → jalan lagi
  assert.equal(hitung.e, 1);
  assert.equal(hitung.a, 2);
});

test("kontrak: downloadAndSaveMedia di webhooks.js membungkus unduhan lewat buatSekaliPerKunci per externalId", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/routes/webhooks.js"), "utf8");
  assert.match(src, /import \{ buatSekaliPerKunci \} from "\.\.\/utils\/sekaliPerKunci\.js"/);
  assert.match(src, /unduhMediaSekali\(externalId,/);
  // Penulisan file hanya terjadi di fungsi internal yang dibungkus, bukan di pembungkus ekspor.
  const pembungkus = src.match(/export function downloadAndSaveMedia\([^)]*\) \{[\s\S]*?\n\}/);
  assert.ok(pembungkus, "pembungkus ekspor downloadAndSaveMedia harus ada");
  assert.doesNotMatch(pembungkus[0], /writeFileSync/);
});
