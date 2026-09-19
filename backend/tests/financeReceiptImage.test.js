// Kompresi foto bukti (services/finance/receipts.js#simpanFotoBukti) — unit,
// tanpa database. Yang dikunci: hasilnya JAUH lebih kecil dari foto HP asli,
// dimensinya dibatasi, thumbnail ada, idempoten, dan file bukan-gambar ditolak.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { simpanFotoBukti } from "../src/services/finance/receipts.js";

// Foto "HP" sintetis: 4000x3000 penuh noise → JPEG mentah besar (persis kasus
// yang bikin halaman lemot).
async function fotoBesar() {
  const w = 4000, h = 3000;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

test("Foto besar dikompres: dimensi dibatasi, ukuran turun drastis, thumbnail ikut dibuat", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nota-"));
  const asli = await fotoBesar();
  const r = await simpanFotoBukti(asli, { dir });

  assert.match(r.url, /^\/media\/finance-receipts\/[0-9a-f]{40}\.jpg$/);
  assert.equal(r.ukuranAsli, asli.length);
  assert.ok(r.ukuranAkhir < asli.length / 3, `hasil ${r.ukuranAkhir} harus jauh lebih kecil dari asli ${asli.length}`);

  const nama = path.basename(r.url);
  const meta = await sharp(path.join(dir, nama)).metadata();
  assert.ok(meta.width <= 1600 && meta.height <= 2200, `dimensi ${meta.width}x${meta.height} melebihi batas`);
  assert.equal(meta.format, "jpeg");

  const thumb = await sharp(path.join(dir, nama.replace(".jpg", "_t.jpg"))).metadata();
  assert.ok(Math.max(thumb.width, thumb.height) <= 400);
});

test("Foto yang sama diunggah dua kali → URL sama (dasar deteksi nota ganda)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nota-"));
  const asli = await fotoBesar();
  const a = await simpanFotoBukti(asli, { dir });
  const b = await simpanFotoBukti(asli, { dir });
  assert.equal(a.url, b.url);
});

test("Gambar kecil tidak diperbesar; PNG transparan jadi latar putih", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nota-"));
  const png = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const r = await simpanFotoBukti(png, { dir });
  const out = sharp(path.join(dir, path.basename(r.url)));
  const meta = await out.metadata();
  assert.equal(meta.width, 200, "tidak di-upscale");
  const { data } = await out.raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 240, "piksel transparan menjadi putih, bukan hitam");
});

test("File bukan gambar ditolak 400", async () => {
  await assert.rejects(
    () => simpanFotoBukti(Buffer.from("ini bukan gambar sama sekali"), { dir: os.tmpdir() }),
    (e) => e.statusCode === 400
  );
});
