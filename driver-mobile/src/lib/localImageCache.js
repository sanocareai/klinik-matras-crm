// Foto profil sebagai ikon marker peta NATIF (19 September 2026, revisi
// ke-2 setelah 2x percobaan via "live child view" tetap menyisakan
// lingkaran kosong di lapangan — lihat catatan panjang di
// components/VehicleMarker.js untuk root cause lengkapnya). react-native-
// maps HANYA menerima file LOKAL untuk prop `icon`/`image` Marker
// (react-native-maps/dist/src/MapMarker.d.ts: "Only local image resources
// are allowed") — https URL langsung TIDAK didukung di situ.
//
// expo-image-manipulator dipakai bukan cuma untuk resize (marker butuh
// bitmap KECIL, ~72px — foto asli dari backend 256px akan jadi ikon
// raksasa kalau dipakai apa adanya), tapi SEKALIGUS jadi jalan turun dari
// https ke file lokal: manipulateAsync menerima URL network langsung dan
// MENGEMBALIKAN file lokal hasil olahannya — satu panggilan menuntaskan
// dua kebutuhan (resize + lokal) sekaligus.
import * as ImageManipulator from "expo-image-manipulator";
import { mediaUrl } from "../api";

const CACHE = new Map(); // avatarUrl -> local file uri (sudah selesai diproses)
const SEDANG_DIPROSES = new Map(); // avatarUrl -> Promise, cegah proses dobel kalau 2 marker pakai foto yang sama bersamaan (driver yang sama muncul di >1 kendaraan hari yang sama, jarang tapi mungkin)

const UKURAN_IKON = 72; // px — tajam di layar densitas tinggi, jauh lebih kecil dari foto asli 256px

// avatarUrl berubah SETIAP ganti foto (backend: filename `${userId}-
// ${Date.now()}.jpg`, lihat routes/users.js#processAvatarUpload) — jadi
// cache di sini otomatis aman dari foto basi, tidak perlu invalidasi manual.
export function getLocalAvatarIconUri(avatarUrl) {
  if (!avatarUrl) return Promise.resolve(null);
  if (CACHE.has(avatarUrl)) return Promise.resolve(CACHE.get(avatarUrl));
  if (SEDANG_DIPROSES.has(avatarUrl)) return SEDANG_DIPROSES.get(avatarUrl);

  const tugas = ImageManipulator.manipulateAsync(
    mediaUrl(avatarUrl),
    [{ resize: { width: UKURAN_IKON, height: UKURAN_IKON } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
  )
    .then((hasil) => {
      CACHE.set(avatarUrl, hasil.uri);
      return hasil.uri;
    })
    .catch((err) => {
      // Diam-diam gagal — pemanggil fallback ke dot inisial berwarna,
      // jauh lebih baik daripada lingkaran kosong.
      console.warn("[localImageCache] gagal siapkan ikon marker:", err.message);
      return null;
    })
    .finally(() => {
      SEDANG_DIPROSES.delete(avatarUrl);
    });

  SEDANG_DIPROSES.set(avatarUrl, tugas);
  return tugas;
}
