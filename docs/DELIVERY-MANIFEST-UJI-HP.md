# Uji HP — manifest barang + konfirmasi muat (driver-mobile) — checklist operator

Berlaku untuk: `main` ≥ `bc941feb`. Server produksi sudah LIVE (gerbang muat MATI). Dokumen ini hanya untuk **uji di HP terhadap backend QA lokal** —
**JANGAN membuat job QA di produksi dan JANGAN mengubah `DELIVERY_UNIT_CONFIRM_REQUIRED` di produksi.**
Hasil uji ini menjadi dasar keputusan OTA (lihat runbook `docs/DELIVERY-MANIFEST-RN-OTA.md`).

## 0. Peringatan sebelum memasang
* Pakai **HP cadangan/uji, bukan HP driver lapangan.** APK QA memakai package yang sama dengan Sano Driver; memasangnya di atas aplikasi driver
  mengganti channel-nya ke `qa-manifest-local-only` dan menunjuk server QA (OTA produksi tidak akan masuk sampai APK `preview` dipasang ulang).
* Kolom "Server QA" di layar login hanya ada di build QA. Build produksi/preview tidak berubah.

## 1. Penyiapan (dilakukan di PC pengembang, bukan operator HP)
```
# 1) backend QA lokal (DB terpisah km_qa_manifest_test; tanpa cron/WAHA)
cd backend
set QA_DATABASE_URL=postgresql://klinik:KlinikMatras2026Aman@localhost:5432/km_qa_manifest_test
node scripts/qa-manifest/setup.mjs --reset          # buat DB, migrasi, akun QA, 3 job (A/B/C), masing-masing 3 unit
node scripts/qa-manifest/e2e.mjs                    # bukti tanpa perangkat — harus 13/13 lulus (memakai DB yang sama; jalankan setup --reset lagi setelahnya)
# gerbang MATI (paritas produksi) untuk bagian A–C; KAPABEL untuk bagian D:
set PORT=4100 && node scripts/qa-manifest/server.mjs
set PORT=4100 && set DELIVERY_UNIT_CONFIRM_REQUIRED=capable && node scripts/qa-manifest/server.mjs
# 2) tunnel HTTPS (HP rilis tidak boleh HTTP biasa)
ngrok http 4100            # catat URL https://....ngrok-free.app
# 3) APK QA (kuota build EAS — butuh persetujuan), dari branch qa/manifest-hp
cd driver-mobile && npx eas-cli build -p android --profile qa-manifest
```
Akun QA: `qa.driver@qa.test` / `qa.admin@qa.test`; kata sandi ada di `backend/scripts/qa-manifest/lib.mjs` (hanya DB QA). Jalur baca job di QA meniru produksi
(`driver_v2_snapshot_reader` MATI → aplikasi membaca `/armada/my-jobs`).

## 2. Checklist operator HP (isi PASS/FAIL + catatan)

**0. Identitas perangkat** — buka Akun → bagian versi/pembaruan. Catat:
`Versi` (mis. 1.0.0), `versionCode`, `runtimeVersion`, `channel`, `updateId`, model HP + versi Android, jam uji.
Hasil harus: runtimeVersion `1.0.0`, channel `qa-manifest-local-only` (build QA).
*Untuk menentukan channel HP produksi (OTA), ulangi baca ini di HP yang MEMANG dipakai driver dengan build `preview` — di situ channel harus terbaca `preview`.*

**A. Login + kartu job (gerbang MATI)**
1. Layar login menampilkan kolom "BUILD QA — Server uji". Isi URL https ngrok → login `qa.driver@qa.test`.
2. Daftar job memuat 3 job QA (Pelanggan QA A/B/C). Buka Job A: kartu memuat `1 stop • 3 unit`, `3× Kasur Sorong 3in1 custom — 100 × 200 cm`, `U1 U2 U3`, **tanpa harga**.
3. Bagian "Barang dimuat": `0/3 unit`.

**B. Konfirmasi muat 3/3 (Job A)**
4. Ketuk U1 → `1/3`; ketuk "Semua dimuat" → `3/3`. Ketuk U1 lagi → tetap `3/3` (idempoten).
5. Selesaikan pengiriman (foto bukti + nama penerima) → job Selesai.

**C. Offline → sinkron (Job B)**
6. Matikan data seluler + Wi-Fi. Ketuk U1, U2 → label "menunggu sinkron" (jumlah antrean 2).
7. Nyalakan data → antrean terkirim; label jadi `2/3`. **Catat waktu mulai & selesai sinkron.**
8. Tutup paksa app saat offline lalu buka lagi (setelah mengetuk U3 offline) → antrean tidak hilang, terkirim saat online.

**D. Gerbang KAPABEL + pengecualian (Job C; minta pengembang menyalakan server KAPABEL)**
9. Muat 2/3 lalu ketuk "Tandai Selesai" → tombol nonaktif / pesan "Barang dimuat 2/3 unit … belum dikonfirmasi: U3".
10. Isi alasan pengecualian (≥ 5 huruf) → bisa selesai. Ulangi ketukan Selesai dua kali cepat → hanya satu penyelesaian.
11. Admin (web/PC): periksa audit `UNIT_LOAD_EXCEPTION` tepat **1** untuk Job C.

**E. Klien lama tidak terblokir (gerbang MATI)**
12. APK `preview` lama menunjuk server produksi dan tidak punya kolom server, jadi **tidak bisa diarahkan ke backend QA** — butir ini TIDAK dapat diuji di HP.
    Bukti pengganti (tanpa HP): `e2e.mjs` mengirim permintaan tanpa header `X-Capability` (meniru klien lama) → job 0/3 selesai (MATI) dan lolos + sinyal
    `UNIT_LOAD_LEGACY_CLIENT` tercatat (KAPABEL). Di HP lapangan, bukti baru muncul setelah gerbang dinyalakan (pantau sinyal itu).

## 3. Yang harus dikirim balik
Per butir: PASS/FAIL, **screenshot** (kartu job, "Barang dimuat x/y", layar Akun dengan versi/channel/runtime/updateId), **teks error persis** bila ada
(termasuk kode seperti `UNIT_BELUM_DIKONFIRMASI`), **jam** (tanggal + WIB) tiap aksi penting, dan hasil audit di web Delivery. Sertakan model HP + versi Android.

## 4. Kriteria lulus untuk keputusan OTA
Semua butir A–D PASS (butir E = bukti skrip) di ≥ 1 HP fisik; butir 0 mencatat channel HP produksi nyata (`preview` untuk driver-mobile, `control-preview` untuk delivery-control);
tidak ada kehilangan antrean (butir 8); tidak ada data harga tampil. Setelah itu: baca ulang grup update terakhir channel itu dari EAS tepat sebelum terbit
(`eas update:list --branch <channel>`), catat sebagai target rollback, baru terbitkan.

## 5. Bersih-bersih
Hentikan server QA dan ngrok; `DROP DATABASE km_qa_manifest_test` bila tak dipakai lagi; copot APK QA dari HP uji.
