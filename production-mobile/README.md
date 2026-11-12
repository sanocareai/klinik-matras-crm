# SANSS Produksi (production-mobile)

Aplikasi Android lantai produksi Klinik Matras — React Native + Expo (SDK 57), TypeScript, Expo Router.
Desain: kanvas "SANSS Production App" (gaya iOS: latar grouped, kartu membulat, warna tim & status).
Backend SANSS tetap **satu-satunya sumber kebenaran**; aplikasi memakai endpoint yang sama dengan Aplikasi Meja web & Andon TV.

## Slice 1 (12 Nov 2026) — bacaan

| Tab | Untuk | Sumber |
|---|---|---|
| Kerja | PIC Meja/Corner (`unit:stage:write`) | `GET /production-v2/worker/:lane` + `GET /production/v1-worker-queue` |
| Papan | semua | `GET /production-v2/andon` (live per meja + "Butuh perhatian") |
| Target | Admin Produksi (`production_assignment:write`) | `GET /production-v2/andon?date=` per tanggal & meja |
| Media | semua | `GET /production-v2/runs/:runId/report` (foto & video Sebelum · Proses · Sesudah) |
| Detail unit | semua | `GET /production-v2/runs/:runId/card` |

"Live" = diambil ulang tiap 20 detik saat aplikasi di depan (sama dengan Andon TV web) + tarik-untuk-muat-ulang.

## Slice 2a — aksi tahap dari HP

Di Detail Unit muncul SATU tombol utama sesuai `next` dari server (hanya bila giliran PIC ini / boleh semua PIC):

| Aksi | Endpoint (sama dengan Aplikasi Meja web) |
|---|---|
| Mulai tahap / Lanjutkan (continueOnly) | `POST /production-v2/runs/:runId/steps/:stepNo` (payload kosong) |
| Lanjutkan Pekerjaan (setelah tunda) | `POST /production-v2/units/:unitId/resume-work` |
| Formulir tahap 1, 2, 3, 4, 9, 11, 12 + foto/video | unggah `POST /production-v2/evidence/upload`, lalu `steps/:stepNo` dengan `media: [url]` |
| Tunda (arahan / kendala / lainnya) | `POST /production-v2/runs/:runId/delay` |

Foto & video diambil dari **kamera (foto atau video) atau galeri**, langsung diunggah (video ≤ 80 MB, foto ≤ 15 MB, diatur server);
tahap yang mewajibkan video (uji rasa awal, uji fondasi) tidak bisa dikirim tanpa video. Payload & validasi mencerminkan
`frontend/src/features/production/experience.js` — bila salah satu berubah, samakan (`src/features/langkah.ts` + tesnya).

**Masih lewat SANSS Web:** tahap 8 (uji tekstur, PIC QC), jalur Pengerjaan Pesanan (BUILD), dan tahap 3/7 yang
menunggu Catatan Komponen. (Putusan QC → slice 2b; jadwal & PIC → slice 3; bahan & Corner → slice 4; Diagnosa → slice 5.)

## Slice 2b — QC, urutan target, berat dari order, video

| Fitur | Endpoint |
|---|---|
| Tab **QC** (pemegang `qc:write`): antrean menunggu putusan | `GET /production-planning/qc/queue?tab=AWAITING_QC` |
| Putusan Lulus / Gagal → rework (foto wajib, berat acuan, tahap rework) | `POST /production-planning/qc/runs/:runId/inspect` (+ foto `POST /units/:unitId/photos`) |
| Gerbang Lulus putaran ini (uji fondasi baru, hasil aktual, uji kasur jadi) | `GET /production-v2/component-notes/units/:unitId` → `assembly` |
| **Target**: Admin mengatur urutan satu meja (naik/turun) | `GET /production-v2/board?date=` + `POST /production-v2/stations/reorder` |
| Berat penguji (Uji Fondasi) & berat acuan (QC) terisi otomatis dari **order** | `customer.weightEntries` (Suami/Istri/…) → cadangan `Order.beratBadan` |
| Video diputar di dalam aplikasi | `expo-video` |

Logika QC mencerminkan `frontend/src/features/production/qcHandoff.js` + `componentNotesModel.js#decisionGate` (`src/features/qc.ts`).
Waive QC, override preferensi customer, dan bahan tambahan rework tetap di Hub QC web.

## Slice 3 — kontrol Admin dari HP (tab Target)

Untuk pemegang `production_assignment:write` (Admin, Owner, Kepala Produksi). Endpoint SAMA dengan Rencana Produksi web;
aturan & body mencerminkan `ScheduleModal` (`frontend/src/features/production/ScheduleModals.jsx`) → `src/features/jadwal.ts` + tesnya.

| Fitur | Endpoint |
|---|---|
| **Perlu perhatian**: Komplain (di papan & belum dijadwalkan), lewat target, tertunda/menunggu bahan, Tinggi belum dijadwalkan | dari papan + backlog (hanya memberi tahu — prioritas tetap manual) |
| **Belum dijadwalkan**: cari & daftar bertahap | `GET /production-v2/backlog?q=&page=` |
| **Jadwalkan / Aktifkan & jadwalkan**: tanggal, meja (kapasitas), prioritas, workshop, PIC Meja (ikut bawaan / khusus), PIC Corner, keputusan Corner (jalur pesanan) | `GET /production-v2/planning/refs` + `POST /production-v2/plans` |
| **Ubah jadwal** kartu di papan: pindah tanggal/meja/PIC, alasan wajib bila lewat target, keluarkan dari papan | `POST /production-v2/plans/:id/schedule` (`expectedRevision`) |
| **PIC bawaan meja** per tanggal | `PUT /production-v2/stations/:code/pic` |

Tidak dari HP: target khusus per kartu (dipertahankan apa adanya), mendaftarkan akun sebagai operator/PIC, mengatur lini operator.

## Slice 4 — bahan & Corner

| Fitur | Endpoint / sumber |
|---|---|
| Tahap 6 Fondasi Baru & 7 Lapisan Baru: jumlah bahan dipakai per bahan yang **sudah diserahkan Gudang** (diserahkan · sisa) | `card.issuedMaterials` → `POST steps/:stepNo` dengan `materials[{materialId, qty}]` |
| Bahan sudah dicatat PIC Bahan → Meja tidak mengisi lagi (ringkasan saja) | `card.materialPic` (cermin `stepMaterialsByPic`) |
| Tahap 10 Mulai Jahit: model kasur, kain, list; Corner V2: kartu permintaan Sales, cek kain lama/baru, kesesuaian, konfirmasi Sales bila motif/warna belum tertulis | `card.cornerView` (cermin `validateCornerStartForm`) |
| Tahap 12 Corner V2: ringkasan syarat sebelum selesai (QC, Corner, retur sisa bahan) | `GET /production-v2/runs/:runId/finish-preview` (baca-saja) |
| **Bahan kurang** (tahap 3–8, PIC Meja): pilih bahan (BOM dulu, lalu katalog) + qty opsional + catatan untuk Gudang | `GET /production-v2/materials/search` + `POST /production-v2/runs/:runId/material-shortage` |

Pintu masuk Bahan kurang: tombol di Detail Unit (belum mulai / menunggu bahan disiapkan) dan dari layar Tunda ("Menunggu bahan?").
Logika di `src/features/langkah.ts` (cermin `experience.js` & `workerSheets.jsx#ShortageSheet`), komponen di `src/features/Bahan.tsx`.

## Slice 5 — Diagnosa (tahap 5)

Wizard 6 bagian (`app/diagnosa/[runId].tsx`, cermin `DiagnosisWizard.jsx`): Info Sales (baca-saja) · Hasil Bongkar (kondisi, kerusakan
utama, tingkat, foto/video wajib ≥1) · Fondasi (tindakan wajib) · Lapisan (≤10 baris) & komponen · Bahan (katalog → rencana bahan/Planned
BOM; bahan manual ≤20 untuk dipetakan Production Lead) · Kirim (kesimpulan ≥10 huruf).

| Langkah | Endpoint |
|---|---|
| Muat diagnosis (revisi: isian, BOM aktif, foto lama, bahan manual belum dipetakan) | `GET /production-v2/diagnosis/:runId` |
| Kirim diagnosis (menulis Planned BOM dalam satu transaksi) | `POST /production-v2/diagnosis/:runId/submit` |
| Tutup tahap 5 (payload sama dengan web) | `POST /production-v2/runs/:runId/steps/5` |
| Cari bahan katalog | `GET /production-v2/materials/search` |

Validasi = aturan server saat submit (`src/features/diagnosa.ts` + tes). Bila penutupan tahap gagal, diagnosis tetap tersimpan dan layar
menawarkan "Tutup tahap Diagnosa". Draf isian disimpan di memori aplikasi per unit (bukan disk); foto/video baru tidak ikut draf.

## Push notifikasi

| Kejadian | Penerima | Layar saat diketuk |
|---|---|---|
| Kartu pindah ke QC (menunggu Uji Berat Badan) | semua peran `QC_LEAD` | `/qc/:runId` |
| QC Lulus → Corner | PIC Corner rencana | `/unit/:runId` |
| QC Gagal → kembali ke Meja (rework) | PIC Meja rencana | `/unit/:runId` |
| Admin mengubah urutan meja | para PIC unit di meja itu | `/kerja` |
| Kasus **Komplain** dibuka untuk unit yang sedang di workshop | Admin/Owner/Kepala Produksi (peran pemegang `production_assignment:write`) + PIC rencana unit itu | `/unit/:runId` (1 unit) atau `/target` |

Pelaku aksi tidak dikirimi; isi tanpa nama customer. Tautan divalidasi daftar putih (`src/lib/tautan.ts`).

**Syarat menyalakan (semua MATI secara bawaan):**
1. Rilis backend dengan migrasi `20261231200000_mobile_device_tokens_app` (kolom `app`, baris lama = `finance`).
2. `eas init` proyek ini + kredensial FCM (google-services.json & kunci FCM V1 di Expo) → build dengan `EXPO_PUBLIC_PUSH_ENABLED=true`.
3. Server: `PRODUCTION_PUSH_ENABLED=true`. Saat mati, route tidak melakukan query tambahan apa pun.
4. Pengguna menekan **Aktifkan notifikasi** di tab Akun.

Token ditandai aplikasi oleh SERVER dari klaim token akses (bukan dari body); pengirim Finance kini hanya mengirim ke `app="finance"`.

> `expo-image-picker` & `expo-video` adalah modul native → butuh build APK baru (bukan sekadar OTA).

## Login & keamanan

- Login `POST /api/mobile/auth/login` dengan `app: "production"` (refresh juga wajib membawa `app`).
- Server menolak akun tanpa akses produksi (`NOT_PRODUCTION_TEAM`). Token Produksi hanya menjangkau
  `/api/production*`, `/api/units`, `/api/mobile`, `/api/auth/me` — bukan jalur Finance.
- Tab yang tampil ditentukan `capabilities.production` dari server, bukan nama peran.

## Menjalankan

```bash
cd production-mobile
npm install
cp .env.example .env        # EXPO_PUBLIC_API_URL → backend lokal (emulator: http://10.0.2.2:4000/api)
npx expo start
```

## Pemeriksaan

```bash
npm run check   # tsc + eslint + jest
```

## Varian

| Varian | Paket | API |
|---|---|---|
| development | `com.sanomatrassehat.produksi.dev` | `http://10.0.2.2:4000/api` |
| preview | `com.sanomatrassehat.produksi.preview` | `https://app.sanomatrassehat.com/api` |
| production | `com.sanomatrassehat.produksi` | `https://app.sanomatrassehat.com/api` |

Sebelum build EAS pertama: `eas init` untuk proyek INI (jangan memakai projectId aplikasi lain), lalu isi `EAS_PROJECT_ID`
di profil `eas.json`. Push butuh `google-services.json` untuk paket `com.sanomatrassehat.produksi*`.

> **Catatan rilis:** aplikasi ini butuh perubahan backend di branch yang sama (`capabilities.js`, `mobileAuth.js`,
> `middleware/auth.js`, `mobileSession.js`). Backend harus dirilis dulu sebelum APK dipakai.
