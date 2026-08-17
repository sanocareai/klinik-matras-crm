// Poster/cover video — dibuat di SERVER dengan ffmpeg, bukan di klien.
//
// KENAPA DI SERVER (riwayat kegagalan, jangan diulang). Dua percobaan di sisi
// klien sudah gagal di lapangan:
//   1. Menampilkan <VideoView> (expo-video) dalam kondisi paused, berharap
//      frame pertama tergambar sendiri. Di Android ExoPlayer sering
//      menampilkan permukaan KOSONG sampai playback aktif benar-benar
//      terjadi — hasilnya kotak hitam.
//   2. expo-video-thumbnails dengan `time: 0`. Masih hitam. DUA sebab:
//      (a) ekstraksi frame dari URL REMOTE di Android tidak dapat
//          diandalkan, dan
//      (b) frame pada detik 0 memang SERING hitam (fade-in/lampu belum
//          masuk), jadi walaupun ekstraksinya berhasil hasilnya tetap hitam.
// Server tidak punya dua masalah itu: filenya ada secara lokal, dan filter
// `thumbnail` ffmpeg MEMILIH frame paling representatif dari sekumpulan
// frame — bukan asal frame pertama.
//
// BONUS PENTING: ffmpeg otomatis menerapkan metadata `rotation` saat
// men-decode. Jadi dimensi JPEG hasilnya SUDAH merupakan ukuran TAMPIL yang
// benar. Itu sekaligus memperbaiki bug "video portrait tampil landscape"
// tanpa perlu mengurai metadata rotasi sendiri — contoh nyata dari produksi:
// stream 3840x2160 rotation=-90 menghasilkan thumbnail 480x854 (portrait).
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Lebar poster. 480px cukup tajam untuk bubble chat (lebar bubble < 300px
// bahkan di tablet) tapi tetap kecil (~30-60 KB) — poster harus terasa
// INSTAN, itu seluruh gunanya. "-2" pada tinggi = biarkan ffmpeg menghitung
// tinggi proporsional & genap (encoder JPEG menuntut dimensi genap).
const LEBAR_POSTER = 480;

// Batas waktu. Video 4K puluhan MB pernah nyata di produksi (37 MB, 3840x2160)
// — tanpa batas, sebuah file rusak bisa menggantung request unggah selamanya.
const TIMEOUT_MS = 20_000;

/**
 * Bikin poster JPEG untuk sebuah file video.
 *
 * @param {string} absPath path absolut file video di disk
 * @returns {Promise<{filename: string, width: number, height: number} | null>}
 *   null kalau gagal — itu WAJAR (file rusak, codec tidak didukung, timeout).
 *   Caller HARUS tetap menyimpan pesannya; poster cuma pemanis, bukan syarat.
 */
export async function buatPosterVideo(absPath) {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath).replace(/\.[^.]+$/, "");
  const filename = `${base}-thumb.jpg`;
  const outPath = path.join(dir, filename);

  try {
    // -frames:v 1 setelah filter `thumbnail` — ambil SATU frame terpilih.
    // -an buang audio (tidak relevan, dan mencegah ffmpeg bekerja sia-sia).
    await execAsync(
      `ffmpeg -y -v error -i "${absPath}" -vf "thumbnail,scale=${LEBAR_POSTER}:-2" -frames:v 1 -an "${outPath}"`,
      { timeout: TIMEOUT_MS },
    );
  } catch (err) {
    console.warn("[videoThumb] ffmpeg gagal bikin poster:", path.basename(absPath), err.message);
    // ffmpeg bisa membuat file kosong sebelum gagal — jangan tinggalkan sampah.
    fs.unlink(outPath, () => {});
    return null;
  }

  // File benar-benar ada DAN tidak kosong. ffmpeg kadang keluar dengan status
  // 0 tapi menghasilkan file 0 byte untuk input yang aneh — poster 0 byte
  // tampil sebagai gambar rusak di klien, lebih buruk daripada tidak ada
  // poster sama sekali (klien punya fallback ikon).
  try {
    const stat = fs.statSync(outPath);
    if (!stat.size) {
      fs.unlink(outPath, () => {});
      return null;
    }
  } catch {
    return null;
  }

  const ukuran = await ukuranGambar(outPath);
  if (!ukuran) {
    // Poster jadi tapi dimensinya tidak terbaca — poster tetap dipakai,
    // cuma tanpa info rasio (klien pakai rasio bawaan).
    return { filename, width: null, height: null };
  }
  return { filename, ...ukuran };
}

/**
 * Pembungkus siap-pakai untuk titik penyimpanan Message.
 *
 * Menerima mediaUrl PUBLIK ("/uploads/xxx.mp4") dan mengembalikan objek yang
 * bisa langsung di-spread ke `prisma.message.create({ data: {...} })`.
 * Sengaja mengembalikan {} (bukan null) saat bukan video / gagal — supaya
 * pemanggil bisa selalu men-spread tanpa perlu bercabang, dan kolomnya
 * tinggal null seperti pesan lama.
 *
 * TIDAK PERNAH melempar error: poster itu pemanis, kegagalannya tidak boleh
 * menggagalkan penyimpanan pesan (pesannya sendiri jauh lebih penting).
 */
export async function fieldPosterVideo(uploadsDir, mediaUrl, mediaType) {
  if (mediaType !== "video" || !mediaUrl?.startsWith("/uploads/")) return {};
  try {
    const absPath = path.join(uploadsDir, path.basename(mediaUrl));
    if (!fs.existsSync(absPath)) return {};
    const hasil = await buatPosterVideo(absPath);
    if (!hasil) return {};
    return {
      thumbUrl: `/uploads/${hasil.filename}`,
      mediaWidth: hasil.width,
      mediaHeight: hasil.height,
    };
  } catch (err) {
    console.warn("[videoThumb] fieldPosterVideo gagal:", err.message);
    return {};
  }
}

/**
 * Baca dimensi sebuah file gambar via ffprobe.
 * Dipisah supaya bisa dites/dipakai sendiri (mis. skrip backfill).
 */
export async function ukuranGambar(absPath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${absPath}"`,
      { timeout: TIMEOUT_MS },
    );
    const [w, h] = String(stdout).trim().split("x").map((n) => parseInt(n, 10));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return { width: w, height: h };
  } catch {
    return null;
  }
}
