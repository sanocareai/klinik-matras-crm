// SANO DELIVERY CONTROL — aplikasi Admin/Owner armada. TERPISAH dari Sano Driver
// (driver-mobile): package ID, EAS project, channel update, dan izin Android
// berbeda. Aplikasi ini TIDAK meminta izin lokasi apa pun (tidak ada pelacakan
// GPS di HP admin); plugin expo-location memang tidak dipasang, dan seluruh izin
// lokasi/foreground-service juga DIBLOKIR eksplisit di bawah sebagai sabuk kedua,
// supaya library lain tidak bisa menyelundupkannya lewat manifest merge.
//
// EAS project TIDAK boleh memakai project ID Sano Driver. EAS_PROJECT_ID (env) hanya untuk menimpa saat pengembangan.
// Project EAS KHUSUS Sano Delivery Control (dibuat 26 Sep 2026 lewat `eas init`; BUKAN project Sano Driver 0fd04b96-...).
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || "6a490ec2-167a-43e0-a964-e9797322ed4e";

module.exports = ({ config }) => ({
  ...config,
  name: "Sano Delivery Control",
  slug: "sano-delivery-control",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  android: {
    package: "com.klinikmatras.deliverycontrol",
    versionCode: 1,
    softwareKeyboardLayoutMode: "resize",
    adaptiveIcon: { backgroundColor: "#0A1424", foregroundImage: "./assets/icon.png" },
    blockedPermissions: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
      "android.permission.RECORD_AUDIO",
    ],
  },
  plugins: [
    [
      "expo-image-picker",
      {
        cameraPermission: "Sano Delivery Control butuh kamera untuk memotret struk biaya armada",
        photosPermission: false,
        microphonePermission: false,
      },
    ],
    ["expo-splash-screen", { image: "./assets/icon.png", backgroundColor: "#0A1424", resizeMode: "contain", imageWidth: 180 }],
    ["expo-build-properties", { android: { enableProguardInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true, enableMinifyInReleaseBuilds: true } }],
  ],
  runtimeVersion: { policy: "appVersion" },
  // Owner EXPLISIT (akun EAS punya banyak organisasi; `eas init` menolak tanpa ini). Sama dengan Sano Driver, tetapi PROJECT terpisah.
  owner: "sanocare",
  ...(EAS_PROJECT_ID && {
    extra: { eas: { projectId: EAS_PROJECT_ID } },
    updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}` },
  }),
});
