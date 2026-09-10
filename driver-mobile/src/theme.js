// Token warna light/dark (10 Sep 2026, permintaan owner: "tambah mode
// light mode, dark mode sesuai sistem hp"). Nama key SAMA persis dengan
// const warna hardcode yang sudah dipakai tiap layar/komponen (NAVY,
// SURFACE, INK, dst) — supaya migrasinya murni "ganti sumbernya", bukan
// mengarang skema baru. ACCENT dibiarkan SAMA di kedua tema (identitas
// brand, kontrasnya masih cukup di atas putih maupun navy) — hanya warna
// permukaan/teks/status yang benar-benar butuh dibalik.
export const darkColors = {
  NAVY: "#0A0D16",
  SURFACE: "#171B2E",
  INK: "#F5F5F7",
  INK2: "rgba(245,245,247,0.62)",
  INK3: "rgba(245,245,247,0.40)",
  BORDER: "rgba(255,255,255,0.15)",
  FIELD_BG: "rgba(255,255,255,0.06)",
  TRACK_BG: "rgba(255,255,255,0.08)",
  ACCENT: "#4C8DFF",
  ACCENT_BG: "rgba(76,141,255,0.14)",
  GREEN: "#30D158",
  RED: "#FF453A",
  ORANGE: "#FF9F0A",
  statusBarStyle: "light",
};

export const lightColors = {
  NAVY: "#F2F3F7", // ground (nama field dipertahankan biar konsumen tidak perlu tahu tema aktif)
  SURFACE: "#FFFFFF",
  INK: "#0A0D16",
  INK2: "rgba(10,13,22,0.62)",
  INK3: "rgba(10,13,22,0.40)",
  BORDER: "rgba(10,13,22,0.12)",
  FIELD_BG: "rgba(10,13,22,0.04)",
  TRACK_BG: "rgba(10,13,22,0.08)",
  ACCENT: "#3D74E0",
  ACCENT_BG: "rgba(61,116,224,0.10)",
  GREEN: "#1E9A4B",
  RED: "#D93025",
  ORANGE: "#B26B00",
  statusBarStyle: "dark",
};
