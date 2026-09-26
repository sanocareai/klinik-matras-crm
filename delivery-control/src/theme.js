import { Platform, useColorScheme } from "react-native";

// DESIGN TOKENS Sano Delivery Control (redesign 26 Sep 2026).
// Palet: navy (teks & hero), royal blue (aksi utama), cyan (aksen), putih, dan hijau untuk status positif.
// Mode terang = tampilan utama; mode gelap setara (bukan inversi). Semua komponen mengambil warna dari sini.
const light = {
  scheme: "light",
  bg: "#F3F6FC", bgTop: "#E7EEFB", surface: "#FFFFFF", surface2: "#F6F8FD", raised: "#FFFFFF",
  ink: "#0B1B36", ink2: "#4E5D78", ink3: "#8793A8",
  border: "rgba(11,27,54,0.07)", borderStrong: "rgba(11,27,54,0.14)", field: "#F1F4FA", fieldBorder: "rgba(11,27,54,0.10)",
  navy: "#0B1F44", accent: "#2F5BEA", accentInk: "#FFFFFF", accentBg: "rgba(47,91,234,0.10)", accentSoft: "#E8EEFF",
  cyan: "#0EA5C9", cyanBg: "rgba(14,165,201,0.12)",
  green: "#16A34A", greenBg: "rgba(22,163,74,0.12)", red: "#DC2626", redBg: "rgba(220,38,38,0.10)",
  orange: "#C2610C", orangeBg: "rgba(234,120,20,0.13)", neutralBg: "rgba(11,27,54,0.06)",
  hero: ["#0B1F44", "#1E3F9E", "#2F7BEA"], heroInk: "#FFFFFF", heroInk2: "rgba(255,255,255,0.74)",
  navBg: "rgba(255,255,255,0.96)", scrim: "rgba(8,18,37,0.45)",
  tabActive: "#0B1F44", tabActiveInk: "#FFFFFF",
  shadow: "#0B1F44", shadowOpacity: 0.08,
  statusBar: "dark",
};
const dark = {
  scheme: "dark",
  bg: "#07101F", bgTop: "#0C1A33", surface: "#0F1C33", surface2: "#132440", raised: "#162946",
  ink: "#EEF3FF", ink2: "rgba(226,234,252,0.70)", ink3: "rgba(226,234,252,0.44)",
  border: "rgba(255,255,255,0.07)", borderStrong: "rgba(255,255,255,0.14)", field: "#132440", fieldBorder: "rgba(255,255,255,0.10)",
  navy: "#0B1F44", accent: "#6E95FF", accentInk: "#07101F", accentBg: "rgba(110,149,255,0.16)", accentSoft: "#182B52",
  cyan: "#4FD1F2", cyanBg: "rgba(79,209,242,0.14)",
  green: "#34D399", greenBg: "rgba(52,211,153,0.15)", red: "#F87171", redBg: "rgba(248,113,113,0.15)",
  orange: "#FBA74A", orangeBg: "rgba(251,167,74,0.15)", neutralBg: "rgba(255,255,255,0.07)",
  hero: ["#0E2352", "#1D3F9C", "#2B6FD8"], heroInk: "#FFFFFF", heroInk2: "rgba(255,255,255,0.74)",
  navBg: "rgba(19,36,64,0.97)", scrim: "rgba(0,0,0,0.6)",
  tabActive: "#6E95FF", tabActiveInk: "#07101F",
  shadow: "#000000", shadowOpacity: 0.35,
  statusBar: "light",
};

export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };
export const type = {
  display: { fontSize: 30, fontWeight: "800", letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  body: { fontSize: 14, fontWeight: "500" },
  label: { fontSize: 13, fontWeight: "600" },
  caption: { fontSize: 12, fontWeight: "500" },
  overline: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9 },
  amount: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3, fontVariant: ["tabular-nums"] },
};

export function useTheme() {
  return useColorScheme() === "dark" ? dark : light;
}

/** Bayangan lembut yang sama di seluruh aplikasi (lebih rendah di mode gelap; dibantu border). */
export function elevation(t, level = 1) {
  const r = level === 2 ? 22 : 14;
  return Platform.select({
    android: { elevation: t.scheme === "dark" ? level : level * 3, shadowColor: t.shadow },
    default: { shadowColor: t.shadow, shadowOpacity: t.shadowOpacity, shadowRadius: r, shadowOffset: { width: 0, height: level * 4 } },
  });
}

export function toneColors(t, tone) {
  if (tone === "green") return { fg: t.green, bg: t.greenBg };
  if (tone === "red") return { fg: t.red, bg: t.redBg };
  if (tone === "accent") return { fg: t.accent, bg: t.accentBg };
  if (tone === "orange") return { fg: t.orange, bg: t.orangeBg };
  if (tone === "cyan") return { fg: t.cyan, bg: t.cyanBg };
  return { fg: t.ink2, bg: t.neutralBg };
}
