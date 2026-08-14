// Tes penyusun kolase gambar promo.
//
// Kenapa diuji: kolase dibuat SEKALI lalu dikirim ke ratusan orang. Kalau
// hasilnya rusak (ukuran nol, gambar hilang, format salah), yang rusak
// bukan satu pesan — tapi seluruh kampanye, dan baru ketahuan setelah
// pelanggan menerimanya.

import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buatKolase, jalurKolase, hapusKolase } from "../src/services/kolaseGambar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, "../uploads");

/** Bikin gambar polos untuk bahan uji, kembalikan path publiknya. */
async function gambarUji(nama, warna) {
  fs.mkdirSync(UPLOADS, { recursive: true });
  const berkas = path.join(UPLOADS, nama);
  await sharp({ create: { width: 400, height: 600, channels: 3, background: warna } })
    .jpeg().toFile(berkas);
  return `/uploads/${nama}`;
}

const bersihkan = [];
test.after(() => {
  for (const f of bersihkan) fs.unlink(f, () => {});
});

test("kurang dari 2 gambar -> null (tidak ada yang perlu digabung)", async () => {
  assert.equal(await buatKolase([], "x1"), null);
  assert.equal(await buatKolase(["/uploads/cuma-satu.jpg"], "x1"), null);
});

test("2 gambar digabung jadi satu berkas kisi yang valid", async () => {
  const a = await gambarUji("uji-kolase-a.jpg", { r: 200, g: 30, b: 30 });
  const b = await gambarUji("uji-kolase-b.jpg", { r: 30, g: 60, b: 200 });
  bersihkan.push(path.join(UPLOADS, "uji-kolase-a.jpg"), path.join(UPLOADS, "uji-kolase-b.jpg"));

  const hasil = await buatKolase([a, b], "kamp2");
  assert.equal(hasil, jalurKolase("kamp2"));

  const berkas = path.join(UPLOADS, `kolase-kamp2.jpg`);
  bersihkan.push(berkas);
  assert.ok(fs.existsSync(berkas), "berkas kolase harus benar-benar dibuat");

  const meta = await sharp(berkas).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 1080, "lebar kolase dipatok 1080px");
  assert.ok(meta.height > 0);
  // 2 gambar -> 2 kolom 1 baris, jadi tingginya kira-kira setengah lebarnya
  assert.ok(meta.height < meta.width, "2 gambar harus berdampingan, bukan bertumpuk");
});

test("4 gambar -> kisi 2x2 (lebih tinggi dari kasus 2 gambar)", async () => {
  const g = [];
  for (let i = 0; i < 4; i++) {
    g.push(await gambarUji(`uji-kolase-4-${i}.jpg`, { r: 50 * i, g: 100, b: 150 }));
    bersihkan.push(path.join(UPLOADS, `uji-kolase-4-${i}.jpg`));
  }
  const hasil = await buatKolase(g, "kamp4");
  const berkas = path.join(UPLOADS, "kolase-kamp4.jpg");
  bersihkan.push(berkas);

  assert.ok(hasil);
  const meta = await sharp(berkas).metadata();
  assert.equal(meta.width, 1080);
  // 2 kolom x 2 baris -> tinggi kira-kira sama dengan lebar
  assert.ok(meta.height > 900 && meta.height < 1200, `tinggi tak wajar: ${meta.height}`);
});

test("berkas gambar yang hilang di disk tidak bikin error, cuma dilewati", async () => {
  const a = await gambarUji("uji-kolase-ada.jpg", { r: 10, g: 10, b: 10 });
  bersihkan.push(path.join(UPLOADS, "uji-kolase-ada.jpg"));

  // Satu ada, satu tidak -> sisa 1 lapisan -> null (bukan crash)
  const hasil = await buatKolase([a, "/uploads/tidak-pernah-ada.jpg"], "kampX");
  assert.equal(hasil, null);
});

test("hapusKolase tidak melempar error walau berkasnya tidak ada", () => {
  assert.doesNotThrow(() => hapusKolase("kampanye-yang-tidak-ada"));
});
