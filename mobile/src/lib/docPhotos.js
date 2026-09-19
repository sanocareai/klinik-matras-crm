// Simpan / bagikan foto dokumentasi order dari app — dipakai OrderTimelineScreen.
// Foto diunduh dulu ke cache lokal (expo-file-system), lalu:
//  - saveToGallery: masuk galeri HP (expo-media-library)
//  - shareOne: buka sheet bagikan Android (expo-sharing) — mis. ke WhatsApp
//    pribadi sales. Sheet ini hanya menerima SATU file per panggilan.
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { mediaUrl } from "../api";

async function download(url) {
  return File.downloadFileAsync(mediaUrl(url), Paths.cache, { idempotent: true });
}

export async function saveToGallery(urls) {
  const perm = await MediaLibrary.requestPermissionsAsync(true); // true = hanya izin tulis
  if (!perm.granted) throw new Error("Izin simpan foto ditolak");
  let saved = 0;
  for (const url of urls) {
    const file = await download(url);
    await MediaLibrary.saveToLibraryAsync(file.uri);
    saved += 1;
  }
  return saved;
}

export async function shareOne(url) {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Fitur bagikan tidak tersedia di perangkat ini");
  const file = await download(url);
  await Sharing.shareAsync(file.uri, { mimeType: "image/jpeg", dialogTitle: "Bagikan foto" });
}
