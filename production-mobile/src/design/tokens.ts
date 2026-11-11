// TOKEN DESAIN — gaya iOS (kanvas "SANSS Production App"): latar abu grouped, kartu putih membulat,
// warna sistem untuk isian/ikon, varian GELAP untuk teks berwarna (kontras ≥ 4.5:1 di atas putih).

export const C = {
  bg: "#F2F2F7",
  card: "#FFFFFF",
  ink: "#1C1C1E",
  ink2: "#3A3A3C",
  ink3: "#6C6C70", // label sekunder — lolos 4.5:1 di atas bg & card
  line: "#E5E5EA",
  fill: "#E3E3E8", // kolom cari / segmented
  barBg: "rgba(249,249,249,0.96)",
  barLine: "#D1D1D6",
  white: "#FFFFFF",
} as const;

/** Warna sistem (isian, titik, ikon) + teks gelap + latar tipis. */
export const TONE = {
  blue: { fill: "#007AFF", text: "#0062CC", tint: "#E5F0FF" },
  green: { fill: "#34C759", text: "#1F7A35", tint: "#E3F7E8" },
  orange: { fill: "#FF9500", text: "#B25000", tint: "#FFF0DC" },
  red: { fill: "#FF3B30", text: "#C4000F", tint: "#FFE5E7" },
  purple: { fill: "#AF52DE", text: "#8E3BB8", tint: "#F4E8FB" },
  indigo: { fill: "#5856D6", text: "#3D3BB0", tint: "#ECECFC" },
  teal: { fill: "#30B0C7", text: "#0E7490", tint: "#E0F4F8" },
  gray: { fill: "#C7C7CC", text: "#3A3A3C", tint: "#EBEBF0" },
} as const;
export type ToneKey = keyof typeof TONE;

/** Warna tim: Meja indigo, QC & Dokumentasi ungu, Corner teal, Admin biru. */
export const TEAM = { meja: "indigo", qc: "purple", corner: "teal", admin: "blue" } as const satisfies Record<string, ToneKey>;

export const R = { card: 20, hero: 22, btn: 16, chip: 999, num: 13 } as const;
export const S = { gutter: 16, gap: 14 } as const;

export const F = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  heavy: "Inter_800ExtraBold",
} as const;

/** Tinggi minimum target sentuh lantai produksi (tangan kotor/berlem). */
export const TOUCH = 56;
