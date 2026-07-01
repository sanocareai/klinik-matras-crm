// Script generate icon PWA dari file logo
// Jalankan: node create-icons.cjs (dari folder frontend/)
// Butuh file: frontend/public/logo.png (taruh logo asli kamu di sini)

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const publicDir = path.join(__dirname, "public");
const logoPath = path.join(publicDir, "logo.png");

if (!fs.existsSync(logoPath)) {
  console.error("❌ File logo.png tidak ditemukan di folder public/");
  console.error("   Taruh file logo kamu di: frontend/public/logo.png");
  console.error("   Lalu jalankan lagi: node create-icons.cjs");
  process.exit(1);
}

if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

async function generateIcons() {
  console.log("Membaca logo dari public/logo.png ...");

  // Favicon 32x32 — dipakai di tab browser
  await sharp(logoPath)
    .resize(32, 32, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toFile(path.join(publicDir, "favicon.png"));
  console.log("✓ favicon.png (32x32) — tab browser");

  // Favicon 48x48 — fallback resolusi lebih tinggi
  await sharp(logoPath)
    .resize(48, 48, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toFile(path.join(publicDir, "favicon-48.png"));
  console.log("✓ favicon-48.png (48x48)");

  // PWA icon 192x192 — icon app di homescreen Android (kecil)
  // Logo di-center dengan padding, background putih bersih
  await sharp(logoPath)
    .resize(130, 130, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .extend({
      top: 31, bottom: 31, left: 31, right: 31,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toFile(path.join(publicDir, "pwa-192x192.png"));
  console.log("✓ pwa-192x192.png — homescreen Android (kecil)");

  // PWA icon 512x512 — splash screen & homescreen besar
  await sharp(logoPath)
    .resize(340, 340, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .extend({
      top: 86, bottom: 86, left: 86, right: 86,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toFile(path.join(publicDir, "pwa-512x512.png"));
  console.log("✓ pwa-512x512.png — splash screen & homescreen besar");

  // Logo kecil untuk sidebar app (64x64, background transparan)
  await sharp(logoPath)
    .resize(64, 64, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toFile(path.join(publicDir, "logo-small.png"));
  console.log("✓ logo-small.png (64x64) — sidebar app");

  console.log("\nSemua icon berhasil dibuat di folder public/");
  console.log("Langkah selanjutnya: npm run build  (lalu deploy ke VPS)");
}

generateIcons().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
