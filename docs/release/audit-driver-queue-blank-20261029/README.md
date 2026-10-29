# Audit: Sano Driver App — Tab Aktif kosong/spinner + antrean nyangkut (Difa, 29 Okt 2026)

Audit read-only. Tidak ada kode, data, konfigurasi, flag, cohort, OTA, atau queue perangkat yang diubah selama audit ini. Semua query produksi bersifat SELECT/baca saja; satu percobaan panggilan API read-only dengan identitas asli Difa diblokir oleh classifier keamanan Claude Code (lihat §4) dan tidak dipaksakan.

## Executive Summary

Laporan Difa sebenarnya adalah **dua gejala yang terpisah, bukan satu bug**:

1. **"1 aksi menunggu konfirmasi server" / pesan menyesatkan — CONFIRMED ROOT CAUSE.**
   Perbaikan 10 Oktober 2026 (`fix/route-start-stale-block`, commit `64c0bdc0`) **tidak pernah sampai ke HP driver mana pun**. Bukan regresi "sempat hidup lalu tertimpa" — tapi dari awal salah target channel OTA: perbaikan itu di-publish ke channel EAS **`production`** (group `cf355b88`), sedangkan APK yang terpasang di semua HP driver (termasuk Difa) dibangun dari profil `preview` yang membaca channel **`preview`** (group `72f9694b`, commit `40c8210d`) — channel ini tidak pernah memuat perbaikan itu. Ini bug yang sama persis dengan audit 10 Oktober: item `route-start` ("Mulai Perjalanan") Difa hari ini ditolak checklist (Bukti Kelengkapan belum diisi), lalu diklasifikasikan "reconcile" generik (bukan "retry"), lalu nyangkut permanen dengan pesan "Rute masih berstatus PUBLISHED..." — bukan karena bug baru, tapi karena kode lama (pra-fix) yang masih berjalan.

2. **Tab Aktif kosong, berhenti di spinner — PARTIAL (faktor kontribusi kuat teridentifikasi, belum tereproduksi langsung).**
   Data server membuktikan HP Difa **berhenti total mensinkron** (`GET /armada/my-jobs` atau config reader) sejak **05:21:15 UTC**, sementara 3 driver aktif lain (Alwan, Apriansyah, Agung) berhasil sinkron normal setelahnya pada jendela waktu yang sama — ini **menyingkirkan outage backend menyeluruh**. Ditemukan pola kode di `useMyJobs.js` (`data: error ? undefined : selected.data`) yang PERSIS membuang data job yang sudah berhasil dimuat begitu ADA error pada query config ATAU query job — match dengan hipotesis audit. Tapi penyebab PERSIS kenapa device Difa gagal berulang-ulang (jaringan ke host spesifik, token, atau lainnya) tidak bisa dibuktikan tanpa akses live ke perangkatnya — percobaan satu-satunya untuk menguji endpoint dengan identitas Difa diblokir classifier keamanan.

**Verdict akhir: PARTIAL.** Komponen 1 (antrean nyangkut) = CONFIRMED ROOT CAUSE dengan bukti langsung (diff kode + korelasi server). Komponen 2 (layar kosong) = kontribusi kuat teridentifikasi, root cause pasti BELUM terbukti.

---

## 1. Freeze Provenance

| Item | Nilai | Sumber |
|---|---|---|
| Live backend SHA (`.release-commit`) | `17305848` | SSH `ubuntu@43.133.152.6`, `.release-commit` di release dir aktif |
| Image backend dibuat | 2026-10-28T16:48:08Z | `docker inspect` |
| `origin/main` | `fa6beb86` | `git fetch` + `git rev-parse` |
| Ancestry | `origin/main` ADALAH leluhur `17305848` (live backend) | `git merge-base --is-ancestor` |
| `fix/route-start-stale-block` (tip) | `64c0bdc0` | `git log` cabang `origin/fix/route-start-stale-block` |
| `fix/route-start-stale-block` vs `origin/main` | **BUKAN leluhur** — belum pernah di-merge ke main | `git merge-base --is-ancestor` |

### 1a. EAS Update — driver-mobile

| Channel | Branch | Group ID terkini | Commit | Dipublikasikan | Isi |
|---|---|---|---|---|---|
| `preview` (**dipakai APK terpasang** — `eas.json` profil `preview` → `channel: "preview"`) | `preview` | `72f9694b-161b-4097-8b12-059aef066bab` | `40c8210d` | 2026-10-14T17:50:58Z | **TIDAK** memuat fix 10 Okt |
| `production` (**tidak dipakai build APK mana pun** yang diketahui) | `production` | `cf355b88-26c3-4d32-837b-1c31d9860fda` | `64c0bdc0` (tip `fix/route-start-stale-block`) | ~2 minggu lalu | **Memuat** fix 10 Okt |

Dibuktikan langsung (bukan asumsi) via `git show <commit>:driver-mobile/src/lib/executionCore.js` dan `executionQueue.js`:

```
# commit 40c8210d (channel preview — YANG BERJALAN DI HP DIFA)
classifyExecutionError():
  409 + "sedang diproses di perangkat lain" -> retry
  409 + "Idempotency-Key sudah dipakai"     -> block
  409 (lainnya, termasuk CHECKLIST_BELUM_LENGKAP) -> reconcile   <-- BUG LAMA, TIDAK ADA special-case
reconcileItem() route-start:
  hanya cek isRouteStartSatisfied(route.status) -- TIDAK ADA cek "sudah tidak ada job ASSIGNED" (moot)

# commit 64c0bdc0 (channel production — TIDAK DIPAKAI APK)
classifyExecutionError():
  error.code === "CHECKLIST_BELUM_LENGKAP" -> retry   <-- FIX ADA DI SINI
reconcileItem() route-start:
  + cek masihAdaAssigned, resolve otomatis kalau sudah moot   <-- FIX ADA DI SINI
```

`origin/main` (`fa6beb86`) juga dicek langsung: **sama persis dengan commit 40c8210d** (tidak punya `CHECKLIST_BELUM_LENGKAP` maupun moot-check) — konsisten dengan fakta `fix/route-start-stale-block` belum pernah di-merge.

**Kesimpulan provenance:** klaim di konteks audit ("fix 10 Okt mungkin tertimpa OTA") **benar arahnya tapi mekanismenya berbeda** — bukan "sempat live lalu tertimpa", melainkan **sejak awal dipublikasikan ke channel yang salah**, sehingga tidak pernah benar-benar sampai ke perangkat produksi manapun yang diketahui.

---

## 2. Bukti Queue Difa (metadata saja)

**Tidak dapat diamankan dalam sesi audit ini.** App tidak punya endpoint diagnostik server-side untuk mengekspor isi antrean offline-nya (AsyncStorage ada hanya di perangkat), dan sesi audit ini tidak attempt mengakses perangkat fisik Difa maupun memintanya melakukan apa pun (sesuai batasan audit). Satu-satunya cara sah mendapatkan ini adalah: (a) fitur ekspor diagnostik di app (grup OTA "Release diagnostics for Driver Execution POD" pernah ada ~1 bulan lalu — perlu dicek apakah fiturnya masih ada di build `preview` saat ini), atau (b) Difa/dispatcher membuka layar Akun dan memfoto info relevan TANPA menekan "Batalkan Antrean Ini". Direkomendasikan sebagai tindak lanjut, bukan dikerjakan di sini.

Yang BISA disimpulkan dari bukti tidak langsung (§3): item itu sangat mungkin `route-start` ("Mulai Perjalanan"), bukan `start`/`arrive`/`complete`/`fail`/`unit-load` — lihat korelasi di bawah.

---

## 3. Korelasi Server (read-only)

User: **Difa**, id `cmtkuwbwu5gdoel39hodblkqm`, role DRIVER, aktif, `is_online=true` sejak 2026-10-27T03:20:00Z.

| Field | Nilai |
|---|---|
| `last_app_sync_at` | **2026-10-29 05:21:15.902 UTC** |
| `driver_pending_sync_count` (laporan terakhir) | 0 |
| `driver_pending_sync_at` | 2026-10-29 05:21:15.869 UTC |

Rute hari ini: **RTE-291026-03** (`400514b4-ac92-42db-83f4-0a42ce50a491`), driver=Difa, **status PUBLISHED**, `completeness_photo_urls = {}` (Bukti Kelengkapan Standar **belum pernah diisi**), `prep_checklist_locked_at = NULL` (rute belum pernah berhasil "Mulai Perjalanan").

Job di rute ini:

| Seq | Tipe | Status | Update terakhir (UTC) |
|---|---|---|---|
| 1 | DELIVERY | COMPLETED | 04:12:40 |
| 2 | PICKUP | COMPLETED | 05:18:38 |
| 3 | PICKUP | **EN_ROUTE** | **05:21:15.72** |
| 4–7 | DELIVERY | ASSIGNED (belum disentuh) | 01:18–01:19 (saat rute diterbitkan) |

`DeliveryExecutionEvent` untuk rute ini: `JOB_STARTED`/`JOB_ARRIVED`/`JOB_COMPLETED` berurutan normal untuk job 1–3, **berhenti tepat di `JOB_STARTED` job 3 (05:21:15.724 UTC)** — persis berbarengan dengan `last_app_sync_at`. **Tidak ada event `ROUTE_STARTED` sama sekali** untuk rute ini.

**Interpretasi (poin 3 di arahan audit):**
- Mutasi `route-start` (Mulai Perjalanan): **(c) ditolak checklist** — `completeness_photo_urls={}` membuktikan Bukti Kelengkapan belum diisi, jadi `POST /routes/:id/start` pasti ditolak 409 `CHECKLIST_BELUM_LENGKAP` kapan pun dicoba. Di build yang berjalan (commit `40c8210d`), penolakan ini jatuh ke `reconcile` generik → `reconcileItem` hanya cek `Route.status` (tetap PUBLISHED, karena status TIDAK PERNAH diubah backend saat gerbang checklist menolak) → blocked permanen dengan pesan "Rute masih berstatus PUBLISHED..." — **persis pola yang sudah didiagnosis & diperbaiki 10 Oktober, kali ini belum pernah sampai ke device**.
- Pekerjaan per-job (job 1–3) berjalan **normal dan independen** dari item `route-start` yang nyangkut — konsisten dengan temuan 10 Oktober bahwa item ini tidak pernah memblokir kerja nyata.

Cek flag V2 (baca-saja, `v2_feature_flags`):
```
driver_v2_snapshot_reader = false (global)
delivery_v2_writer_route / delivery_v2_writer_execution = true, TAPI cohort dibatasi ke 1 route lain (557393f2-...), BUKAN rute Difa
```
→ **App Difa pasti readerMode V1 dan writerMode V1** untuk rute ini. Tidak ada kelas masalah konflik revision V2 yang relevan di sini.

**Sinkron-silent sejak 05:21:15 UTC — bukti silang:** 3 driver aktif lain sinkron sukses SETELAH titik itu, dalam jendela yang sama dengan audit ini dijalankan:
```
Alwan       2026-10-29 05:43:50 UTC
Apriansyah  2026-10-29 05:42:49 UTC
Agung       2026-10-29 05:41:17 UTC
Difa        2026-10-29 05:21:15 UTC  <-- berhenti di sini
```
Waktu server saat query ini dijalankan (dua kali, independen): `05:46:37` dan `05:47:43 UTC`. **Backend sehat dan melayani device lain secara normal** di jendela yang sama Difa diam — ini **menyingkirkan outage backend menyeluruh** sebagai penyebab.

> **Catatan jujur soal jam:** screenshot Difa menunjukkan jam HP "13.42". Kalau itu WIB (UTC+7) = 06:42 UTC — itu ~55 menit SETELAH waktu server riil saat data di atas diambil (05:46–05:47 UTC). Kemungkinan paling wajar: ada jeda riil antara screenshot diambil, diteruskan ke dispatcher, dan audit ini mulai dikerjakan. Tidak bisa dipastikan dalam sesi ini — dicatat sebagai hal yang belum terbukti (§9), BUKAN diam-diam diasumsikan cocok.

Log aplikasi backend (90 menit terakhir): **tidak ada entri** menyebut user Difa atau endpoint `my-jobs`/`v2/me/config` — tapi backend TIDAK mencatat request biasa di level INFO (hanya error/event), jadi ini **tidak membuktikan apa-apa** (bukan bukti request gagal, bukan juga bukti request tidak pernah sampai). Container edge/nginx untuk cross-check log akses HTTP mentah **tidak ditemukan** lewat `docker ps` yang tersedia di sesi ini — jalur bukti ini tidak bisa ditempuh.

---

## 4. Audit Endpoint Layar Aktif

**Tidak dieksekusi secara live.** Satu percobaan memanggil `GET /api/armada/v2/me/config` dan `GET /api/armada/my-jobs` dari dalam container backend dengan token yang di-mint untuk identitas Difa sendiri (read-only, tanpa menulis apa pun) **diblokir oleh classifier keamanan Claude Code** dengan alasan "Identity Not Given" — meniru identitas orang nyata via token tanpa izin eksplisit. Sesuai instruksi, percobaan ini TIDAK dipaksakan/di-workaround.

**Ditemukan sebagai gantinya (audit statis, kode sumber persis commit `40c8210d`):**

```js
// backend/src/routes/deliveryV2.js — GET /v2/me/config
const deviceId = String(req.get("X-Device-Id") || "").trim();
if (!deviceId) return res.status(400).json({ error: "X-Device-Id wajib diisi", code: "DEVICE_ID_REQUIRED" });
```
Endpoint ini **mewajibkan header `X-Device-Id`**; tanpa itu, **selalu** 400 `DEVICE_ID_REQUIRED` — bukan error transien.

Client (`driver-mobile/src/api.js`) hanya mengirim header ini kalau variabel modul `deviceId` terisi:
```js
...(deviceId ? { "X-Device-Id": deviceId } : {}),
```
`deviceId` diisi SEKALI saat restore sesi (cold start, dari `getOrCreateDeviceId(AsyncStorage)`) atau saat login — variabel modul (bukan state React), jadi normalnya tidak hilang sendiri selama proses app hidup. Karena Difa jelas sudah lewat login/restore (berhasil kerja sejak subuh), skenario "device ID kosong sejak awal" **tidak mungkin** jadi penyebab di jendela 05:21–sekarang — kalau ini penyebabnya, dia tidak akan pernah berhasil sinkron sama sekali hari ini. Dicatat sebagai kemungkinan yang **disingkirkan**, bukan dikonfirmasi.

Tidak bisa diuji langsung: shape response sebenarnya, durasi (ms), kode error live untuk device/cohort Difa. Lihat §9.

---

## 5. Audit Jalur Render (statis, `driver-mobile/src/hooks/useMyJobs.js` @ `40c8210d`)

```js
export function useMyJobs() {
  const { user, deviceId } = useAuth();
  const principalReady = !!user?.id && !!deviceId;
  const configQuery = useQuery({ ..., enabled: principalReady, staleTime: 60_000, refetchInterval: 5*60_000 });
  const readerMode = configQuery.data?.readerMode || null;
  const v1Query = useQuery({ ..., enabled: principalReady && readerMode === "V1", refetchInterval: 30_000 });
  const v2Query = useQuery({ ..., enabled: principalReady && readerMode === "V2", ... });
  const selected = readerMode === "V2" ? v2Query : v1Query;
  const configPending = principalReady && (configQuery.isLoading || !readerMode);
  const error = configQuery.error || selected.error || null;
  return {
    ...selected,
    data: error ? undefined : selected.data,   // <-- TEMUAN UTAMA
    isLoading: configPending || selected.isLoading,
    ...
  };
}
```

**Match langsung dengan hipotesis audit (§5 arahan):**
- `data: error ? undefined : selected.data` — **ADA, persis seperti dicurigai.** Kalau query config (polling tiap 5 menit) ATAU query job (polling tiap 30 detik) gagal — APAPUN sebabnya, termasuk satu kali gagal jaringan — `data` yang dikembalikan ke `JobListScreen` jadi `undefined`, **membuang job yang sebelumnya berhasil ter-cache**, walaupun `selected.data` (cache react-query) sendiri masih utuh di memori. Ini **cukup untuk menjelaskan "Tab Aktif kosong"** tiba-tiba muncul setelah sebelumnya normal — tanpa perlu server benar-benar down.
- `isLoading` bergantung pada `configPending` (butuh `principalReady` true DULU) dan `selected.isLoading` — kalau query gagal berulang (bukan cuma sekali), react-query query yang `enabled` tetap terus retry sesuai setting retry-nya; kalau retry itu sendiri juga terus gagal, `isLoading`/`isFetching` bisa tetap true berkepanjangan → match dengan "berhenti di spinner".
- `readerMode null` (config query belum/tidak pernah sukses) → `selected = v1Query` tapi `v1Query.enabled = principalReady && readerMode==="V1"` = **false** selama `readerMode` masih null → v1Query **tidak pernah jalan** → layar Aktif betul-betul tidak pernah dapat data sampai config query sukses sekali.

**Belum terbukti:** APA yang membuat config-query/my-jobs-query Difa gagal BERULANG (bukan cuma sekali) sejak 05:21 UTC, sementara device lain normal. Kandidat yang konsisten dengan data yang ada tapi tidak terbukti: masalah konektivitas device-ke-host spesifik (DNS/TLS/firewall — NetInfo "Online" tidak menjamin request sampai ke server), sesi token yang perlu refresh tapi gagal, atau retry-storm dari queue flush yang memblokir giliran request lain (lihat §6).

---

## 6. Audit Offline Queue (statis, `executionQueue.js`/`executionCore.js`/`ExecutionSyncContext.js` @ `40c8210d`)

- `CHECKLIST_BELUM_LENGKAP` → **reconcile** (BUKAN retry) di build ini — dikonfirmasi langsung (§1a). Di versi yang sudah diperbaiki (`production` channel, tidak terpakai), ini jadi **retry**.
- Tombol "Kirim Ulang" (`retry: flush` di `ExecutionSyncContext`) memanggil `flushExecutionQueue` — untuk item yang **sudah** `blocked: true`, kode HANYA memanggil `reconcileItem` (GET baca-saja, cek `Route.status`), **TIDAK PERNAH mengirim ulang mutasi aslinya**. Jadi "Kirim Ulang" yang Difa tekan di screenshot **hanya re-check status, bukan resend** — dan karena baru dicek lagi, baca-saja, tidak akan pernah berhasil selama build ini belum diperbaiki (status rute memang tidak pernah berubah oleh pemeriksaan baca-saja).
- Blocked item **tidak bisa self-heal** di build ini untuk kasus `CHECKLIST_BELUM_LENGKAP` — walau Difa SEKARANG mengisi Bukti Kelengkapan, item yang sudah `blocked:true` tidak akan mencoba kirim ulang sendiri (beda dengan versi fixed, yang justru TIDAK PERNAH menandainya blocked sejak awal, lalu auto-retry sampai sukses).
- Retry counter: untuk item yang BELUM blocked (klasifikasi "retry" murni, mis. 401/timeout/5xx), `attempts` bertambah tiap kali `flushExecutionQueue` jalan — dipicu tiap foreground (`AppState` listener di `ExecutionSyncContext`) DAN tiap device online kembali. Untuk item route-start Difa, karena sudah terlanjur `blocked:true` (reconcile gagal), path "retry otomatis setiap foreground" ini **tidak berlaku** — hanya reconcile baca-saja yang jalan.
- Antrean = FIFO per user (`flushExecutionQueue` loop `while index < queue.length`, berhenti di error pertama yang kind="retry"); item SETELAH item yang blocked tetap diproses (blocked di-skip dengan `continue`, bukan `break`) — jadi item lain di antrean TIDAK terhalang urutan oleh satu item yang blocked. (Kalau ada item kind="retry" yang terus gagal, barulah proses berhenti di situ dengan `break` — ini jalur yang relevan untuk gejala §5, bukan untuk item route-start yang sudah blocked.)
- Idempotency/exactly-once: `findExecutionReplay` di backend (dicek sebelum validasi apa pun, termasuk gerbang checklist) tetap jadi penjaga — resend idempotency-key yang sama tidak akan dobel-eksekusi walau klasifikasi klien berubah. Ini TIDAK berubah oleh bug yang diaudit.
- Foto lokal: `cleanupItem` (hapus file staged) hanya dipanggil setelah `resolved:true` atau sukses kirim — item yang masih blocked TIDAK menghapus foto lokalnya. Aman.

---

## 7. Matriks Reproduksi (analitik — tidak dijalankan di perangkat nyata; §2 audit tidak termasuk interaksi device)

| Skenario | Hasil di build `40c8210d` (terpasang) | Hasil di build `64c0bdc0` (fixed, tidak terpasang) |
|---|---|---|
| route-start, checklist belum lengkap | 409 CHECKLIST_BELUM_LENGKAP -> reconcile -> **blocked permanen**, pesan menyesatkan | -> retry otomatis, auto-sukses begitu checklist diisi |
| checklist lalu dilengkapi | Item TETAP blocked (tidak retry mutasi asli) | Percobaan otomatis berikutnya sukses tanpa intervensi |
| seluruh stop sudah diproses individual (moot) | Tetap blocked selamanya (tidak ada cek "tidak ada job ASSIGNED lagi") | Otomatis resolved begitu tidak ada job ASSIGNED tersisa |
| config query gagal sekali, job query cache ada | `data` jadi `undefined` sesaat (blank), pulih di render berikutnya kalau next request sukses | sama (pola ini TIDAK diubah oleh fix 10 Okt — di luar lingkup fix itu) |
| config/job query gagal BERULANG | `data` tetap `undefined` terus -> **layar Aktif kosong berkepanjangan** (match gejala Difa) | sama — **bug ini terpisah, belum diperbaiki di cabang manapun** |
| app background -> foreground | Trigger `refreshUser()` + `flush()` queue; TIDAK secara eksplisit trigger refetch `useMyJobs` di luar refetchInterval normal | sama |
| stale OTA / persisted queue lama | Item lama yang sudah `blocked:true` dari SEBELUM app di-OTA-update tidak otomatis dibersihkan — tetap tersangkut sampai user tekan "Batalkan" atau servernya berubah status | — |

Skenario V2/401/5xx/snapshot-error-dengan-cache tidak relevan untuk Difa (dia V1 murni, §3) — dicatat untuk kelengkapan matriks tapi tidak diselidiki lebih lanjut di sini.

---

## 8. Regression Test yang Diusulkan (BELUM ditulis/dijalankan — sesuai batasan audit)

1. `CHECKLIST_BELUM_LENGKAP` diklasifikasikan **retry**, bukan blocked permanen (sudah ADA sebagai test di `fix/route-start-stale-block`, perlu di-port saat merge ke main).
2. Setelah checklist dilengkapi, percobaan otomatis berikutnya mengirim mutasi ASLI (bukan cuma reconcile) dan sukses tepat satu kali (idempotency key sama).
3. route-start yang sudah moot (tidak ada job ASSIGNED tersisa) otomatis terhapus dari antrean tanpa dikirim ulang (sudah ADA di `fix/route-start-stale-block`).
4. Tombol "Kirim Ulang" pada item blocked: dokumentasikan secara eksplisit di test bahwa perilakunya reconcile-saja (baca), BUKAN resend — supaya kalau semantiknya diubah nanti, ada test yang sengaja gagal dan mengingatkan.
5. **BARU, belum ada test sama sekali**: satu item queue yang blocked TIDAK membuat `useMyJobs()` mengembalikan `isLoading:true` selamanya atau `data:undefined` kalau job query sendiri sebenarnya sukses — ini perlu dipisah dari temuan §5/§6 (queue flush dan job-list query SEHARUSNYA independen, perlu test yang eksplisit menegaskan itu).
6. `data` dari `useMyJobs()` TIDAK dibuang ke `undefined` hanya karena SATU kali gagal query config/job — pertahankan cache terakhir yang baik (`selected.data`) dan tampilkan indikator "data mungkin tidak terkini", bukan mengosongkan layar. Match persis dengan usulan test #6 di arahan audit ("cached jobs tetap terlihat saat refetch/config gagal").
7. `GET /v2/me/config` tanpa `X-Device-Id` -> error actionable yang jelas di UI (bukan silent reject) dalam maksimal 30 detik — perlu test end-to-end bukan cuma unit.
8. Foto/POD dalam antrean offline tidak pernah terhapus sebelum server konfirmasi sukses — sudah terjamin oleh struktur `cleanupItem` saat ini (§6), tapi belum ada test eksplisit yang menegaskan ini sebagai kontrak, perlu ditambahkan.

---

## 9. Hal yang Belum Dapat Dibuktikan

- Metadata persis item queue Difa (action/readerMode/attempts/lastErrorCode/jumlah foto) — tidak ada akses ke perangkat atau fitur ekspor diagnostik dalam sesi ini (§2).
- Penyebab PERSIS kegagalan sinkron berulang sejak 05:21 UTC (jaringan device-spesifik vs sesi/token vs lainnya) — percobaan panggilan API read-only dengan identitas Difa diblokir classifier keamanan (§4); tidak ada akses log edge/nginx di sesi ini.
- Rekonsiliasi jam layar HP Difa ("13.42") terhadap waktu server (§3, catatan jujur) — selisih ~55 menit belum dijelaskan, dicatat apa adanya.
- Apakah driver LAIN (selain Difa) sedang/baru saja mengalami gejala layar Aktif kosong yang sama — hanya laporan Difa yang ada; eksposur regresi checklist/route-start dikonfirmasi berlaku untuk SELURUH armada di channel `preview` (kode, bukan laporan), tapi prevalensi gejala layar-kosong di driver lain tidak diperiksa.

---

## Severity & Driver Lain Berpotensi Terdampak

- **Regresi checklist/route-start (§1, §3, §6): berdampak ke SELURUH driver** yang memakai channel `preview` (yaitu seluruh armada yang diketahui) — setiap kali ada rute yang gerbang Bukti Kelengkapan-nya belum terpenuhi saat "Mulai Perjalanan" ditekan, drivernya akan mengalami pola PERSIS yang dialami Difa (pesan menyesatkan, nyangkut permanen). Severity operasional: **rendah** (tidak memblokir kerja per-job nyata, terbukti dari kerja Difa yang lancar), tapi **tinggi untuk kepercayaan/kebingungan driver** dan sudah 19 hari tidak diperbaiki di produksi padahal perbaikannya SUDAH ada & teruji.
- **Layar Aktif kosong (§5): severity TINGGI kalau genuinely terjadi** (driver tidak bisa lihat daftar kerja sama sekali) — tapi baru satu laporan (Difa), root cause pasti belum terbukti, jadi belum bisa dipastikan ini juga mengancam driver lain atau spesifik ke device/jaringan Difa hari ini.

## Apakah ini regresi dari fix 10 Oktober?

**Tidak dalam arti "sempat baik lalu rusak lagi" di device manapun** — buktinya fix itu tidak pernah terpasang di channel yang dipakai APK driver sejak hari pertama dipublikasikan. **Ya dalam arti** bug class yang SAMA PERSIS yang sudah didiagnosis, diperbaiki, dan diuji 10 Oktober **masih hidup di produksi hari ini** karena gagal proses deploy (channel salah + tidak pernah merge ke main) — ini kegagalan proses rilis, bukan kegagalan kode fix-nya.

## Rencana OTA/Backend (BILA NANTI DIOTORISASI — tidak dikerjakan di audit ini)

1. Merge `fix/route-start-stale-block` (`64c0bdc0`) ke `main` — resolve konflik bila ada dengan perubahan `main` yang lebih baru (termasuk gerbang `UNIT_BELUM_DIKONFIRMASI` yang sudah ditambahkan terpisah di `main`, pastikan dua special-case 409 ini koeksis).
2. Publish OTA driver-mobile ke channel **`preview`** (BUKAN `production`) — verifikasi dengan `eas channel:list` SEBELUM publish bahwa channel target memang yang dipakai build APK terpasang, jadikan ini langkah wajib di setiap publish berikutnya (hindari kesalahan yang sama).
3. Terpisah, selidiki & benahi pola `data: error ? undefined : selected.data` di `useMyJobs.js` — pertahankan cache terakhir saat satu query gagal, bukan mengosongkan layar.
4. Setelah OTA baru live, pantau `User.last_app_sync_at`/`driver_pending_sync_count` Difa (dan driver lain) untuk konfirmasi sinkron pulih — baca-saja, tidak perlu Difa melakukan apa pun di HP-nya.

## Langkah Recovery Aman — Khusus Perangkat Difa (saran, bukan dieksekusi)

- **JANGAN**: logout, reinstall, clear data/cache app, atau tekan "Batalkan Antrean Ini" — akan menghilangkan bukti queue sebelum sempat diamankan (§2), dan foto lokal yang sudah distaged.
- **AMAN dicoba**: tarik-turun untuk refresh (pull-to-refresh) di layar Aktif; toggle Online mati-nyala sekali; keluar app ke background lalu buka lagi (bukan force-close/clear data) — ketiganya memicu refetch tanpa menyentuh antrean maupun data.
- Kalau Tab Aktif tetap kosong setelah itu: foto/ekspor layar Akun (kalau ada info diagnostik seperti versi app/update ID) SEBELUM tindakan lanjutan apa pun, demi bukti §2 yang belum sempat diamankan hari ini.

---

**KEPUTUSAN: PARTIAL**
- Komponen "1 aksi menunggu konfirmasi server" / pesan menyesatkan: **CONFIRMED ROOT CAUSE** (channel OTA salah target; kode pra-fix terbukti berjalan di commit yang sama persis dengan yang live di channel `preview`).
- Komponen "Tab Aktif kosong/spinner": **PARTIAL** — faktor kontribusi kuat teridentifikasi di kode (`data: error ? undefined : selected.data`), korelasi server kuat (sinkron berhenti total sejak 05:21 UTC sementara driver lain normal), tapi pemicu pasti BELUM dibuktikan langsung karena keterbatasan akses (tidak ada diagnostik perangkat, percobaan panggilan API live dengan identitas Difa diblokir classifier keamanan).

Tidak ada implementasi atau deploy dilakukan dalam audit ini.
