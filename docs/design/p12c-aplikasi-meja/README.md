# P12C — Aplikasi Meja / Corner (mode aplikasi) — screenshot review desain

Dihasilkan dari QA browser nyata (puppeteer, klik UI) terhadap staging terisolasi QA-PV2 (data sintetis; bukan production). 74/74 pemeriksaan lulus.
Viewport 390 (HP), 768 (tablet), 1440 (desktop); terang dan gelap. Bottom navigation: Kerja · Bahan · Aktivitas · Akun. Tanpa sidebar desktop.

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
| Jalur V1 (selesai + foto, jeda, bahan, terhambat) | `S9-detail-v1-390-light`, `S9-sheet-complete-390-light`, `S9-after-complete-390-light`, `S9b-sheet-jeda-390-light`, `S9b-bahan-v1-390-light`, `S9b-terhambat-390-light`, `S12-detail-v1-768-dark` |
| Offline | `S10-offline-detail-390-light`, `S10-offline-sheet-390-light` |
| Aktivitas | `S11-aktivitas-390-light`, `S11-aktivitas-1440-dark` |

Catatan desain: tidak ada mockup yang bisa diakses saat implementasi; tampilan mengikuti brief tertulis dan token DS yang ada (putih/off-white, navy, royal blue). Foto pada data staging adalah gambar uji (kotak-kotak), bukan foto kasur.
