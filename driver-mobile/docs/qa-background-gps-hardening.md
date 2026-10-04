# QA fisik — hardening lifecycle background GPS (fix/driver-app-background-gps-hardening)

Status dokumen ini: **disiapkan, BELUM dieksekusi** — tidak ada perangkat Android
terhubung (`adb devices`) saat disiapkan (4 Okt 2026). Jangan menandai skenario
apa pun PASS tanpa benar-benar menjalankannya di perangkat fisik dan merekam
buktinya (logcat + timestamp posisi server).

Root cause crash "Sano Driver telah berhenti" (laporan 3 Okt 2026) **belum
dikonfirmasi**. QA ini memverifikasi bahwa hardening di branch ini (lihat commit
`fix(driver-mobile): hardening lifecycle background GPS`) tidak menimbulkan
regresi DAN berperilaku sesuai 4 aturan yang diaudit — bukan bukti bahwa crash
asli sudah teratasi (cuma logcat dari insiden asli, atau reproduksi crash yang
sama di versi lama vs tidak lagi muncul di versi baru, yang bisa membuktikan itu).

## 1. Identitas build yang DIUJI (isi setelah build selesai)

- Branch: `fix/driver-app-background-gps-hardening`
- Commit: `f8ce396a08459b8e3ca7f691bcf849fb56679681`
- EAS build ID: `c7cbcc35-1dc8-4adb-92fb-41f9f46c3959`
- Profil: `qa-local` — channel `qa-gps-hardening-local-only` (channel BARU, belum
  pernah ada, 0 perangkat lapangan berlangganan ke sini — lihat `eas channel:list`
  sebelum build ini dibuat, cuma ada development/preview/production)
- `versionCode`: 6 (SAMA dengan build lapangan — `appVersionSource: "local"`
  ditambahkan khusus supaya tidak auto-increment)
- `app.json`: **byte-identik** dengan baseline lapangan (`git diff` kosong) — izin,
  plugin, konfigurasi native semuanya SAMA PERSIS dengan versionCode 6 yang live
- Status: **finished** (10:37–10:55 UTC, 4 Okt 2026)
- Fingerprint: `b33ef86c4f7d5f38ac44d226f029834511108f87`
- Link APK: https://expo.dev/artifacts/eas/lOlotgD3Wpl5jdHCMpHfbPFoh6JVMMI93ExVfhAnSEM.apk
- Logs: https://expo.dev/accounts/sanocare/projects/sano-driver/builds/c7cbcc35-1dc8-4adb-92fb-41f9f46c3959

### Baseline lapangan (untuk perbandingan/rollback) — diverifikasi 4 Okt 2026
- Channel field sungguhan: **`preview`** (SATU-SATUNYA channel yang punya riwayat
  build — `production`/`development` tidak pernah dibangun sekali pun meski
  channel-nya ada)
- Build lapangan terakhir: `versionCode 6`, commit `5ed7033a`, runtime `1.0.0`,
  APK: `https://expo.dev/artifacts/eas/y9p4foylMh1n-v6g4WXwnF66dW_KXj7a_SHrFk7dv5E.apk`
- OTA terakhir di channel `preview`: commit `6633f516` ("Tampilkan catatan rute
  dari dispatcher paling atas di kartu Mulai Perjalanan") — build QA ini TIDAK
  menyertakan perubahan itu (cabang terpisah, basis sama `origin/main`), supaya
  sinyal QA GPS tidak bercampur dengan fitur lain. Ini TIDAK PERNAH dikirim ke
  channel `preview` dan TIDAK mengubah aplikasi lapangan dengan cara apa pun.

## 2. Siapkan perangkat

**Lebih disukai: perangkat QA khusus** (bukan HP driver lapangan sungguhan).

**Kalau terpaksa pakai HP yang sudah punya app lapangan dengan antrean offline**
(indikator "N aksi menunggu konfirmasi server" di JobListScreen):
- JANGAN `adb uninstall`, JANGAN hapus data app dari Setelan, sebelum ATAU
  sesudah QA.
- Pasang APK QA dengan **replace**, bukan install bersih:
  `adb install -r sano-driver-qa.apk` — package ID sama
  (`com.klinikmatras.drivermobile`) dan keystore sama (kredensial EAS default
  proyek ini) dengan app lapangan, jadi `-r` mempertahankan AsyncStorage/
  antrean offline, sama seperti app lapangan meng-update dirinya sendiri secara
  native — BUKAN reinstall bersih.
- Idealnya tunggu sampai indikator antrean offline menunjukkan 0 (tersambung
  internet, sudah sinkron) SEBELUM memasang APK QA, untuk memperkecil risiko.
- Setelah selesai QA, kembalikan ke APK lapangan asli dengan cara yang sama
  (`adb install -r`, dari Application Archive URL versionCode 6 di atas) —
  app akan otomatis menarik OTA terbaru (`preview`) begitu dibuka kembali
  (`checkForUpdateOnLaunch`, lihat `src/lib/autoUpdate.js`).

```bash
# unduh APK QA (ganti URL setelah build selesai)
curl -L -o sano-driver-qa.apk "<Application Archive URL dari eas build:view>"
adb install -r sano-driver-qa.apk
```

Login dengan akun DRIVER uji (bukan akun driver lapangan sungguhan kalau bisa,
supaya data posisi/log aktivitas QA tidak bercampur dengan data operasional
nyata). Siapkan satu order/job yang bisa diubah ke EN_ROUTE untuk uji.

## 3. Rekam logcat SELAMA setiap skenario

```bash
adb logcat -c                                             # bersihkan buffer lama
adb logcat -v time > qa-gps-$(date +%Y%m%d-%H%M%S).log &  # rekam ke file, latar belakang
LOGCAT_PID=$!
# ... jalankan skenario ...
kill $LOGCAT_PID                                           # hentikan setelah skenario selesai
```

Setelah tiap skenario, periksa filenya untuk:
```bash
grep -E "FATAL EXCEPTION|ANR in|ForegroundServiceStartNotAllowedException|BadTokenException|SecurityException|com.klinikmatras.drivermobile" qa-gps-*.log
```
Simpan file log (bahkan yang PASS) — jadi bukti, bukan cuma diary.

## 4. Verifikasi sisi server (posisi sungguh terkirim)

Setelah skenario yang melibatkan EN_ROUTE + Home/lock, cek `job_position_pings`
langsung di database (baca-saja):

```bash
ssh ubuntu@43.133.152.6 "docker exec -i \$(docker ps -q --filter label=com.docker.compose.project=klinik-matras --filter label=com.docker.compose.service=postgres) \
  psql -U klinik -d klinik_matras -At -c \"select recorded_at, created_at, lat, lng, accuracy from job_position_pings where job_id = '<JOB_ID_UJI>' order by recorded_at desc limit 20\""
```

Ambil `<JOB_ID_UJI>` dari Route Planner web atau `GET /api/armada/my-jobs` sebelum
mulai. Catat: jeda antar `recorded_at` (harus ~30 detik kalau background
tracking jalan, ~2 menit kalau jatuh ke jalur cadangan foreground-only, atau
berhenti total kalau tidak ada tracking sama sekali — ketiganya BEDA dan semua
valid tergantung skenario).

## 5. Swipe Recents vs Force Stop — BEDA, uji KEDUANYA terpisah

- **Swipe dari Recents**: buka app-switcher (tombol segitiga/gesture), geser
  kartu Sano Driver ke atas/samping untuk menutupnya. Proses BOLEH tetap hidup
  kalau ada foreground service aktif (perilaku normal Android) — TAPI sebagian
  OEM (Xiaomi/Oppo/Vivo dengan battery-saver agresif) tetap membunuhnya. Catat
  merek/model HP dan apakah notifikasi tracking bertahan.
- **Force stop**: Setelan > Aplikasi > Sano Driver > Paksa berhenti (atau
  `adb shell am force-stop com.klinikmatras.drivermobile`). Ini SELALU
  membunuh proses TANPA PENGECUALIAN dan mencabut hak eksekusi background
  sampai driver membuka app lagi secara manual — beda total dari swipe Recents.
  App TIDAK diharapkan melanjutkan tracking setelah Force Stop (tidak ada
  mekanisme JS yang bisa menembus ini, lihat komentar di
  `useDriverTracking.js`) — yang diuji di sini HANYA: tidak ada crash/ANR
  SEBELUM Force Stop terjadi, dan app pulih bersih (tidak macet/crash loop)
  saat dibuka lagi sesudahnya.

## 6. Skenario (isi PASS/FAIL + bukti untuk tiap baris)

| # | Skenario | Langkah | Yang diharapkan | PASS/FAIL | Bukti (logcat/posisi/catatan) |
|---|---|---|---|---|---|
| 1 | Home saat EN_ROUTE | Online, job EN_ROUTE, tekan Home (bukan swipe), tunggu 3 menit, buka lagi | Notifikasi tracking bertahan; posisi server punya titik baru ~tiap 30 dtk selama 3 menit; tidak ada FATAL di logcat | | |
| 2 | Layar terkunci saat EN_ROUTE | Sama seperti #1 tapi kunci layar (tombol power), bukan Home | Sama seperti #1 | | |
| 3 | Swipe Recents saat EN_ROUTE | Online+EN_ROUTE, buka app-switcher, swipe tutup, tunggu 3 menit | Dicatat APAKAH proses bertahan (device/OEM-dependent) — kalau bertahan: sama seperti #1; kalau mati: dicatat sebagai temuan OEM, BUKAN kegagalan patch | | |
| 4 | Force Stop saat EN_ROUTE | Online+EN_ROUTE, Setelan > Paksa berhenti | Tidak ada crash/ANR tercatat SEBELUM paksa-berhenti; notifikasi hilang (wajar, proses dibunuh OS) | | |
| 5 | Buka lagi setelah Force Stop | Buka app manual setelah #4 | App terbuka normal, tidak crash-loop, tracking mulai ulang dengan benar kalau masih online+EN_ROUTE (lewat gerbang AppState aktif) | | |
| 6 | Logout saat EN_ROUTE | Online+EN_ROUTE, tekan Keluar | Notifikasi tracking hilang SEGERA; `adb shell dumpsys activity services \| grep klinikmatras` tidak menunjukkan foreground service tersisa | | |
| 7 | Izin ditolak (fresh) | Install bersih/data baru, tolak izin lokasi foreground saat diminta | Tidak crash; caption "Gagal mengaktifkan pelacakan posisi" muncul di layar; app tetap bisa dipakai | | |
| 8 | Izin background dicabut | Granted dulu, lalu Setelan > Izin > Lokasi > ubah ke "Hanya saat digunakan"; online+EN_ROUTE lagi | Tidak crash; caption "Posisi hanya terkirim selama app dibuka" muncul; posisi tetap terkirim selama app di foreground (jalur cadangan) | | |
| 9 | Job jadi EN_ROUTE saat app background | Online, app di-Home (BUKAN force-stop), dari device/akun LAIN mulai rute yang ditugaskan ke driver ini, lalu buka app lagi | Tidak crash SELAMA backgrounded; tracking baru mulai begitu app dibuka (bukan diam-diam dari background) — cek logcat tidak ada aktivitas start FGS SELAGI masih di-Home | | |
| 10 | Toggle Online/Offline cepat | Tap Online/Offline 5x berturut-turut cepat | Tidak crash; status akhir sesuai tap terakhir; tidak ada notifikasi tracking yang "nyangkut" menyala padahal sudah Offline | | |

## 7. Kalau perangkat TIDAK tersedia

Tandai SEMUA baris di atas sebagai **BELUM DIUJI** (bukan PASS, bukan FAIL).
Laporkan: build sudah siap (ID & link di atas), instruksi QA ini sudah
disiapkan, eksekusi menunggu perangkat fisik.
