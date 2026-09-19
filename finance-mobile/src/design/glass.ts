// TIER GLASS — kaca yang tetap ringan di Android lama (PRD §10.3).
//
//   FULL    blur nyata (expo-blur, hanya ≤ 2 permukaan per layar)
//   LITE    tanpa blur: translucent + gradien + hairline
//   MINIMAL kartu solid, tanpa bayangan berlapis
//
// Fungsi di bawah MURNI (mudah diuji): masukan = fakta perangkat, keluaran = tier.

export type GlassTier = "FULL" | "LITE" | "MINIMAL";

export type GlassInput = {
  /** Versi Android (API level); iOS/lainnya = 0. */
  androidApi: number;
  /** Total RAM (byte) bila diketahui. */
  totalMemoryBytes: number | null;
  /** Pilihan pengguna "Efek Ringan". */
  efekRingan: boolean;
  /** Pengguna meminta gerak dikurangi / hemat daya. */
  kurangiGerak: boolean;
};

const GB = 1024 * 1024 * 1024;

export function pickGlassTier(input: GlassInput): GlassTier {
  if (input.kurangiGerak) return "MINIMAL";
  if (input.efekRingan) return "LITE";
  if (input.androidApi < 31) return "LITE";
  // RAM tidak diketahui → jangan ambil risiko blur.
  if (input.totalMemoryBytes == null || input.totalMemoryBytes < 3.5 * GB) return "LITE";
  return "FULL";
}

/** Berapa BlurView boleh aktif dalam satu layar (aturan §10.3). */
export const MAX_BLUR_PER_SCREEN = 2;
