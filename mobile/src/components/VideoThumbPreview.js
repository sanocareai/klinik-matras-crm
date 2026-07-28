// Thumbnail/cover video di dalam bubble chat — file TERPISAH dari
// MessageBubble.js dan di-lazy-load (lihat import di MessageBubble.js)
// SENGAJA supaya cost require() expo-video TIDAK ikut kebawa startup app.
// MessageBubble.js statis diimport ChatScreen.js yang statis diimport
// App.js (dibutuhkan stack registration React Navigation) — kalau
// expo-video di-import langsung di top-level MessageBubble.js, dia akan
// ke-require SETIAP kali layar chat manapun dibuka (nyaris selalu),
// persis masalah yang sudah pernah diperbaiki utk MediaViewerModal.js
// (lihat catatan lazy() di ChatScreen.js) — di sini dampaknya malah lebih
// langsung karena MessageBubble dirender utk SEMUA pesan, bukan cuma saat
// user buka galeri fullscreen.
import React from "react";
import { VideoView, useVideoPlayer } from "expo-video";

// BUG (fix): thumbnail video SEBELUMNYA cuma kotak polos warna gelap + ikon
// Play — tidak pernah menampilkan frame video (beda dari WhatsApp asli yang
// tampilkan frame pertama sebagai cover). expo-video me-render frame
// pertama video ke VideoView begitu player selesai load aset, WALAU dalam
// kondisi paused (tidak pernah dipanggil .play()) — cukup untuk kebutuhan
// cover/thumbnail statis, tidak perlu library thumbnail-extractor terpisah.
export default function VideoThumbPreview({ uri, style }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.muted = true; });
  return (
    <VideoView
      player={player}
      style={style}
      contentFit="cover"
      nativeControls={false}
      pointerEvents="none"
    />
  );
}
