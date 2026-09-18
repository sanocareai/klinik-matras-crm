// Bulatkan + beri cincin putih tipis pada foto profil PAKAI SHARP
// (compositing alpha channel di server) — BUKAN cuma dibungkus
// borderRadius/View di klien seperti sebelumnya (19 September 2026, D-169,
// laporan owner soal foto driver di Live Tracking: "berarti gabisa ya pake
// foto mereka di live tracking?").
//
// Kenapa ini perlu, bukan sekadar polesan: crop lewat CSS/View (Avatar.jsx
// web, Avatar.js app) cukup untuk kartu/daftar biasa — itu View pembungkus
// yang MEMANG bisa di-style. Tapi ikon marker peta Live Tracking
// (driver-mobile VehicleMarker.js, prop `icon` react-native-maps) adalah
// bitmap NATIF yang dipakai APA ADANYA oleh Google Maps SDK — tidak ada
// View pembungkus sama sekali di situ, jadi tidak ada yang bisa di-
// borderRadius. Satu-satunya cara foto itu tampil bulat di peta adalah
// kalau file-nya SENDIRI sudah bulat (transparan di luar lingkaran) —
// makanya dibakar di sini, bukan di CSS.
//
// Dipakai backend/src/routes/users.js (upload baru, KEDUA endpoint avatar)
// DAN backend/scripts/circularize-existing-avatars.js (migrasi foto lama
// yang masih persegi, supaya driver yang sudah pasang foto SEBELUM
// perubahan ini tidak perlu upload ulang manual).
import sharp from "sharp";

export async function bulatkanFoto(bufferSumber, size = 256, borderPx = 10) {
  const dalam = size - borderPx * 2;

  const fotoDalam = await sharp(bufferSumber).resize(dalam, dalam, { fit: "cover" }).toBuffer();

  const maskLingkaran = Buffer.from(
    `<svg width="${dalam}" height="${dalam}"><circle cx="${dalam / 2}" cy="${dalam / 2}" r="${dalam / 2}" fill="#fff"/></svg>`
  );
  const fotoBulat = await sharp(fotoDalam)
    .composite([{ input: maskLingkaran, blend: "dest-in" }])
    .png()
    .toBuffer();

  const cincinPutih = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#ffffff"/></svg>`
  );

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: cincinPutih, top: 0, left: 0 },
      { input: fotoBulat, top: borderPx, left: borderPx },
    ])
    .png({ compressionLevel: 8 })
    .toBuffer();
}
