// Token warna light/dark (10 Sep 2026, permintaan owner: "tambah mode
// light mode, dark mode sesuai sistem hp"). Nama key SAMA persis dengan
// const warna hardcode yang sudah dipakai tiap layar/komponen (NAVY,
// SURFACE, INK, dst) — supaya migrasinya murni "ganti sumbernya", bukan
// mengarang skema baru.
//
// 12 Sep 2026 — REPALET ke Sano Blue #2D64B6 (permintaan owner, referensi
// Gojek/Grab/DelTrack driver-app: "warna juga gue ingin ganti deh untuk
// light mode dan dark mode dengan dominan warna biru sano #2d64b6").
// ACCENT sekarang DIBEDAKAN per tema (beda dari skema lama yang menyamakan
// ACCENT) karena #2D64B6 murni kontrasnya sudah pas di atas putih, tapi
// agak gelap kalau dipakai langsung di atas navy gelap — jadi dark mode
// pakai versi dinaikkan brightness-nya (#5B93E0), light mode pakai warna
// brand asli. NAVY (ground) di kedua tema diberi tint biru tipis (bukan
// abu/hitam netral) supaya identitas biru Sano terasa bahkan di area
// kosong, bukan cuma di tombol/ikon.
export const darkColors = {
  NAVY: "#0A1424",
  SURFACE: "#131E33",
  INK: "#F5F5F7",
  INK2: "rgba(245,245,247,0.62)",
  INK3: "rgba(245,245,247,0.40)",
  BORDER: "rgba(255,255,255,0.15)",
  FIELD_BG: "rgba(255,255,255,0.06)",
  TRACK_BG: "rgba(255,255,255,0.08)",
  ACCENT: "#5B93E0",
  ACCENT_BG: "rgba(91,147,224,0.16)",
  GREEN: "#30D158",
  RED: "#FF453A",
  ORANGE: "#FF9F0A",
  statusBarStyle: "light",
};

export const lightColors = {
  NAVY: "#F3F6FC", // ground (nama field dipertahankan biar konsumen tidak perlu tahu tema aktif)
  SURFACE: "#FFFFFF",
  INK: "#0A0D16",
  INK2: "rgba(10,13,22,0.62)",
  INK3: "rgba(10,13,22,0.40)",
  BORDER: "rgba(10,13,22,0.12)",
  FIELD_BG: "rgba(10,13,22,0.04)",
  TRACK_BG: "rgba(10,13,22,0.08)",
  ACCENT: "#2D64B6",
  ACCENT_BG: "rgba(45,100,182,0.10)",
  GREEN: "#1E9A4B",
  RED: "#D93025",
  ORANGE: "#B26B00",
  statusBarStyle: "dark",
};
