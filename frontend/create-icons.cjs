// Script sekali pakai: generate icon PWA 192px dan 512px
// Jalankan dengan: node create-icons.js (dari folder frontend/)
// Tidak butuh package tambahan — pakai zlib bawaan Node.js

const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

// CRC32 standar untuk chunk PNG
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createPNG(size) {
  // Warna brand: #1e2139 = rgb(30, 33, 57) — background gelap
  const BG = [30, 33, 57];
  // Putih untuk elemen foreground
  const WHITE = [255, 255, 255];
  // Biru aksen: #60a5fa
  const ACCENT = [96, 165, 250];

  const cx = size / 2;
  const cy = size / 2;

  // Pixel data (RGB, 3 bytes per pixel + 1 filter byte per baris)
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0]; // filter = None
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Lingkaran putih besar (radius 38% dari size)
      const outerR = size * 0.38;
      // Lingkaran dalam (warna accent, radius 28%)
      const innerR = size * 0.22;

      let color = BG;

      if (dist < innerR) {
        color = ACCENT;
      } else if (dist < outerR) {
        color = WHITE;
      }

      row.push(...color);
    }
    rows.push(row);
  }

  const rawData = Buffer.from(rows.flat());
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  // IHDR: width(4) height(4) bitDepth(1) colorType(1=RGB=2) compress(1) filter(1) interlace(1)
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

const publicDir = path.join(__dirname, "public");
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

fs.writeFileSync(path.join(publicDir, "pwa-192x192.png"), createPNG(192));
fs.writeFileSync(path.join(publicDir, "pwa-512x512.png"), createPNG(512));

console.log("✓ pwa-192x192.png dibuat");
console.log("✓ pwa-512x512.png dibuat");
console.log("Icon berhasil di-generate di folder public/");
