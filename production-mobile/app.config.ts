import fs from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

// KONFIGURASI SANSS PRODUKSI (Expo SDK 57) — pola sama dengan finance-mobile.
//
// APP_VARIANT (diatur per profil eas.json) menentukan paket/nama/kanal; ketiganya bisa terpasang bersamaan:
//   development → com.sanomatrassehat.produksi.dev      "(Dev)"
//   preview     → com.sanomatrassehat.produksi.preview  "(Preview)"
//   production  → com.sanomatrassehat.produksi
// runtimeVersion = kebijakan "appVersion" (fingerprint gagal di build cloud monorepo, lihat finance-mobile):
// naikkan `version` setiap kode/dependensi native berubah.

type Variant = "development" | "preview" | "production";
const raw = process.env.APP_VARIANT;
const VARIANT: Variant = raw === "preview" || raw === "production" ? raw : "development";
// Push MATI kecuali EXPO_PUBLIC_PUSH_ENABLED=true saat build (butuh google-services.json untuk paket ini).
const PUSH_ON = process.env.EXPO_PUBLIC_PUSH_ENABLED === "true";

const BASE_PACKAGE = "com.sanomatrassehat.produksi";
const SUFFIX: Record<Variant, string> = { development: ".dev", preview: ".preview", production: "" };
const LABEL: Record<Variant, string> = { development: " (Dev)", preview: " (Preview)", production: "" };

// Diisi setelah `eas init` untuk proyek INI. JANGAN memakai projectId aplikasi lain.
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || undefined;
const EAS_OWNER = process.env.EAS_OWNER || "sanocare";

const googleServices = process.env.GOOGLE_SERVICES_JSON
  || (fs.existsSync(path.join(__dirname, "google-services.json")) ? "./google-services.json" : undefined);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `SANSS Produksi${LABEL[VARIANT]}`,
  slug: "sanss-produksi",
  scheme: "sanssproduksi",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  owner: EAS_OWNER,
  experiments: { typedRoutes: true },
  android: {
    package: `${BASE_PACKAGE}${SUFFIX[VARIANT]}`,
    softwareKeyboardLayoutMode: "resize",
    allowBackup: false,
    ...(googleServices ? { googleServicesFile: googleServices } : {}),
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#4A62E8",
    },
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.READ_APP_BADGE",
      "android.permission.ACCESS_LOCAL_NETWORK",
      ...(PUSH_ON ? [] : ["android.permission.POST_NOTIFICATIONS", "android.permission.RECEIVE_BOOT_COMPLETED"]),
      ...(VARIANT === "development" ? [] : ["android.permission.SYSTEM_ALERT_WINDOW"]),
    ],
  },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-image",
    "expo-secure-store",
    [
      "expo-splash-screen",
      { image: "./assets/splash-icon.png", imageWidth: 160, resizeMode: "contain", backgroundColor: "#F2F2F7" },
    ],
    [
      "expo-image-picker",
      {
        // Foto & video dokumentasi tahap (mis. uji fondasi). Video direkam aplikasi kamera bawaan HP, jadi
        // aplikasi ini sendiri tidak meminta izin mikrofon (RECORD_AUDIO tetap diblokir di atas).
        photosPermission: "SANSS Produksi butuh akses galeri untuk melampirkan foto/video dokumentasi produksi",
        cameraPermission: "SANSS Produksi butuh kamera untuk memotret dan merekam dokumentasi produksi",
        microphonePermission: false,
      },
    ],
    "expo-video",
    // Sidik jari / wajah / PIN HP untuk masuk cepat & kunci aplikasi (izin USE_BIOMETRIC ditambahkan modulnya).
    ["expo-local-authentication", { faceIDPermission: "SANSS Produksi memakai Face ID untuk masuk cepat dan membuka kunci aplikasi." }],
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#4A62E8" }],
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
  runtimeVersion: { policy: "appVersion" },
  updates: EAS_PROJECT_ID
    ? { url: `https://u.expo.dev/${EAS_PROJECT_ID}`, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 }
    : { enabled: false },
  extra: {
    appVariant: VARIANT,
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
});
