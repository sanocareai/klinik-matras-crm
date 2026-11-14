// TOKEN DESAIN — "Biru Kaca" (kanvas SANSS Produksi v2, Nov 2026): latar gradasi biru es + bayangan cahaya,
// kartu kaca bening, satu keluarga biru (Bleu Ciel #007BFF sebagai brand), oranye HANYA untuk urgent/komplain,
// hijau HANYA untuk selesai. Teks berwarna memakai varian gelap supaya kontras ≥ 4.5:1 di atas putih/kaca.

export const C = {
  bg: "#EAF2FE", // warna dasar (di belakang gradasi <Latar>)
  card: "#FFFFFF", // permukaan SOLID (isian formulir, baris di dalam panel kaca)
  ink: "#0B1B3F",
  ink2: "#2B3A52",
  ink3: "#5A6B85", // label sekunder — lolos 4.5:1 di atas putih & kaca terang
  line: "rgba(11,27,63,0.09)",
  fill: "rgba(255,255,255,0.55)", // jalur segmented / kolom cari di atas latar
  barBg: "rgba(255,255,255,0.86)",
  barLine: "rgba(255,255,255,0.95)",
  white: "#FFFFFF",
} as const;

/** Kaca: isian putih tembus pandang + tepi putih + kilau atas. Tanpa blur nyata di kartu daftar (ringan). */
export const G = {
  fill: "rgba(255,255,255,0.62)",
  fillStrong: "rgba(255,255,255,0.82)",
  fillOnBlue: "rgba(255,255,255,0.18)", // kaca di atas kartu biru
  stroke: "rgba(255,255,255,0.92)",
  strokeOnBlue: "rgba(255,255,255,0.40)",
  shadow: "#14408C",
} as const;

/** Gradasi (atas-kiri → bawah-kanan). */
export const GRAD = {
  latar: ["#D6E7FF", "#EAF2FE", "#F4F8FE"] as const,
  brand: ["#4AA3FF", "#007BFF", "#0A55D1"] as const, // kartu utama, tombol +
  navy: ["#1951FC", "#0B2CB1", "#03195B"] as const, // kartu QC
  orb: ["#8FD0FF", "#1F6BFF", "#0B3FC0"] as const, // bola ikon menu
  orbOranye: ["#FFC09A", "#FF6A1A", "#D94800"] as const,
  tombol: ["#2A86FF", "#0A5BD8"] as const, // tombol utama (teks putih tetap ≥ 4.5:1)
} as const;

/** Warna sistem (isian, titik, ikon) + teks gelap + latar tipis — semua dalam keluarga biru kecuali status. */
export const TONE = {
  blue: { fill: "#007BFF", text: "#0062CC", tint: "#E3F0FF" },
  green: { fill: "#22C55E", text: "#15803D", tint: "#E3F7E8" },
  orange: { fill: "#FF5A00", text: "#C43D00", tint: "#FFE8DC" },
  red: { fill: "#E5484D", text: "#B3261E", tint: "#FFE5E7" },
  purple: { fill: "#0B2CB1", text: "#0B2CB1", tint: "#E3E9FF" }, // QC & Dokumentasi = navy
  indigo: { fill: "#1951FC", text: "#1240C8", tint: "#E3EBFF" }, // Meja
  teal: { fill: "#0EA5C6", text: "#0E7490", tint: "#DFF4F9" }, // Corner
  gray: { fill: "#C5D0E0", text: "#2B3A52", tint: "#EEF2F8" },
} as const;
export type ToneKey = keyof typeof TONE;

/** Warna tim: Meja biru, QC & Dokumentasi navy, Corner toska, Admin Bleu Ciel. */
export const TEAM = { meja: "indigo", qc: "purple", corner: "teal", admin: "blue" } as const satisfies Record<string, ToneKey>;

export const R = { card: 24, hero: 30, btn: 28, chip: 999, num: 14, tile: 24 } as const;
export const S = { gutter: 16, gap: 14 } as const;

export const F = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  heavy: "PlusJakartaSans_800ExtraBold",
} as const;

/** Tinggi minimum target sentuh lantai produksi (tangan kotor/berlem). */
export const TOUCH = 56;
