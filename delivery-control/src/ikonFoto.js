import * as ImageManipulator from "expo-image-manipulator";
import { client } from "./client";

// Foto profil sebagai ikon marker peta NATIF (pola yang sama dengan driver-mobile/src/lib/localImageCache.js, yang sudah berjalan):
// react-native-maps Android hanya menerima file LOKAL untuk prop `icon`, dan children Marker berisi <Image> jaringan terbukti
// menghasilkan lingkaran kosong (snapshot berpacu dengan pemuatan gambar). manipulateAsync menurunkan URL https menjadi file
// lokal berukuran kecil sekaligus. Beda dengan Sano Driver: format PNG (bukan JPEG) supaya bentuk bulat + cincin putih dari
// backend (sharp, alpha) tetap transparan di luar lingkaran. Gagal => pemanggil memakai penanda inisial.
const CACHE = new Map(); // avatarUrl -> uri file lokal
const PROSES = new Map(); // avatarUrl -> Promise (cegah unduh ganda)
const UKURAN = 84; // px — jelas di layar padat, jauh lebih kecil dari foto asli 256px

// avatarUrl berganti tiap ganti foto (nama file memuat timestamp), jadi cache tidak menyisakan foto basi.
export function ikonFoto(avatarUrl) {
  if (!avatarUrl) return Promise.resolve(null);
  if (CACHE.has(avatarUrl)) return Promise.resolve(CACHE.get(avatarUrl));
  if (PROSES.has(avatarUrl)) return PROSES.get(avatarUrl);
  const tugas = ImageManipulator.manipulateAsync(
    client.mediaUrl(avatarUrl),
    [{ resize: { width: UKURAN, height: UKURAN } }],
    { compress: 1, format: ImageManipulator.SaveFormat.PNG },
  )
    .then((h) => { CACHE.set(avatarUrl, h.uri); return h.uri; })
    .catch(() => null)
    .finally(() => { PROSES.delete(avatarUrl); });
  PROSES.set(avatarUrl, tugas);
  return tugas;
}
