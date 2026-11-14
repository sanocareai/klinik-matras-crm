import { Platform } from "react-native";
import * as Device from "expo-device";
import { useKurangiGerak } from "./gerak";

// TIER KACA — supaya HP Android kelas menengah tetap ringan (cermin finance-mobile/src/design/glass.ts):
//   FULL    HP kuat — dicadangkan untuk blur nyata nanti (saat ini sama dengan LITE; expo-blur belum dipasang)
//   LITE    tanpa blur: tembus pandang + tepi putih + kilau (tampilan yang dipakai sekarang)
//   MINIMAL kartu putih solid tanpa bayangan berlapis (gerak dikurangi)
// pickGlassTier MURNI (mudah diuji): masukan = fakta perangkat, keluaran = tier.

export type GlassTier = "FULL" | "LITE" | "MINIMAL";
export type GlassInput = { androidApi: number; totalMemoryBytes: number | null; kurangiGerak: boolean };

const GB = 1024 * 1024 * 1024;

export function pickGlassTier(i: GlassInput): GlassTier {
  if (i.kurangiGerak) return "MINIMAL";
  if (i.androidApi < 31) return "LITE"; // blur Android butuh API 31+
  if (i.totalMemoryBytes == null || i.totalMemoryBytes < 3.5 * GB) return "LITE"; // RAM tidak diketahui → jangan ambil risiko
  return "FULL";
}

let tierCache: GlassTier | null = null;

/** Tier kaca perangkat ini; ikut berubah bila pengguna menyalakan "Kurangi gerakan". */
export function useGlassTier(): GlassTier {
  const kurangiGerak = useKurangiGerak();
  if (kurangiGerak) return "MINIMAL";
  tierCache ??= pickGlassTier({
    androidApi: Platform.OS === "android" ? Number(Platform.Version) || 0 : 0,
    totalMemoryBytes: Device.totalMemory ?? null,
    kurangiGerak: false,
  });
  return tierCache;
}
