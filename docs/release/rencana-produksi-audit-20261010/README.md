# Audit & rapikan Rencana Produksi — brief Owner 10 Okt 2026

**Status: BELUM DEPLOY.** Branch `feat/produksi-rencana-audit`, dibangun di atas live aktual `12dda033` (237 migration). Tidak ada perubahan cohort, setting, role, atau order nyata. Semua uji berjalan di staging terisolasi (`sanss-staging-p13`, port 18090), bukan production.

## 1. Bug yang ditemukan (dan statusnya)

| # | Temuan | Dampak | Status |
|---|---|---|---|
| B1 | Panel Belum Dijadwalkan tidak ikut menggulir; saat unit ada di Meja 3–4, tujuan "kembali ke backlog" berada ratusan piksel di luar layar (backlog setinggi ±5000 px). Seret ke sana bergantung auto-scroll panjang. | Kembali-ke-backlog praktis gagal pada mouse 1440 dan lebih parah di HP | **Diperbaiki**: panel sticky di layar lebar + dock "Lepas di sini → kembali ke Belum Dijadwalkan" yang selalu terlihat saat menyeret kartu terjadwal (semua ukuran layar) + tombol "Kembalikan" pada kartu meja |
| B2 | Dialog Jadwalkan/Pindahkan dan "Jadwal & Sumber Daya" memaksa memilih ulang PIC per order padahal PIC Meja sudah jelas | Pilihan ganda, salah-pilih | **Diperbaiki**: PIC bawaan per Meja per tanggal (header Meja), dialog memakai itu sebagai usulan, dapat diganti per order dan ditandai "Berbeda dari PIC bawaan" |
| B3 | Target hanya tanggal papan; tidak ada status gagal target, tidak ada alasan jadwal ulang, tidak ada riwayat | Kartu yang lewat target menghilang tanpa jejak | **Diperbaiki**: target bawaan = tanggal papan; pengecualian per kartu; "Lewat Target" dihitung server (WIB); jadwal ulang wajib alasan terstruktur + catatan; riwayat append-only (target lama, aktor, waktu) |
| B4 | Unit 360 (jalur lama) meminta "Pilih jenis pengerjaan" — pilihan layanan kedua selain item order Sales | Layanan ganda, bisa bertentangan dengan Sales | **Diperbaiki**: pemilih dihapus; rute diturunkan server dari pemetaan Layanan Sales; bila tidak cukup, tampil alasan spesifik dan siapa yang memperbaiki (Admin: pemetaan; Sales: item order) |
| B5 | Pesan tunggu "Production Lead perlu menetapkan layanan unit" | Menyuruh produksi memilih layanan | **Diperbaiki**: pesan menyebut Layanan Sales + Admin/Sales sebagai pemilik perbaikan; "Produksi tidak memilih layanan lain" |
| B6 | BOM: tombol "+ Tambah Bahan" lama, tanpa baris kosong otomatis, tanpa validasi per baris, simpan tidak mendeteksi tidak-ada-perubahan; pemakaian PIC Bahan berupa daftar tetap semua bahan yang diserahkan | Isian lambat dan rawan salah | **Diperbaiki**: pola "+ Tambah baris" seperti PO Finance di tiga tempat (BOM Rencana, BOM PIC Bahan, pemakaian aktual) |
| B7 | Konflik revisi BOM (Rencana): pesan galat terhapus seketika dan rencana tidak dimuat ulang → simpan berikutnya memakai revisi basi | Pengguna tidak tahu kenapa gagal, mengulang tanpa hasil | **Diperbaiki** (ditemukan saat QA browser) |
| B8 | Jargon di layar: "QC & Handoff", "Production Run", "Run produksi", "Cohort aktif", "progres produksi lama (V1)", "Produksi V2 tidak aktif … alur lama" | Istilah teknis bagi operator | **Diperbaiki** (lihat §5) |
| B9 | Server mengembalikan 400 "PIC wajib" sebelum mencari PIC bawaan | — | Berubah sengaja menjadi 422 `PLAN_OPERATOR_REQUIRED` berpesan jelas bila tidak ada PIC bawaan; tes disesuaikan |

Catatan jujur harness: dua kali "gagal" pada uji seret ternyata artefak uji (kartu setinggi ±650 px membuat titik lepas di luar layar; auto-scroll tepi atas membawa pointer ke Meja 1; banner "Install SANSS" menutupi tepi bawah di 390). Semuanya dikoreksi di skrip uji; tidak ada yang disimpulkan dari kartu terkunci.

## 2. Bukti drag-and-drop (unit benar-benar eligible)

Aktivasi cohort dijalankan **hanya di staging** (skrip resmi `activate-rencana-units.js`, 14 unit). Verifikasi hasil lewat API papan, bukan hanya UI.

| Skenario | Mouse 1440 | Sentuh 1440 | Sentuh 390 |
|---|---|---|---|
| Backlog → Meja 1 (Jadwalkan membuka dialog / langsung) | ✔ | ✔ | ✔ (auto-scroll) |
| Backlog → Meja 2 | ✔ | ✔ | — |
| Antar meja (Meja 1 → Meja 3, komit langsung) | ✔ | ✔ | — |
| Urutan dalam meja (kartu kedua ke atas) | ✔ | ✔ | — |
| Kembali ke backlog | ✔ | ✔ | ✔ (dock) |
| Tombol Jadwalkan / Pindahkan / Kembalikan setara | ✔ | ✔ | ✔ |
| Kartu terkunci (AWAIT_ACTIVATION) | tidak punya handle, alasan + langkah berikutnya tampil — **bukan bukti drag** |

Perintah server tetap atomik: kapasitas (409 `PLAN_STATION_FULL`), isi meja basi (`STATION_ORDER_STALE`), revisi basi; papan dimuat ulang dan pesan tampil. Tidak ada perubahan kontrak drag.

## 3. Matriks audit end-to-end

Legenda: **Bekerja** = sudah ada dan terbukti; **Diperbaiki** = diubah di branch ini; **Belum** = belum ada / belum terbukti.

| Elemen brief | Order Produksi → Rencana → Meja → PIC Bahan → PIC QC → Corner → Dokumentasi → Gudang → Siap Kirim | Status | Bukti / catatan |
|---|---|---|---|
| Data order asli | Pelanggan, nomor order, kota, kasur, catatan Sales tampil di kartu & Unit 360 | Bekerja | Kartu di semua layar; sumber order, bukan input ulang |
| Foto pickup | Foto identitas unit dari pickup; bila kosong, penjelasan spesifik (dipakai bersama / belum diunggah / belum ada pickup) | Bekerja | `photoNoteOf` (server) |
| Status tiba | "Posisi: Belum tiba di workshop" + konfirmasi Unit Tiba dengan lokasi wajib | Bekerja | Kartu & modal |
| Layanan Sales | Blok "Layanan Sales" dari item order; tidak ada pilihan kedua | **Diperbaiki** | B4, B5 |
| Prioritas | Normal/Tinggi/Komplain (komplain dari kasus resmi); peringatan inversi | Bekerja | Tidak diubah |
| Target | Target bawaan = tanggal papan; pengecualian; Lewat Target; alasan; riwayat | **Diperbaiki** | B3 |
| Penugasan PIC | PIC per Meja per tanggal + override per order | **Diperbaiki** | B2 |
| Bahan | BOM multi-baris; reservasi; pengambilan; pemakaian aktual multi-baris | **Diperbaiki** | B6; tanpa stock movement baru (4→4 di uji) |
| Komponen sebelum/sesudah | Catatan Komponen (lapisan awal, uji fondasi, hasil aktual) | Bekerja | Fase 2–5 (QA 76/76 sebelumnya) |
| QC | Antrean PIC QC, gerbang QC, putusan | Bekerja | Menu Kepala Produksi menampilkan antrean QC kosong; akun QC khusus tidak ada di staging (lihat §6) |
| Retur | Retur sisa → antrean Gudang → Siap Kirim | Bekerja | Regresi retur lulus |
| Laporan | Laporan sebelum–proses–sesudah, KPI | Bekerja | Tidak diubah |
| Jargon di layar | V1/V2, Run, cohort, QC & Handoff | **Diperbaiki** | §5 |

Tur halaman (14 halaman × 1440/390): tidak ada istilah V1/V2/Run/cohort/"QC & Handoff" pada teks default; tidak ada galat konsol selain 403 yang diharapkan pada antrean PIC QC untuk Kepala Produksi.

## 4. Hasil gerbang

| Gerbang | Hasil |
|---|---|
| Unit backend | 1211/1211 |
| Unit frontend | 819/819 (tes baru: 8 model baris bahan) |
| Integrasi baru (PIC meja, target, Lewat Target, riwayat append-only, idempotensi) | 7/7 |
| Regresi integrasi `production*` + rencana + custody (planning/stok/retur) | **292/292** |
| QA browser seret mouse 1440 / sentuh 1440 / sentuh 390 | 6/6 · 6/6 · 4/4 |
| QA browser PIC meja + target + Lewat Target (1440 dan 390) | 13/13 · 13/13 |
| QA browser BOM multi-baris (1440 dan 390) | 8/8 · 8/8 |
| QA browser layanan/jargon | 5/5 |
| Full suite | tidak dijalankan (sesuai brief) |

## 5. Perubahan jargon (layar operasional)

"QC & Handoff" → "QC & Serah ke Gudang"; "Production Run"/"Run produksi" → "pekerjaan produksi"; "Cohort aktif" → "Unit yang sudah diaktifkan untuk Rencana Produksi"; "progres produksi lama (V1)" → "progres produksi dari sistem lama"; "Produksi V2 tidak aktif … alur lama" → "Unit ini belum diaktifkan untuk alur produksi baru; kerjakan lewat bagian Pekerjaan unit (alur biasa)"; "Handoff Barang Jadi" → "Serah Barang Jadi ke Gudang". Alasan teknis tetap ada di panel Admin (Aktivasi Rencana, Pengaturan Produksi).

## 6. Perubahan teknis & keputusan yang masih dibutuhkan

**Perubahan skema:** migrasi aditif `20261102090000_production_station_pic_target_history` — `production_station_day_pics_v2` (PIC bawaan), `production_plan_schedule_events_v2` (riwayat append-only + trigger), `production_run_plans_v2.target_date` (nullable). Tanpa backfill; NULL = perilaku lama.

**API baru:** `PUT /api/production-v2/stations/:code/pic`, `GET /api/production-v2/plans/:id/schedule-history`; `PATCH /api/units/:id/service` kini boleh tanpa `serviceId` (diturunkan dari Layanan Sales; 409 berkode + `fixBy` bila tidak cukup).

**Keputusan Owner:**
1. **Pemetaan Layanan Sales → rute pengerjaan** harus lengkap (Admin, Pengaturan Produksi › Alur Kerja). Selama sebuah Layanan Sales belum dipetakan, unit order itu tidak bisa diturunkan rutenya; sistem sengaja tidak menebak. Mohon Admin memeriksa daftar.
2. **Kebijakan target**: alasan jadwal ulang berlaku saat tanggal papan berpindah dari rencana yang sudah Lewat Target. Memindah antar meja pada tanggal sama tidak butuh alasan. Konfirmasi ini sesuai maksud.
3. **Kartu AWAIT_ACTIVATION (13 unit di staging, belum diketahui di production)** tetap memerlukan aktivasi Owner lewat skrip; tidak disentuh.
4. **Kegagalan Finance pra-ada** (jurnal pembayaran bertanggal UTC vs laporan jembatan kas hari WIB, 00.00–07.00 WIB) tidak di scope ini.
5. **Rilis**: butuh jendela rilis dengan skrip bergerbang (backup, rehearsal, rollback kode); branch ini tidak menyertakan skrip rilis baru — dapat diadaptasi dari `scripts/release-produksi-fase1-5.sh`.
6. **QA perangkat fisik** (S25/kamera, sentuh nyata) tetap gate terpisah; emulasi sentuh CDP bukan pengganti.

Screenshot sebelum/sesudah: folder `screenshots/` (prefiks `before-` = baseline `12dda033`, `after-`/`final-` = branch ini).
