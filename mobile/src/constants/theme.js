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
    card: 16,
    control: 12,
  },
  font: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semiBold: "Inter_600SemiBold",
  },
};
