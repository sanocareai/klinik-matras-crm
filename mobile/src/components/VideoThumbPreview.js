// Thumbnail/cover video di dalam bubble chat — file TERPISAH dari
// MessageBubble.js dan di-lazy-load (lihat import di MessageBubble.js)
// SENGAJA supaya cost require() expo-video-thumbnails TIDAK ikut kebawa
// startup app. MessageBubble.js statis diimport ChatScreen.js yang statis
// diimport App.js (dibutuhkan stack registration React Navigation) — kalau
// modul ini di-import langsung di top-level MessageBubble.js, dia akan
// ke-require SETIAP kali layar chat manapun dibuka (nyaris selalu), persis
// masalah yang sudah pernah diperbaiki utk MediaViewerModal.js (lihat
// catatan lazy() di ChatScreen.js) — di sini dampaknya malah lebih langsung
// karena MessageBubble dirender utk SEMUA pesan, bukan cuma saat user buka
// galeri fullscreen.
//
// BUG (fix, 17 Agt 2026): versi SEBELUM ini mengandalkan <VideoView> dari
// expo-video merender frame pertama SAAT PAUSED (tanpa pernah .play()) —
// dengan asumsi expo-video otomatis menggambar frame begitu aset selesai
// dimuat. Itu TERNYATA TIDAK RELIABLE: di Android, ExoPlayer (yang dipakai
// expo-video) sering menampilkan permukaan KOSONG/HITAM sampai render
// pertama benar-benar terjadi lewat playback aktif — untuk video REMOTE
// yang baru selesai diupload (belum pernah di-buffer sebelumnya), kondisi
// itu nyaris selalu terjadi. Hasilnya: cover video tampil hitam polos,
// persis yang dilaporkan.
//
// Fix: pakai expo-video-thumbnails (`getThumbnailAsync`) — library resmi
// yang MEMANG dibuat untuk ekstraksi satu frame statis dari video (native:
// MediaMetadataRetriever di Android, AVAssetImageGenerator di iOS), bukan
// menyandarkan pada perilaku internal video PLAYER yang tidak dijamin.
// Hasilnya sebuah file JPEG lokal yang dirender lewat <Image> biasa — jauh
// lebih murah juga: bubble video tidak lagi perlu menghidupkan instance
// player+decoder cuma untuk menampilkan cover statis (bisa banyak sekaligus
// di satu layar chat yang penuh video).
import React, { useEffect, useState } from "react";
import { Image } from "expo-image";
import * as VideoThumbnails from "expo-video-thumbnails";
import { Video } from "lucide-react-native";
import { View } from "react-native";

// Cache in-memory per URI — video yang sama tampil berkali-kali (scroll naik
// turun me-remount tile) tidak perlu ekstraksi ulang tiap kali.
const thumbCache = new Map();

export default function VideoThumbPreview({ uri, style }) {
  const [thumbUri, setThumbUri] = useState(thumbCache.get(uri) || null);
  const [gagal, setGagal] = useState(false);

  useEffect(() => {
    if (!uri || thumbCache.has(uri)) return;
    let alive = true;
    VideoThumbnails.getThumbnailAsync(uri, { time: 0, quality: 0.6 })
      .then(({ uri: hasil }) => {
        thumbCache.set(uri, hasil);
        if (alive) setThumbUri(hasil);
      })
      .catch(() => {
        // WAJAR: file rusak/format tidak didukung/URL belum bisa diakses.
        // Fallback ikon di bawah, BUKAN layar hitam tanpa penjelasan.
        if (alive) setGagal(true);
      });
    return () => { alive = false; };
  }, [uri]);

  if (thumbUri) {
    return <Image source={{ uri: thumbUri }} style={style} contentFit="cover" />;
  }
  // Selagi menunggu ekstraksi (atau kalau gagal) — ikon video di atas latar
  // gelap yang SUDAH ada di baliknya (videoThumb/albumTile di MessageBubble.js),
  // BUKAN dibiarkan tampak seperti bug (persegi hitam polos tanpa makna).
  return (
    <View style={[style, { alignItems: "center", justifyContent: "center", backgroundColor: "#1a1a1a" }]}>
      <Video size={20} color="rgba(255,255,255,0.6)" strokeWidth={1.8} />
    </View>
  );
}
