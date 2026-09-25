import { useColorScheme } from "react-native";

// Token warna Sano (biru #2D64B6) — nilai sama dengan Sano Driver supaya kedua
// aplikasi terasa satu keluarga. Diikuti mode terang/gelap sistem.
const dark = {
  bg: "#0A1424", surface: "#131E33", ink: "#F5F5F7", ink2: "rgba(245,245,247,0.62)", ink3: "rgba(245,245,247,0.40)",
  border: "rgba(255,255,255,0.15)", field: "rgba(255,255,255,0.06)", accent: "#5B93E0", accentBg: "rgba(91,147,224,0.16)",
  green: "#30D158", greenBg: "rgba(48,209,88,0.15)", red: "#FF453A", redBg: "rgba(255,69,58,0.15)", orange: "#FF9F0A", orangeBg: "rgba(255,159,10,0.15)",
  statusBar: "light",
};
const light = {
  bg: "#F3F6FC", surface: "#FFFFFF", ink: "#0A0D16", ink2: "rgba(10,13,22,0.62)", ink3: "rgba(10,13,22,0.40)",
  border: "rgba(10,13,22,0.12)", field: "rgba(10,13,22,0.04)", accent: "#2D64B6", accentBg: "rgba(45,100,182,0.10)",
  green: "#1E9A4B", greenBg: "rgba(30,154,75,0.12)", red: "#D93025", redBg: "rgba(217,48,37,0.10)", orange: "#B26B00", orangeBg: "rgba(178,107,0,0.12)",
  statusBar: "dark",
};

export function useTheme() {
  return useColorScheme() === "dark" ? dark : light;
}

export function toneColors(t, tone) {
  if (tone === "green") return { fg: t.green, bg: t.greenBg };
  if (tone === "red") return { fg: t.red, bg: t.redBg };
  if (tone === "accent") return { fg: t.accent, bg: t.accentBg };
  return { fg: t.ink2, bg: t.field };
}
