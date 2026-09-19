// Pintu masuk tautan dari sistem Android. Foto yang dibagikan ("Bagikan → SANO Finance") datang
// sebagai tautan khusus expo-share-intent; kita arahkan ke sheet Transaksi cepat.
// Tautan lain (sanofinance://…) diteruskan apa adanya ke Expo Router.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (new URL(path).hostname === "expo-share-intent") return "/aksi-cepat";
    return path;
  } catch {
    return "/";
  }
}
