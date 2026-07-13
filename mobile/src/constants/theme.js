// Design tokens terpusat — palet light-blue, konsisten dengan CRM web.
// CATATAN: src/theme.js (lama, gaya WhatsApp hijau/biru tua) TETAP dipakai
// layar existing supaya tidak ada perubahan visual mendadak yang belum
// ditest. File ini fondasi untuk komponen/layar baru ke depan (Fase M-B+).
//
// DARK MODE: `tokens.color` sekarang REAKTIF ikut Appearance sistem HP
// (light/dark/auto) lewat hook useTokens() di bawah — BUKAN objek statis
// lagi. React Native StyleSheet.create() dieksekusi SEKALI saat modul
// di-import (module scope), jadi TIDAK bisa otomatis ikut berubah kalau
// cuma nilai tokens.color diubah setelahnya — makanya SEMUA komponen yang
// pakai warna dari sini WAJIB pola ini (bukan `import { tokens }` statis
// lagi):
//   import { useTokens } from "../constants/theme";
//   function MyComponent() {
//     const tokens = useTokens();                          // di dalam komponen
//     const styles = useMemo(() => createStyles(tokens), [tokens]); // di dalam komponen
//     ...
//   }
//   function createStyles(tokens) { return StyleSheet.create({ ... }); }
// `tokens.radius`/`tokens.spacing`/`tokens.font`/`tokens.shadow` TIDAK
// berubah antara light/dark, tetap sama persis di kedua varian di bawah.
import { useColorScheme } from "react-native";

const LIGHT_COLOR = {
  bg: "#F8FAFC",
  card: "#FFFFFF",
  subtle: "#F1F5F9",
  border: "#E2E8F0",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  textMuted: "#94A3B8",
  accent: "#2563EB",
  accentHover: "#1D4ED8",
  accentSoft: "#EFF6FF",
  success: "#10B981",
  danger: "#F43F5E",
  warning: "#F59E0B",
};

// Padanan gelap — struktur/urutan key SAMA PERSIS dengan LIGHT_COLOR supaya
// semua kode yang sudah ada (tokens.color.X) tetap jalan tanpa ubah nama
// field apa pun, cuma NILAI yang beda. Konvensi standar dark mode: card
// SEDIKIT lebih terang dari bg (elevasi), border cukup terlihat tapi
// lembut, accent dinaikkan sedikit brightness-nya supaya kontras cukup di
// atas background gelap (WCAG-friendly), textMuted/textSecondary ditukar
// urutan gelapnya dari versi light (secondary jadi lebih terang dari muted).
const DARK_COLOR = {
  bg: "#0B1220",
  card: "#141B2D",
  subtle: "#1C2438",
  border: "#2A3349",
  textPrimary: "#F1F5F9",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  accent: "#3B82F6",
  accentHover: "#60A5FA",
  accentSoft: "#1E3A5F",
  success: "#10B981",
  danger: "#F87171",
  warning: "#FBBF24",
};

const SHARED = {
  radius: {
    card: 20,      // card/sheet — spec: 20-24
    bubble: 18,    // bubble chat
    bubbleTail: 6, // sudut "ekor" bubble (borderBottomRightRadius outbound / borderBottomLeftRadius inbound)
    control: 12,   // kontrol kecil (tombol persegi, dsb) — dipertahankan dari sebelumnya
    pill: 24,      // input/composer pill penuh
    chip: 999,     // filter chip / pill tab — bulat penuh
  },
  // Soft elevation ala Apple — GANTI border keras yang tersisa di card
  // manapun dengan ini, jangan campur border+shadow di komponen yang sama.
  // shadowColor tetap hitam di kedua tema (shadow gelap masih masuk akal
  // di atas card yang lebih terang dari bg-nya sendiri, dark mode ATAU light).
  shadow: {
    soft: {
      shadowColor: "#000000",
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3, // Android — react-native-shadow tidak baca shadow* di Android
    },
  },
  spacing: {
    screen: 16, // padding default layar
    gap: 12,    // gap antar card
  },
  font: {
    regular: "Inter_400Regular", // body — weight 400
    medium: "Inter_500Medium",   // angka/stat — weight 500
    semiBold: "Inter_600SemiBold", // judul — weight 600
  },
};

// Export statis TETAP ADA (default LIGHT) — dipakai di tempat yang genuinely
// tidak bisa akses hook (di luar komponen React, mis. konstanta modul-level
// murni). SEMUA komponen React harus pakai useTokens() di bawah, BUKAN ini,
// supaya reaktif ikut tema sistem.
export const tokens = { color: LIGHT_COLOR, ...SHARED };

// Hook utama — panggil di dalam body komponen. Ikut Appearance sistem HP
// otomatis (useColorScheme dari react-native sudah subscribe ke perubahan
// sistem bawaan, termasuk saat user ganti tema HP SAAT app sedang dibuka
// — tidak perlu restart app).
export function useTokens() {
  const scheme = useColorScheme();
  const color = scheme === "dark" ? DARK_COLOR : LIGHT_COLOR;
  return { color, ...SHARED };
}

// Dipakai tempat yang cuma butuh tahu light/dark (mis. pilih icon/status bar
// style) tanpa perlu seluruh objek tokens.
export function useIsDarkMode() {
  return useColorScheme() === "dark";
}
