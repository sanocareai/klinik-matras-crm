// Ikut skema warna sistem HP (10 Sep 2026) — useColorScheme() bawaan
// react-native (app.json sudah "userInterfaceStyle": "automatic" sejak
// scaffold awal, cuma belum ada konsumennya). "dark" jadi fallback kalau
// skema sistem null (beberapa Android lama/tertentu bisa begitu) — app ini
// dari awal dirancang navy-first, jadi fallback yang aman adalah tema
// yang SUDAH terverifikasi jalan, bukan asumsi terang.
import { useColorScheme } from "react-native";
import { darkColors, lightColors } from "../theme";

export function useTheme() {
  const scheme = useColorScheme();
  return scheme === "light" ? lightColors : darkColors;
}
