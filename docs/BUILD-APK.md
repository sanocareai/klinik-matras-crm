# Panduan Build APK Android — Klinik Matras CRM

Dokumen ini menjelaskan cara build APK dari project Capacitor secara lengkap.
APK bisa di-install langsung di HP sales tanpa Play Store (sideload).

---

## Prasyarat (install sekali saja)

1. **Node.js v20 LTS** — cek dengan `node -v`
2. **Android Studio** — download dari https://developer.android.com/studio
   - Saat install, centang: Android SDK, Android Emulator, Android SDK Platform-Tools
3. **Java JDK 17** — biasanya sudah ikut Android Studio, atau download dari https://adoptium.net
4. **Environment variables** (tambah ke PATH di Windows):
   - `ANDROID_HOME` = `C:\Users\[nama]\AppData\Local\Android\Sdk`
   - `JAVA_HOME` = direktori JDK 17 Anda

Cek prasyarat berfungsi:
```
java -version        → harus tampil versi 17.x
adb version         → harus tampil version info
```

---

## Setup Awal (sekali saja, setelah clone repo)

### 1. Generate folder android/ (hanya pertama kali)

```bash
cd frontend
npx cap add android
```

Ini membuat folder `frontend/android/` berisi project Android Studio.
Folder ini perlu di-commit ke git agar bisa di-build di mesin lain.

### 2. Buat Keystore untuk Signing (hanya sekali seumur hidup)

APK perlu ditandatangani (signed) agar bisa diinstall. Buat keystore sekali:

```bash
cd frontend/android
keytool -genkey -v -keystore release.keystore -alias klinikmatras -keyalg RSA -keysize 2048 -validity 10000
```

Isi dengan info perusahaan saat diminta. Pilih password yang kuat dan **SIMPAN DI TEMPAT AMAN**.

**Tambahkan keystore ke `.gitignore`** (jangan pernah commit ke git):
```
frontend/android/release.keystore
```

### 3. Konfigurasi Signing di build.gradle

Edit file `frontend/android/app/build.gradle`, tambahkan di bagian `android { ... }`:

```gradle
signingConfigs {
    release {
        storeFile file("release.keystore")
        storePassword "PASSWORD_ANDA"
        keyAlias "klinikmatras"
        keyPassword "PASSWORD_ANDA"
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
    }
}
```

---

## Build APK (setiap ada update kode)

### Langkah lengkap tiap update:

```bash
# 1. Di folder frontend/ — build web dengan URL produksi
cd frontend
npm run build:capacitor

# 2. Sync hasil build ke project Android
npm run cap:sync
# atau: npx cap sync android

# 3a. Build via command line (tanpa Android Studio)
cd android
./gradlew assembleRelease

# APK siap di:
# frontend/android/app/build/outputs/apk/release/app-release.apk

# 3b. ATAU build via Android Studio (lebih mudah):
npm run cap:open
# Tunggu Android Studio terbuka → Build → Generate Signed Bundle / APK
# → APK → pilih release keystore → Finish
```

### Build Debug (untuk testing, tanpa perlu keystore):

```bash
cd frontend
npm run build:capacitor
npm run cap:sync
cd android
./gradlew assembleDebug
# APK di: frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Distribusi ke HP Sales (Sideload)

### Cara install APK di HP:

1. Aktifkan "Install dari sumber tidak dikenal" di HP:
   - Android 8+: Pengaturan → Aplikasi → menu kanan atas → Akses khusus → Pasang aplikasi tidak dikenal → izinkan browser/file manager
   - Atau muncul otomatis saat install
2. Transfer APK ke HP:
   - Via kabel USB → salin file ke HP
   - Via WhatsApp/email → kirim file APK
   - Via Google Drive → upload APK, buka link di HP
3. Buka APK di HP → Instal

### Cara update app di HP sales:

Cukup kirim APK versi baru → install di atas versi lama (tidak perlu uninstall dulu).
Pastikan:
- APK baru di-sign dengan keystore yang SAMA
- `versionCode` di `frontend/android/app/build.gradle` WAJIB dinaikkan tiap update

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `ANDROID_HOME not found` | Tambahkan env variable ANDROID_HOME di Windows Settings → System → Advanced → Environment Variables |
| `Gradle sync failed` | Buka Android Studio → File → Sync Project with Gradle Files |
| `App not installed` di HP | Pastikan APK di-sign dengan keystore yang sama, versionCode naik |
| Login gagal di APK | Cek `VITE_API_BASE` di `.env.capacitor` sudah benar (`https://app.sanomatrassehat.com`) |
| API calls 404 | Cek Nginx tidak block request dari origin `capacitor://localhost` — tambah ke CORS kalau perlu |
| Layar putih saat buka | Cek `console.log` di Android Studio: Run → Logcat. Biasanya masalah URL atau JS error |

---

## File-file Penting

| File | Keterangan |
|------|-----------|
| `frontend/capacitor.config.json` | Konfigurasi Capacitor (appId, splash screen, dll) |
| `frontend/.env.capacitor` | URL backend untuk build APK |
| `frontend/.env` | URL untuk web build (kosong = relative) |
| `frontend/android/` | Project Android Studio (di-commit ke git) |
| `frontend/android/release.keystore` | **JANGAN commit** — simpan di tempat aman |
| `frontend/android/app/build.gradle` | Version code, signing config |

---

## Update Version Code

Setiap kali distribusi update ke HP sales, naikkan `versionCode` di
`frontend/android/app/build.gradle`:

```gradle
defaultConfig {
    versionCode 2    // ← naikkan setiap update (1, 2, 3, ...)
    versionName "1.1.0"
    ...
}
```
