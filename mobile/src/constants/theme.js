// Design tokens terpusat — palet light-blue, konsisten dengan CRM web yang
// baru di-rebuild (card putih rounded-2xl soft shadow, aksen blue-600).
// CATATAN: src/theme.js (lama, gaya WhatsApp hijau/biru tua) TETAP dipakai
// layar existing supaya tidak ada perubahan visual mendadak yang belum
// ditest. File ini fondasi untuk komponen/layar baru ke depan (Fase M-B+).
export const tokens = {
  color: {
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
  },
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
  shadow: {
    soft: {
      shadowColor: "#0F172A",
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
