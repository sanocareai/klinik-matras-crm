# Order BARU/custom — jalur Pengerjaan Pesanan (WORKSHOP_BORN)

Cabang: `fix/order-baru-jalur-pengerjaan` (dari live `86cb882f`). Belum di-deploy, belum di-push.

## Temuan pada kode live

Kode live **belum mendukung** alur ini. Unit BARU yang dijadwalkan sudah lahir sebagai Run `WORKSHOP_BORN` (tanpa pickup/custody — itu sudah benar), tetapi seluruh jalur kerjanya tetap jalur
restorasi:

| Gap | Bukti (staging, unit BARU terjadwal) |
|---|---|
| Tahap berikutnya = Langkah 1 "Foto Sebelum Bongkar" | `next = {TABLE, stepNo 1, START_WITH_EVIDENCE}` |
| 12 tahap semuanya berlaku, progres 0/12 | `progress.total = 12`, tidak ada tahap `NA` |
| Setelah bongkar → Diagnosa → butuh layanan teknis | engine V1 `pathForUnit` = INTAKE (bongkar/diagnosa) + modul layanan; tanpa layanan → jalur tidak tersusun |
| Tahap modul menunggu bahan ISSUED | `assertMaterialIssued` untuk semua tahap non-INTAKE |

Yang **sudah** benar dan tidak diubah: kelahiran Run WORKSHOP_BORN, tanpa pickup/konfirmasi tiba, jadwal + PIC lewat `POST /plans {unitId}`.

## Perubahan (hanya gap di atas)

1. **Master routing (migrasi aditif `20261018100000_production_build_stage`)**: satu tahap `custom_build` ("Pengerjaan Pesanan", MODULE seq 10, `requires_photo`, tanpa QC,
   `ON CONFLICT DO NOTHING`). Tidak mengubah baris/jalur lama.
2. **Penentu jalur** — `lib/domain/productionBuildTrack.js`: jalur pengerjaan = Run `origin = WORKSHOP_BORN` **dan** `Order.category = BARU` (jenis unit kanonis), **bukan** awalan resi `NEW-`.
   `unitStageEngine.unitUsesBuildTrack` / `buildTrackUnitIds` (bulk) + `pathForUnit(..., {build})`.
   Jalur = `[Pengerjaan Pesanan]` + gerbang/penutup yang sama (uji tekstur PIC → QC → Corner → Finish). Tanpa INTAKE, tanpa modul layanan.
3. **Tahap berlaku** = 6, 8–12. Tahap 1–5 dan 7 **tidak berlaku**: status `NA` (+ `naReason`), tidak ada bukti/operasi/log yang ditulis, tidak dihitung dikerjakan maupun dilewati. Fase INTAKE/DIAGNOSIS Run baru
   `NOT_APPLICABLE` dengan alasan eksplisit.
4. **Langsung dikerjakan** setelah jadwal + PIC (`prepareStartInTx`: cukup rencana PLANNED/MATERIAL_RESERVED; bahan **bukan** gerbang mulai pada jalur ini). `deriveNextAction` mengembalikan `START` tahap 6.
5. **Bukti tahap 6 (jalur BUILD)**: video + penjelasan pengerjaan wajib; **bahan opsional** — bila diisi tetap harus dari bahan yang diserahkan Gudang dan tidak boleh melebihi (aturan lama).
6. **BOM, serah bahan, pemakaian bahan, dokumentasi hasil, retur sisa** tetap tersedia & berfungsi sesuai pekerjaan nyata (retur = diserahkan − dipakai).
7. **Read-model**: `track: "BUILD"|"RESTORATION"` di kartu/Unit 360; label tahap 6 "Pengerjaan Pesanan"; indikator Layanan = `TIDAK_BERLAKU`, BOM = `OPSIONAL`; Unit 360 `service.applicable=false`.
8. **Antrean V1, laporan KPI/dokumentasi**: memakai jalur yang benar (cache path tidak lagi hanya per layanan; loader laporan menerima petunjuk BUILD).
9. **UI**: label per jalur (kartu, tombol aksi, lembar bukti, drawer Unit 360, bucket "Pengerjaan Pesanan"), tahap tidak berlaku tertulis "tidak berlaku", panel Diagnosis diganti catatan.
   Layanan Sales, jenis/merk/ukuran, catatan Sales **sudah** tampil di kartu dan detail (tidak diubah).

## Yang TIDAK diubah
- Unit LAYANAN (routing, Diagnosis, custody, pickup) dan Run/histori lama: tanpa perubahan jalur, tanpa backfill.
- Unit SEWA: sengaja **tidak** masuk jalur pengerjaan (`BUILD_CATEGORIES = ["BARU"]`) sampai ada keputusan Owner; perilaku lama tetap.
- Cohort, flag, pengaturan produksi: tidak disentuh.

## Keputusan terbuka untuk Owner
1. **SEWA**: ikut jalur pengerjaan? (satu baris konfigurasi; saat ini perilaku lama).
2. **Tahap 8 "Uji Tekstur Akhir" (PIC) dan gerbang QC "Uji Berat Badan"** tetap ada pada jalur ini (khas kasur). Untuk produk custom non-kasur perlu gerbang berbeda? Mode adaptasi AKTIF sudah mencatat QC "tidak dilakukan".
3. **Bahan**: tetap opsional pada tahap 6, atau wajib bila BOM sudah dibuat?

## Rilis
Perlu **migrasi + kode** (backend + frontend). Tidak ada backfill. Run BARU yang sudah ada di production: 0 (belum ada Run WORKSHOP_BORN), jadi tidak ada Run berjalan yang berpindah jalur.
Rollback: image sebelumnya; baris `custom_build` aman dibiarkan (tidak dipakai jalur lain).

---

# Slice 2 — selaras keputusan Owner (jenis produk, racikan, QC, pipeline)

Cabang `fix/order-baru-jalur-pengerjaan` dari `a73bd647`. Belum deploy. Tidak ada perubahan konfigurasi, role, cohort, atau data production.

## Keputusan Owner → implementasi
| Keputusan | Implementasi |
|---|---|
| Layanan Sales = tanda pekerjaan; operator tidak memilih layanan teknis | Tidak ada pemilihan/pemetaan layanan teknis di jalur BARU; layanan Sales tampil di kartu, Meja, QC, Unit 360, laporan |
| PIC Meja + PIC QC menentukan racikan & evaluasi | Kasur: **racikan fondasi dan/atau lapisan wajib** di Pengerjaan Pesanan (foto atau video, tidak lagi wajib video); layar QC menampilkan spesifikasi Sales + racikan |
| Kasur: spek → racikan → pengerjaan → uji hasil PIC QC → Corner → dokumentasi → selesai | Tahap berlaku 6, 8–12; uji tekstur PIC (8) + QC berat badan |
| Non-kasur (divan/sofa): tanpa uji tekstur/berat badan | Tahap berlaku 6, 9–12 (tahap 8 "tidak berlaku"); QC **generik**: foto + catatan + lulus/gagal/rework ke Pengerjaan Pesanan; server menolak `fitVerdict`/berat acuan; tanpa baris `qc_fit_tests` yang dikarang; gerbang tertulis "Pemeriksaan Hasil" |
| Jenis dari jenis produk kanonis | `classifyProduct`: `Order.productType` (didahulukan) + `Order.productLine`. KASUR\_*, MULTIBED, KASUR\_LAINNYA → kasur; SOFA\_*, SOFABED, DIVAN\_* → non-kasur. Bukan nama layanan, bukan awalan resi |
| Klasifikasi kurang → laporkan | Lini↔jenis bertentangan / jenis tak dikenal / lini kosong = `BELUM_JELAS`; lini KASUR bawaan tanpa jenis = kasur + peringatan. Alur kasur dipakai (gerbang mutu tidak dilonggarkan) dan peringatan `JENIS_PRODUK` tampil di kartu, Unit 360, layar QC |
| SEWA tidak otomatis mengikuti BARU | `BUILD_CATEGORIES = ["BARU"]`; SEWA tetap perilaku lama (diuji) |
| Bahan tidak menahan mulai; pemakaian dari bahan sah; tanpa stok keluar ganda; retur diselesaikan | Tahap 6 menerima bahan hanya dari yang diserahkan Gudang (tidak boleh melebihi); stok `ISSUE` hanya saat Gudang menyerahkan (diverifikasi: tetap 2 setelah pemakaian); sisa menjadi retur (`RETURN` 2) dan Gudang tidak bisa menerima barang jadi sebelum retur diterima (aturan lama) |
| Adaptasi: QC boleh tidak dilakukan, selesai langsung Siap Kirim tanpa penerimaan barang jadi | Berlaku untuk kasur dan non-kasur (diuji sofa); Corner yang tersisa dicatat dilewati |
| Pipeline: "Pengerjaan Pesanan" bukan "Fondasi Jadi" | Kolom baru `Pengerjaan Pesanan` dan `Uji Hasil Sebelum Corner` hanya untuk jalur BUILD; belum mulai = "Tiba / Belum Mulai"; jalur lama tidak berubah |
| LAYANAN tidak diubah | Tidak ada perubahan; diuji |

## Rehearsal migrasi (staging, DB berisi data)
Titik pulih: `pg_dump -Fc` DB staging (218 migrasi, 12 routing stage, 1 Run, 17 order) — **restore-verified** ke DB scratch (218/12/17).
Image dibangun dari arsip git commit kandidat (bukan tree kerja) + frontend dibangun dari commit yang sama; `migrate deploy` berjalan pada DB berisi:
218 → **219** migrasi, `routing_stages` 12 → 13 (hanya `custom_build | MODULE | 10 | tanpa QC | wajib foto | aktif`), sidik jari md5 12 stage lama **identik**, Run/order tidak berubah.

## QA browser (image kandidat bersih, staging terisolasi)
Skenario nyata: kasur custom (adaptasi OFF, bahan+retur), divan (OFF, QC generik + rework), kasur custom (adaptasi ON), sofa L (adaptasi ON, selesai), PIC Meja ditugaskan lewat jadwal resmi.
Screenshot 390 & 1440 × terang/gelap di `screenshots/` (48 berkas, termasuk Meja, lembar bukti racikan, QC kasur vs divan, Rencana, Ringkasan, Unit 360, laporan sofa & kasur). Hasil: `qa-ui-result.json` (48/48 PASS).

## Batas yang diketahui
- Corner **tetap** tahap untuk divan/sofa pada mode non-adaptasi (tahap 9–12); "Corner bila diperlukan" baru berlaku lewat Selesaikan Produksi (adaptasi). Perlu keputusan bila Corner harus opsional per produk.
- Pengisian racikan di lembar bukti diuji lewat UI (tampil + validasi); pengiriman bukti dengan unggah media diuji lewat API (unggah kamera tidak diotomasi).
- Verifikasi akun "Risdy" = PIC QC Risdi **tidak dilakukan** (pembacaan production ditolak oleh pengaman sesi). Tidak ada akun/role yang dibuat.
- Satu error konsol 403 (satu request) selama QA tidak teridentifikasi sumbernya; tidak memblokir alur.
