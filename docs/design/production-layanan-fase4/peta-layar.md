# Fase 4 LAYANAN — peta layar (mockup untuk review)

Semua angka/nama di mockup adalah **contoh ilustrasi**, bukan data sistem (pita kuning di tiap layar). Penurunan fondasi dan penurunan kasur utuh **tidak dijumlahkan** dan tidak diberi label "amblas" otomatis.
Berkas: `mockups/*.html` (generator `build.mjs`, jepretan `shoot.mjs`), jepretan di `screenshots-mockup/` (`*_390.png` = halaman panjang, `*_390_viewport.png` = tampilan nyata dengan tombol utama & navigasi lengket, `*_1440.png` = desktop; `_light`/`_dark`).

## Alur (mengikuti diagram rancangan)
Racikan Fase 3 disetujui (fondasi + lapisan + BOM) → **PIC Meja** rakit fondasi (tahap 6) → **PIC QC** uji fondasi baru + foto/video → **PIC Meja** susun lapisan + catat hasil aktual (tahap 7) → **PIC QC** uji kasur jadi + bandingkan keluhan awal → **Hasil QC**: *Perlu perbaikan* → kembali ke rakit fondasi (jalur rework yang ada) · *Sesuai* → Keputusan Corner (Fase 5).

## Enam layar mobile (390 px)
| # | Layar | Aplikasi / peran | Isi utama | State yang digambar |
|---|---|---|---|---|
| 1 | Pekerjaan Meja | Meja · PIC Meja | foto unit besar, progres 5/12, daftar tahap, kartu "Racikan Fase 3 disetujui", konteks (keluhan, kondisi awal), tombol "Mulai: Rakit Fondasi" | default; **kosong** (racikan Belum dicatat → tombol nonaktif) |
| 2 | Fondasi Terakit | Meja · PIC Meja | video fondasi, rencana ↔ hasil aktual berdampingan, bahan tertaut (BOM → diserahkan → dipakai), tombol "Kirim ke PIC QC" | default; **menunggu PIC QC**; **beda dari rencana** (alasan wajib + revisi berversi) |
| 3 | Uji Fondasi PIC QC | PIC QC | acuan fondasi awal (25→15, turun 10 cm), form tinggi tanpa beban/dibebani, **penurunan dihitung sistem**, berat penguji aktual (tidak terisi otomatis), metode/titik, "sama dengan uji awal", foto/video, catatan | default (sebanding); **kosong**; **pengukuran tidak sebanding** (berat beda → "perbandingan langsung belum valid", kedua angka tampil) |
| 4 | Susun Lapisan | Meja · PIC Meja | rencana ↔ aktual per lapisan atas→bawah (bahan berkode, tebal, tindakan), total tinggi rencana vs aktual + selisih, bahan tertaut | default; **beda dari rencana** (alasan wajib); **kosong** (hasil aktual Belum dicatat) |
| 5 | Uji Kasur Jadi PIC QC | PIC QC | kondisi awal→racikan→hasil, feel, kesesuaian keluhan awal, berat penguji, metode, penurunan kasur utuh, foto/video, perbandingan dengan uji awal, **putusan QC** (jalur QC yang ada) | **sesuai → Corner**; **perlu perbaikan → rework ke Meja**; kosong |
| 6 | Ringkasan Unit 360 | Unit 360 / Dokumentasi / laporan / Sales | tiga tahap: kondisi awal → racikan → hasil akhir (angka terpisah, "Belum dicatat" bila kosong) | sesuai; perlu perbaikan; kosong |

## Desktop (1440 px)
- **D1 Aplikasi PIC QC**: antrean di kiri + konteks baca-saja; formulir uji fondasi baru di kanan (default sebanding; tidak sebanding).
- **D2 Unit 360**: tiga kolom Kondisi awal | Racikan rencana | Hasil akhir dengan foto/video (sesuai; perlu perbaikan).

## Catatan pemetaan ke sistem
- "Lapisan awal turun 3 cm" pada brief digambar sebagai **penurunan kasur utuh awal 3 cm** (bidang `wholeDropCm` Fase 2); lapisan awal sendiri hanya punya total tinggi (tidak ada "penurunan").
- Tombol utama lengket = satu aksi per layar (tahap server `next`); QC memakai formulir Catatan Komponen yang sama dengan Fase 2.
