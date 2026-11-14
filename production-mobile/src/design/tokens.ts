// TOKEN DESAIN — "Biru Kaca" (kanvas SANSS Produksi v2, Nov 2026): latar gradasi biru es + bayangan cahaya,
// kartu kaca bening, satu keluarga biru (Bleu Ciel #007BFF sebagai brand), oranye HANYA untuk urgent/komplain,
// hijau HANYA untuk selesai. Teks berwarna memakai varian gelap supaya kontras ≥ 4.5:1 di atas putih/kaca.

export const C = {
  bg: "#EAF2FE", // warna dasar (di belakang gradasi <Latar>)
  card: "#FFFFFF", // permukaan SOLID (baris putih di dalam panel kaca)
  isian: "#EEF4FB", // kotak isian / baris pilihan di dalam kartu putih atau lembar kaca (mockup: latar tombol #EEF4FB)
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

/** Warna sistem (isian, titik, ikon) + teks gelap + latar tipis — semua dalam keluarga biru kecuali status. */
export const TONE = {
  blue: { fill: "#007BFF", text: "#0062CC", tint: "#E3F0FF" },
  green: { fill: "#22C55E", text: "#15803D", tint: "#E3F7E8" },
  orange: { fill: "#FF5A00", text: "#C43D00", tint: "#FFE8DC" },
  red: { fill: "#E5484D", text: "#B3261E", tint: "#FFE5E7" },
  purple: { fill: "#0B2CB1", text: "#0B2CB1", tint: "#E3E9FF" }, // QC & Dokumentasi = navy
  indigo: { fill: "#1951FC", text: "#1240C8", tint: "#E3EBFF" }, // Meja
  teal: { fill: "#0EA5C6", text: "#0E7490", tint: "#DFF4F9" }, // Corner
  gray: { fill: "#C5D0E0", text: "#42526B", tint: "#F2F6FB" },
} as const;
export type ToneKey = keyof typeof TONE;

/** Warna tim: Meja biru, QC & Dokumentasi navy, Corner toska, Admin Bleu Ciel. */
export const TEAM = { meja: "indigo", qc: "purple", corner: "teal", admin: "blue" } as const satisfies Record<string, ToneKey>;

/**
 * KACA & BOLA — nilai CSS PERSIS dari kanvas mockup "SANSS Produksi v2" (artboard 390×844; 1 px CSS = 1 dp).
 * `bg` dipakai lewat `experimental_backgroundImage`, `bayang` lewat `boxShadow` (React Native 0.86, arsitektur baru) — jadi
 * sudut gradasi 150° dan bayangan berwarna sama dengan mockup, tanpa View tambahan. Mockup memakai backdrop-blur; latar kita
 * sudah halus (gradasi + pendar blur), jadi isian tembus pandang saja memberi hasil yang sama tanpa biaya blur per-frame.
 */
export const KACA = {
  utama: { bg: "linear-gradient(150deg, rgba(255,255,255,0.32), rgba(255,255,255,0.10))", tepi: "rgba(255,255,255,0.55)", bayang: "0 20px 40px rgba(5,40,140,0.25), inset 0 1px 0 rgba(255,255,255,0.7)" },
  utamaNavy: { bg: "linear-gradient(150deg, rgba(255,255,255,0.26), rgba(255,255,255,0.06))", tepi: "rgba(255,255,255,0.45)", bayang: "0 20px 40px rgba(3,25,91,0.35), inset 0 1px 0 rgba(255,255,255,0.6)" },
  ubin: { bg: "linear-gradient(150deg, rgba(255,255,255,0.38), rgba(255,255,255,0.10))", tepi: "rgba(255,255,255,0.55)", bayang: "0 10px 24px rgba(5,40,140,0.18), inset 0 1px 0 rgba(255,255,255,0.7)" },
  ubinNavy: { bg: "linear-gradient(150deg, rgba(255,255,255,0.34), rgba(255,255,255,0.08))", tepi: "rgba(255,255,255,0.5)", bayang: "0 10px 24px rgba(3,25,91,0.25), inset 0 1px 0 rgba(255,255,255,0.65)" },
  mini: { bg: "linear-gradient(150deg, rgba(255,255,255,0.34), rgba(255,255,255,0.10))", tepi: "rgba(255,255,255,0.55)", bayang: "inset 0 1px 0 rgba(255,255,255,0.7)" },
  panel: { bg: "rgba(255,255,255,0.45)", tepi: "rgba(255,255,255,0.8)", bayang: "0 16px 36px rgba(20,60,140,0.14), inset 0 1px 0 #FFFFFF" },
  dalam: { bg: "rgba(255,255,255,0.16)", tepi: "rgba(255,255,255,0.4)" }, // panel kecil DI DALAM kartu utama
  bulat: { bg: "rgba(255,255,255,0.20)", tepi: "rgba(255,255,255,0.5)", bayang: "inset 0 1px 0 rgba(255,255,255,0.6)" }, // tombol bulat atas
  pil: { bg: "rgba(255,255,255,0.22)", tepi: "rgba(255,255,255,0.45)" }, // chip di atas biru (Live, jam)
  tombolPutih: { bg: "rgba(255,255,255,0.95)", bayang: "0 8px 20px rgba(5,40,140,0.25), inset 0 1px 0 #FFFFFF" },
  navbar: { bg: "rgba(255,255,255,0.97)", tepi: "rgba(255,255,255,0.95)", bayang: "0 12px 34px rgba(20,60,140,0.16), inset 0 1px 0 #FFFFFF" },
  lensa: { bg: "rgba(255,255,255,0.95)", tepi: "rgba(0,98,204,0.10)", bayang: "0 3px 12px rgba(20,60,140,0.14), inset 0 1px 0 #FFFFFF" },
  plus: { bg: "linear-gradient(150deg, #4AA3FF, #007BFF 55%, #0A55D1)", tepi: "rgba(255,255,255,0.7)", bayang: "0 12px 28px rgba(0,98,204,0.35), inset 0 1px 0 rgba(255,255,255,0.6)" },
} as const;
export const ORB = {
  biru: { bg: "radial-gradient(circle at 35% 30%, #8FD0FF, #1F6BFF 60%, #0B3FC0)", bayang: "0 6px 14px rgba(5,40,140,0.35), inset 0 1px 0 rgba(255,255,255,0.6)" },
  navy: { bg: "radial-gradient(circle at 35% 30%, #8FD0FF, #1951FC 60%, #0B2CB1)", bayang: "0 6px 14px rgba(3,25,91,0.4), inset 0 1px 0 rgba(255,255,255,0.6)" },
  oranye: { bg: "radial-gradient(circle at 35% 30%, #FFC09A, #FF6A1A 60%, #D94800)", bayang: "0 6px 14px rgba(200,70,0,0.35), inset 0 1px 0 rgba(255,255,255,0.6)" },
} as const;
/** Latar layar (gradasi 180°) — persis mockup: Beranda Admin/PIC (biru) dan Beranda QC (navy). */
export const LATAR = {
  biru: { colors: ["#0B4FE0", "#1F6BFF", "#3E8BFF", "#CFE4FF", "#EAF3FF"], locations: [0, 0.34, 0.56, 0.72, 1] },
  navy: { colors: ["#03195B", "#0B2CB1", "#1951FC", "#BFD9FF", "#EAF3FF"], locations: [0, 0.30, 0.54, 0.72, 1] },
} as const;

export const R = { card: 28, hero: 30, btn: 27, chip: 11, num: 14, tile: 24, baris: 20 } as const;
export const S = { gutter: 20, gap: 16 } as const;

export const F = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  heavy: "PlusJakartaSans_800ExtraBold",
} as const;

/** Tinggi minimum target sentuh lantai produksi (tangan kotor/berlem). */
export const TOUCH = 54;
