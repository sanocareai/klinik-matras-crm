// Palet warna gaya WhatsApp + aksen brand Klinik Matras — dipakai layar lama
// (Login, header non-light lainnya). Sama seperti constants/theme.js,
// `colors` sekarang REAKTIF ikut Appearance sistem HP lewat useColors() —
// lihat catatan pola pemakaian panjang di constants/theme.js (useTokens()),
// pola di sini SAMA PERSIS cuma nama beda (useColors() bukan useTokens()).
import { useColorScheme } from "react-native";

const LIGHT = {
  // Gaya WhatsApp
  header: "#2064b7",        // biru tua header
  headerText: "#ffffff",
  accent: "#225594",        // biru tombol/FAB
  chatBg: "#ECE5DD",        // latar area chat
  bubbleOut: "#aed3ff",     // bubble pesan keluar
  bubbleIn: "#ffffff",      // bubble pesan masuk
  tick: "#4FC3F7",

  // Umum
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e5e7eb",
  text: "#111827",
  textSecondary: "#6b7280",
  textMuted: "#9ca3af",
  danger: "#dc2626",
  warning: "#f59e0b",
  primary: "#2563eb",       // biru brand CRM (badge, link)
};

// Padanan gelap — key SAMA PERSIS dengan LIGHT. tick sengaja dipertahankan
// sama (cyan terang sudah kontras baik di kedua tema).
const DARK = {
  header: "#122A4D",
  headerText: "#ffffff",
  accent: "#3B7DD8",
  chatBg: "#0B1220",
  bubbleOut: "#1E3A5F",
  bubbleIn: "#141B2D",
  tick: "#4FC3F7",

  bg: "#0B1220",
  card: "#141B2D",
  border: "#2A3349",
  text: "#F1F5F9",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  danger: "#f87171",
  warning: "#fbbf24",
  primary: "#3B82F6",
};

// Export statis TETAP ADA (default LIGHT) — dipakai di tempat yang genuinely
// tidak bisa akses hook. Komponen React harus pakai useColors() di bawah.
export const colors = LIGHT;

export function useColors() {
  const scheme = useColorScheme();
  return scheme === "dark" ? DARK : LIGHT;
}

// Warna avatar inisial & badge pipeline — SENGAJA TIDAK ikut tema (sama di
// light/dark): ini warna aksen semantik/identitas, bukan warna permukaan,
// dan sudah cukup vivid+kontras untuk dipakai di atas card terang MAUPUN
// gelap tanpa perlu varian terpisah (konsisten juga dengan versi web yang
// juga tidak punya dark mode utk badge-badge ini).
export const avatarColors = [
  "#2563eb", "#16a34a", "#f59e0b", "#dc2626",
  "#7c3aed", "#ec4899", "#f97316", "#0891b2",
];

export const stageColors = {
  LEAD: "#f59e0b",
  QUALIFIED: "#2563eb",
  QUOTED: "#7c3aed",
  WON: "#16a34a",
  LOST: "#dc2626",
};

export const stageLabels = {
  LEAD: "Lead",
  QUALIFIED: "Qualified",
  QUOTED: "Offers/Negosiasi",
  WON: "Won",
  LOST: "Lost",
};
