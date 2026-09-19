// TOKEN DESAIN "BIRU KACA" — satu-satunya sumber warna/ukuran (tidak ada warna literal di layar).
// Basis: docs/design-system/sano-color-system.md (brand-600 #2064B7) + referensi visual
// docs/references/finance-mobile/.

export type Scheme = "light" | "dark";
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export type Colors = {
  bgTop: string;
  bgBottom: string;
  blob1: string;
  blob2: string;
  glassFill: string;
  glassFillStrong: string;
  glassStroke: string;
  solid: string;
  solidAlt: string;
  hairline: string;
  shadow: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  text: string;
  textMuted: string;
  textFaint: string;
  heroFrom: string;
  heroTo: string;
  heroText: string;
  heroTextMuted: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  neutral: string;
  neutralSoft: string;
  tabBar: string;
  overlay: string;
};

export const colors: Record<Scheme, Colors> = {
  light: {
    bgTop: "#F3F7FD",
    bgBottom: "#DCE9FA",
    blob1: "rgba(46,125,218,0.18)",
    blob2: "rgba(123,177,234,0.22)",
    glassFill: "rgba(255,255,255,0.62)",
    glassFillStrong: "rgba(255,255,255,0.82)",
    glassStroke: "rgba(255,255,255,0.9)",
    solid: "#FFFFFF",
    solidAlt: "#F1F5FB",
    hairline: "rgba(15,30,58,0.08)",
    shadow: "#123655",
    primary: "#2064B7",
    primarySoft: "#EAF2FC",
    onPrimary: "#FFFFFF",
    text: "#0F1E3A",
    textMuted: "#5B6B85",
    textFaint: "#8A97AD",
    heroFrom: "#1E5AA8",
    heroTo: "#123655",
    heroText: "#FFFFFF",
    heroTextMuted: "rgba(255,255,255,0.72)",
    success: "#15803D",
    successSoft: "#DCFCE7",
    warning: "#B45309",
    warningSoft: "#FEF3C7",
    danger: "#DC2626",
    dangerSoft: "#FEE2E2",
    info: "#2064B7",
    infoSoft: "#EAF2FC",
    neutral: "#5B6B85",
    neutralSoft: "#E8EDF5",
    tabBar: "#FCFDFF",
    overlay: "rgba(10,23,48,0.45)",
  },
  dark: {
    bgTop: "#0E2A55",
    bgBottom: "#0A1730",
    blob1: "rgba(79,151,227,0.28)",
    blob2: "rgba(46,125,218,0.22)",
    glassFill: "rgba(91,143,224,0.14)",
    glassFillStrong: "rgba(91,143,224,0.24)",
    glassStroke: "rgba(255,255,255,0.16)",
    solid: "#14284D",
    solidAlt: "#0F2142",
    hairline: "rgba(255,255,255,0.10)",
    shadow: "#000000",
    primary: "#4F97E3",
    primarySoft: "rgba(79,151,227,0.18)",
    onPrimary: "#0A1730",
    text: "#F2F6FF",
    textMuted: "#9DB0D0",
    textFaint: "#7186A8",
    heroFrom: "#1B4B8F",
    heroTo: "#0F2F5E",
    heroText: "#FFFFFF",
    heroTextMuted: "rgba(255,255,255,0.72)",
    success: "#4ADE80",
    successSoft: "rgba(74,222,128,0.16)",
    warning: "#FBBF24",
    warningSoft: "rgba(251,191,36,0.16)",
    danger: "#F87171",
    dangerSoft: "rgba(248,113,113,0.16)",
    info: "#7BB1EA",
    infoSoft: "rgba(123,177,234,0.18)",
    neutral: "#9DB0D0",
    neutralSoft: "rgba(157,176,208,0.16)",
    tabBar: "#0F2A55",
    overlay: "rgba(0,0,0,0.6)",
  },
};

export const radius = { card: 24, sheet: 28, button: 16, chip: 999, small: 12 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
/** Gutter samping halaman (dp). */
export const GUTTER = 16;
/** Tinggi target sentuh minimum. */
export const TOUCH = 48;

export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export const type = {
  hero: { fontSize: 40, lineHeight: 46, fontFamily: font.semibold },
  title: { fontSize: 22, lineHeight: 28, fontFamily: font.semibold },
  heading: { fontSize: 16, lineHeight: 22, fontFamily: font.semibold },
  body: { fontSize: 14, lineHeight: 20, fontFamily: font.regular },
  bodyMedium: { fontSize: 14, lineHeight: 20, fontFamily: font.medium },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: font.regular },
  captionMedium: { fontSize: 12, lineHeight: 16, fontFamily: font.medium },
} as const;

export function toneColors(c: Colors, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case "success": return { fg: c.success, bg: c.successSoft };
    case "warning": return { fg: c.warning, bg: c.warningSoft };
    case "danger": return { fg: c.danger, bg: c.dangerSoft };
    case "info": return { fg: c.info, bg: c.infoSoft };
    default: return { fg: c.neutral, bg: c.neutralSoft };
  }
}
