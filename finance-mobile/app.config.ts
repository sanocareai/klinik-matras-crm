import fs from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

// KONFIGURASI SANO FINANCE (Expo SDK 57).
//
// Tiga varian dipilih lewat APP_VARIANT (diatur per profil di eas.json):
//   development → paket .dev,     nama "(Dev)",     kanal EAS Update "development"
//   preview     → paket .preview, nama "(Preview)", kanal "preview"
//   production  → paket utama,                      kanal "production"
// Paketnya berbeda supaya ketiganya bisa terpasang BERSAMAAN di satu HP.
//
// runtimeVersion memakai kebijakan "appVersion" (fingerprint gagal di build cloud, lihat catatan di bawah): OTA hanya sampai ke build dengan versi sama —
// naikkan `version` setiap kode native berubah.

type Variant = "development" | "preview" | "production";
const raw = process.env.APP_VARIANT;
const VARIANT: Variant = raw === "preview" || raw === "production" ? raw : "development";

const BASE_PACKAGE = "com.sanomatrassehat.finance";
const SUFFIX: Record<Variant, string> = { development: ".dev", preview: ".preview", production: "" };
const LABEL: Record<Variant, string> = { development: " (Dev)", preview: " (Preview)", production: "" };

// Diisi setelah `eas init` (lihat README). JANGAN memakai projectId app lain.
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || undefined;
const EAS_OWNER = process.env.EAS_OWNER || "sanocare";

// google-services.json dibutuhkan agar push Android (FCM) jalan di build.
// Berkas ini milik proyek Firebase untuk paket com.sanomatrassehat.finance* —
// belum ada di repo (lihat blocker di README). Dipasang hanya bila ada.
const googleServices = process.env.GOOGLE_SERVICES_JSON
  || (fs.existsSync(path.join(__dirname, "google-services.json")) ? "./google-services.json" : undefined);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `SANO Finance${LABEL[VARIANT]}`,
  slug: "sano-finance",
  scheme: "sanofinance",
  version: "0.2.0", // Wave 1 (S6–S8). versionCode dikelola EAS.
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  owner: EAS_OWNER,
  experiments: { typedRoutes: true },
  android: {
    package: `${BASE_PACKAGE}${SUFFIX[VARIANT]}`,
    // versionCode dikelola EAS (appVersionSource: remote + autoIncrement).
    softwareKeyboardLayoutMode: "resize",
    allowBackup: false,
    ...(googleServices ? { googleServicesFile: googleServices } : {}),
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      // Ikon penuh seperti aplikasi toko: latar gradien selebar kanvas + foreground yang menyatu (dibuat dari sano_logo_financeapp.png).
      backgroundColor: "#2EB4DE",
      backgroundImage: "./assets/adaptive-bg.png",
      monochromeImage: "./assets/adaptive-icon-mono.png",
    },
    // Aplikasi keuangan tidak butuh mikrofon/lokasi: blokir yang mungkin masuk lewat dependensi.
    // SYSTEM_ALERT_WINDOW datang dari dev-client: hanya boleh ada di varian development.
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      ...(VARIANT === "development" ? [] : ["android.permission.SYSTEM_ALERT_WINDOW"]),
    ],
  },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-image",
    "expo-secure-store",
    "expo-sharing",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 180,
        resizeMode: "contain",
        backgroundColor: "#0A1730",
        dark: { image: "./assets/splash-icon.png", backgroundColor: "#0A1730" },
      },
    ],
    [
      "expo-local-authentication",
      { faceIDPermission: "Gunakan biometrik untuk membuka SANO Finance" },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "SANO Finance butuh akses galeri untuk melampirkan foto nota dan bukti",
        cameraPermission: "SANO Finance butuh akses kamera untuk memotret nota dan bukti",
        microphonePermission: false,
      },
    ],
    [
      "expo-notifications",
      { icon: "./assets/notification-icon.png", color: "#2064B7" },
    ],
    [
      "expo-share-intent",
      {
        // Terima foto yang dibagikan dari WhatsApp/galeri ("Bagikan → SANO Finance").
        androidIntentFilters: ["image/*"],
        androidMultiIntentFilters: ["image/*"],
        disableIOS: true,
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          // HTTP polos hanya untuk emulator/dev (10.0.2.2); preview & production wajib HTTPS.
          usesCleartextTraffic: VARIANT === "development",
        },
      },
    ],
  ],
  // Kebijakan "appVersion": runtimeVersion = versi aplikasi. Kebijakan "fingerprint" GAGAL di build cloud (hash lokal Windows ≠ hash builder pada monorepo:
  // "Runtime version calculated on local machine not equal to ... during build", 20 Sep 2026). WAJIB menaikkan `version` bila kode native berubah.
  runtimeVersion: { policy: "appVersion" },
  updates: EAS_PROJECT_ID
    ? {
        url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
      }
    : { enabled: false },
  extra: {
    appVariant: VARIANT,
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
});
