# P12C — Aplikasi Meja / Corner (mode aplikasi) — screenshot review desain

Dihasilkan dari QA browser nyata (puppeteer, klik UI) terhadap staging terisolasi QA-PV2 (data sintetis; bukan production), pada **image kandidat bersih** yang dibangun dari `git archive` commit `508aee11` (764 berkas backend + seluruh `frontend/dist` identik dengan arsip; bukan backend hasil `docker cp`). **99/99 pemeriksaan lulus.**
Viewport 390 (HP), 768 (tablet), 1440 (desktop); terang dan gelap. Bottom navigation: Kerja · Bahan · Aktivitas · Akun. Tanpa sidebar desktop.

> **Keselarasan visual dengan mockup: BELUM TERVERIFIKASI.** Mockup acuan yang disetujui tidak tersedia di repositori maupun sesi ini. Tampilan mengikuti brief tertulis dan token DS yang ada (putih/off-white, navy, royal blue). Screenshot ini bahan review desain, bukan bukti bahwa desain sudah sesuai mockup.

| Topik | Berkas |
|---|---|
| Beranda "Pekerjaan Saya" (V2 + V1, satu antrean) | `S1-kerja-390-light/dark`, `S1-kerja-768-light/dark`, `S1-kerja-1440-light/dark` |
| Foto gagal dimuat -> placeholder jujur | `S1b-foto-gagal-390-light` |
| Antrean kosong / izin | `S2-kosong-390-light/dark`, `S2-kosong-meja-1440-light`, `S2-sales-390-light` |
| Akun, pindah mode (hanya yang diizinkan), Mode Latihan | `S3-akun-390-light`, `S12-akun-1440-dark`, `S12-akun-768-light` |
| Detail pekerjaan V2 (nama panjang, Ganti Kain, catatan + Sales, progres server, bahan, dokumentasi) | `S4-detail-v2-390-light/dark`, `S4-detail-v2-1440-light/dark`, `S12-detail-v2-1440-light` |
| Lembar isian tahap + bukti foto | `S5-sheet-step3-390-light`, `S5-sheet-ready-390-light`, `S5-after-390-light` |
| Diagnosis (wizard yang sama) | `S6-detail-diagnosa-390-light`, `S6-wizard-390-light` |
| Menunggu bahan + tab Bahan | `S7-sheet-shortage-390-light`, `S7-bahan-390-light`, `S7-bahan-768-light`, `S7-bahan-1440-dark` |
| Konflik revisi | `S8-konflik-390-light` |
| **V1 — siap dikerjakan (penugasan sah, belum dimulai)** | `S9-detail-v1-siap-390-light` |
| **V1 — selesai tahap + foto → kartu tetap sebagai "Menunggu penugasan berikutnya" untuk PIC terakhir** | `S9-sheet-complete-390-light`, `S9-menunggu-penugasan-390-light`, `S9-daftar-menunggu-390-light` |
| **V1 — serah-terima ke PIC berikutnya (satu kartu siap, tanpa duplikat)** | `S9-meja2-siap-390-light` (puncak daftar Meja 2; kartu V1-nya ada di bawah dan diverifikasi oleh pemeriksaan QA, tidak tampak di screenshot ini) |
| **V1 — menunggu tahap prasyarat (bukan siap; tanpa tombol aksi)** | `S13-menunggu-prasyarat-daftar-390-light`, `S13-menunggu-prasyarat-detail-390-light` |
| **V1 — tombol basi ditolak penjaga (tidak ada tulis, tidak ada log baru)** | `S9s-tombol-basi-390-light` (hasil akhir yang terlihat: layar "tidak lagi di antrean Anda"; pesan penjaga ikut hilang bersama panel) |
| **Corner — penugasan tahap Corner kanonik (siap; lalu menunggu penugasan berikutnya)** | `S14-corner-v1-siap-390-light`, `S14-corner-menunggu-penugasan-390-light` |
| V1 — jeda, bahan, terhambat | `S9b-sheet-jeda-390-light`, `S9b-bahan-v1-390-light`, `S9b-terhambat-390-light`, `S12-detail-v1-768-dark` |
| Offline | `S10-offline-detail-390-light`, `S10-offline-sheet-390-light` |
| Aktivitas | `S11-aktivitas-390-light`, `S11-aktivitas-1440-dark` |

Foto pada data staging adalah gambar uji (kotak-kotak), bukan foto kasur.
