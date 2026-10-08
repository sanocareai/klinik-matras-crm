# Simplifikasi Production — Slice 1 — bukti QA & matriks perubahan

Branch `feat/production-simplification-slice1` (dari `efd9e8ec`). **Commit + push saja: tanpa deploy, tanpa migration, tanpa perubahan flag/cohort/data produksi.**

Dihasilkan dari QA browser nyata (puppeteer, klik UI) + HTTP nyata terhadap **staging terisolasi QA-PV2** (data sintetis ber-prefix QA-PV2; bukan production; jaringan staging `internal`) pada **image kandidat bersih** yang dibangun dari `git archive` commit `a10c10f2` (backend; tidak berubah sampai commit akhir `6a46dfbb`) dan `frontend/dist` hasil build `6a46dfbb`. Hasil: **API 39/39 lulus**, **UI 71/71 lulus**, tambahan (KPI/Andon/Mode Latihan) **6/6 lulus**. Viewport 1440 (desktop) dan 390 (HP); terang dan gelap pada layar utama.

> **Keselarasan visual dengan mockup: BELUM TERVERIFIKASI.** Mockup acuan tidak tersedia di repositori maupun sesi ini; tampilan mengikuti brief tertulis dan token DS yang ada. Screenshot = bahan review, bukan bukti kesesuaian mockup.
> Belum diuji dengan login production nyata atau perangkat fisik (S25).

## Data uji (isolasi)
596 unit Diproses tanpa rencana (540 unit massal untuk paginasi + unit khusus), 45 unit di papan (matriks QA-PV2 sebelumnya), order multi-unit campur (Diproses+Siap Kirim; Pengambilan+Diproses), order Siap Kirim / dalam pengiriman / Terkirim / Pengambilan, lead SPAM, staf internal, order dibatalkan, prioritas lama (Mendesak/Kritis/Tinggi), catatan bertuliskan "KOMPLAIN" tanpa kasus, 4 `ComplaintCase` (unit-spesifik, tingkat order, SELESAI, unit massal). Total tampilan: Pengambilan 11 · Diproses 655 · Siap Kirim 10 · Terkirim 2.

## Matriks perubahan

| # | Permintaan | Sebelum | Sesudah | Bukti |
|---|---|---|---|---|
| 1 | Hanya **Layanan Sales** di semua layar Production | Kartu/Unit 360/Dokumentasi/Order Produksi menampilkan "Layanan Teknis (Produksi)" berdampingan dengan layanan Sales | Hanya "Layanan Sales". `serviceId`/layanan teknis historis **tidak diubah, tidak ditebak dari layanan Sales**. Satu-satunya jejak: bila rute pengerjaan unit **belum ada**, Production Lead (izin yang sama) boleh menentukannya dari Unit 360 agar tahap bisa mulai — diberi label "rute pengerjaan", bukan layanan. Input Diagnosis tetap (hasil diagnosa, bukan tampilan) | tes `Layanan Sales saja`, S6a, S9 |
| 2 | Status disamakan | Label campur (Menunggu dijemput / Diterima / Dalam produksi / Siap dikirim / Dikirim …) | **Pengambilan · Diproses · Siap Kirim · Terkirim** (peta tunggal `productionDisplay.js`, kembar di frontend `productionLabels.js`, dijaga tes paritas). Rincian lama (mis. "Ditahan pelanggan", "Dalam pengiriman") tersimpan sebagai keterangan kecil | S1, S11, tes paritas |
| 3 | Bedakan status order / keberadaan fisik / tahap | Satu badge menggabungkan semuanya | Tiga hal terpisah: **status** (Diproses…), **keberadaan fisik** (Belum tiba di workshop · Di workshop · konfirmasi tiba belum tercatat), **tahap** (Langkah 1–12). Konfirmasi tiba **tidak dipalsukan**: hanya custody INBOUND diterima Gudang atau run lahir di workshop | S2c, S3, S7a |
| 4 | Prioritas Normal / Tinggi / Komplain | Normal/Tinggi/Mendesak(/Kritis) | **Normal · Tinggi · Komplain**. Nilai tersimpan Mendesak/Kritis **tidak diubah**, hanya tampil "Tinggi" (peringkat urut tetap). Pilihan pengguna di Rencana hanya Normal/Tinggi; Komplain **turunan** | S1 badge, S2, API |
| 5 | **Audit sumber ComplaintCase** | Tidak ada prioritas Komplain | Sumber tunggal = `ComplaintCase` resmi yang **masih terbuka** (status bukan SELESAI/DIBATALKAN). **Bukan** pencarian teks, **bukan** `Order.hasComplaint` (bendera historis "pernah komplain"), **bukan** `Order.complaintCategory` (keluhan kesehatan yang diisi Sales), **bukan** `Order.notes`. Kasus yang menyebut unit → unit itu; kasus tingkat order (`unitId` kosong) → semua unit order itu (keputusan: kasus resmi tak menyebut unit, tak ada dasar mempersempit). Turunan hidup (tidak disimpan): kasus ditutup → kembali Normal; dibuka lagi → Komplain lagi | API 5 cek Komplain + integrasi `AUDIT Komplain` |
| 6 | Urutan manual meja dipertahankan | `stationSequence` menang atas prioritas | **Tidak berubah**: urutan manual selalu menang; peringkat (Komplain > Tinggi > Normal) hanya urutan bawaan backlog, posisi awal "Jadwalkan", dan peringatan inversi non-blocking | tes planDnd, integrasi urutan manual |
| 7 | Hilangkan label/badge V1/V2 dan tab "Kerja V1" | Badge V1/V2, kolom Sumber, filter sumber, tab "Kerja V1", teks "Production V2…" | Tidak ada label sumber di UI. Pesan sistem direkata ("Pekerjaan unit ini belum bisa dicatat dari aplikasi ini") | audit teks di setiap layar (puppeteer) + tes `tanpa label V1/V2` |
| 8 | Satukan aksi di bagian **Pekerjaan** | Unit 360 punya tab Proses + tab "Kerja V1"; unit di luar papan = halaman fallback lain | Tab **Pekerjaan** (Proses + aksi langsung bila server melaporkan papan belum memegang eksekusi); unit di luar papan memakai bagian "Pekerjaan" yang sama. **Endpoint, ownership (409), dan permission sama** — tidak ada endpoint baru untuk aksi | S6a/S6b, tes `satu bagian Pekerjaan` |
| 9 | Rencana Produksi default hanya unit nyata **Diproses** | Backlog dari papan 500 unit | Backlog **dari server**: order nyata (bukan SPAM/staf/dibatalkan) berstatus Diproses **dan** unit Diproses (order Diproses karena "weakest link" tetap memuat unit yang sudah Siap Kirim, jadi status UNIT juga diperiksa). Filter Pengambilan tersedia; Siap Kirim/Terkirim tidak pernah membuka backlog | API 12 cek, S2 |
| 10 | Siap Kirim/Terkirim tidak di backlog/meja; histori utuh | — | Tidak tampil di backlog, antrean Meja/Corner, Rencana. **Tetap ada** di Order Produksi (tab Siap Kirim, Riwayat), laporan, dan data. Kolom pipeline "Siap Kirim" (tahap kerja) diganti **"Serah ke Gudang"** agar tidak tertukar dengan status order | S11, API |
| 11 | Filter server + paginasi, jangan berhenti 500 | `getWorkOrders` dibatasi 500 | `GET /production/work-orders?displayStatus=&q=&page=&pageSize=` (default 100, maks 200) dan `GET /production-v2/backlog` (paginasi + total + counts + `truncated`). 676 unit termuat penuh (13× "Muat lagi"); backlog 596 unit dalam 6 halaman tanpa duplikat | S1 paginasi, API paginasi |
| 12 | Sembunyikan menu QC, **jangan ubah gerbang lifecycle** | Menu Quality Control | Hanya menu disembunyikan (nav + tile portal). Rute `/bengkel/quality-control` dan seluruh gerbang QC/lifecycle **tidak disentuh** (slice 2) | S5, tes |
| 13 | **Pekerjaan Tertunda** (bahasa sederhana) | "Blokir Produksi/Terblokir/Blocker/Terhambat/Menunggu Bahan Baku" | Lihat tabel di bawah | S6, S7, tes |
| 14 | Izin tidak melebar | — | Izin baca backlog = izin baca papan yang sudah ada (`UNIT_READ`/`INVENTORY_READ`); tanpa harga di backlog; operator meja tetap 403 ubah prioritas; Sales 403 mulai tahap; Gudang 403 tunda pekerjaan; Lead non-PIC ditolak guard penugasan | API izin 11 cek, S6a, S10 |

### Pekerjaan Tertunda — pemetaan ke kontrak backend yang ada (enum/histori/permission tidak diubah)

| UI | Dikirim ke backend | Catatan |
|---|---|---|
| Tombol **Tunda Pekerjaan**; pertanyaan **Kenapa pekerjaan ditunda?** | `POST …/stages/:id/fail` (`blockReason`) | label saja |
| Menunggu bahan | `MATERIAL_SHORTAGE` | |
| Menunggu arahan | `AWAITING_CUSTOMER` | |
| Kendala pengerjaan | `MACHINE_DOWN` | |
| Lainnya (**keterangan wajib** ≥ 3 huruf) | `OTHER` + `note` | aturan sama dengan `validateBlockReason` |
| Status kartu **Tertunda — <alasan>** | dibaca dari `blockReason` (8 enum → 4 kelompok); histori `activityLog` dinarasikan saat dibaca, data lama utuh | |
| **Lanjutkan Pekerjaan** | `POST …/blockers/:id/resolve` (pemegang `UNIT_STAGE_WRITE`) | tombol **hanya** bila aksi pemulihan sah |
| Menunggu Gudang / Lead | tidak ada tombol; teks **siapa yang bertindak** ("Gudang menyediakan bahan…", "Hubungi Production Lead…") | mis. kekurangan bahan pekerjaan di papan hanya ditutup Gudang (`INVENTORY_WRITE`) |
| Pekerjaan di papan (Meja/Corner) | `reportProductionV2Shortage` — alasan tunggal "Menunggu bahan" | mekanisme kekurangan bahan **tidak disamakan** dengan Jeda maupun blokir tahap; alasan lain di papan **belum tersedia** (dijelaskan di layar) |
| **Jeda** | `pauseUnitStage` (PauseReason) | tetap fitur terpisah |
| Pesan izin/konflik sistem | teks aslinya | **tidak** dilabeli "Pekerjaan Tertunda" (diuji) |

Diterapkan di: drawer Unit 360, Order Produksi, Status Produksi, Rencana, Ringkasan, Kendali, Aplikasi Meja, Aplikasi Corner, Andon TV, narasi aktivitas/notifikasi pengecualian, KPI & Laporan (kolom "Tertunda (mnt)", status "Tertunda — menunggu bahan").

## Daftar screenshot
| Berkas | Isi |
|---|---|
| `S1-order-produksi-aktif-1440-light.png` | Order Produksi — tab Aktif/Semua/Riwayat + status (Pengambilan/Diproses/Siap Kirim), badge Komplain/Tinggi, hanya Layanan Sales |
| `S1b-order-produksi-setelah-muat-semua-1440-light.png` | Order Produksi — setelah "Muat lagi" sampai SEMUA unit termuat (>500, tidak berhenti di 500) |
| `S1c-order-produksi-siap-kirim-1440-light.png` | Order Produksi — filter Siap Kirim (histori utuh) |
| `S1d-order-produksi-riwayat-1440-light.png` | Order Produksi — Riwayat = Terkirim |
| `S1e-order-produksi-1440-dark.png` | Order Produksi — gelap |
| `S1f-order-produksi-390-light.png` | Order Produksi — HP 390 |
| `S2-rencana-produksi-1440-light.png` | Rencana Produksi — backlog dari server (596 unit Diproses); Komplain di urutan pertama; urutan manual meja tetap |
| `S2b-rencana-backlog-muat-lagi-1440-light.png` | Rencana — "Muat lagi" backlog |
| `S2c-rencana-backlog-pengambilan-1440-light.png` | Rencana — filter Pengambilan (belum tiba di workshop) |
| `S2d-rencana-produksi-1440-dark.png` | Rencana — gelap |
| `S3-status-produksi-1440-light.png` | Status Produksi — status, keberadaan fisik, dan tahap terpisah; kolom "Serah ke Gudang" |
| `S4-ringkasan-1440-light.png` | Ringkasan |
| `S6a-unit360-pekerjaan-luar-papan-1440-light.png` | Unit 360 unit di luar papan — bagian "Pekerjaan", Layanan Sales saja, tanpa label V1/V2 |
| `S6b-tunda-lainnya-wajib-keterangan-1440-light.png` | Tunda Pekerjaan — "Lainnya" wajib keterangan (tombol nonaktif) |
| `S6c-pekerjaan-tertunda-menunggu-arahan-1440-light.png` | Pekerjaan Tertunda — "Tertunda — menunggu arahan" + tombol Lanjutkan Pekerjaan |
| `S6c0-izin-ditolak-bukan-PIC-1440-light.png` | Izin: Production Lead yang BUKAN PIC aktif ditolak server — pesan izin tidak dilabeli "Pekerjaan Tertunda" |
| `S6d-pekerjaan-dilanjutkan-1440-light.png` | Setelah Lanjutkan Pekerjaan |
| `S6e-unit360-ringkasan-1440-light.png` | Unit 360 unit di papan — tab Ringkasan/Pekerjaan/Bahan/Dokumentasi/QC & Handoff/Aktivitas (tanpa "Kerja V1") |
| `S6f-unit360-tab-pekerjaan-1440-light.png` | Unit 360 — tab Pekerjaan |
| `S7a-meja-beranda-390-light.png` | Aplikasi Meja beranda (HP) — status Diproses, "tertunda — menunggu bahan" |
| `S7b-meja-detail-tertunda-390-light.png` | Meja — detail pekerjaan tertunda: penjelasan siapa yang bertindak |
| `S7c-meja-tunda-lainnya-390-light.png` | Meja — sheet Tunda Pekerjaan, "Lainnya" wajib keterangan |
| `S7d-meja-setelah-tunda-390-light.png` | Meja — setelah Tunda Pekerjaan (Kendala/Lainnya) |
| `S7e-meja-tunda-papan-390-light.png` | Meja — Tunda Pekerjaan untuk pekerjaan di papan (alasan: Menunggu bahan) |
| `S7f-meja-tertunda-menunggu-bahan-390-light.png` | Meja — "Tertunda — menunggu bahan" + Gudang yang bertindak |
| `S7g-meja-beranda-1440-light.png` | Aplikasi Meja 1440 |
| `S7h-meja-beranda-390-dark.png` | Aplikasi Meja gelap |
| `S8a-corner-beranda-390-light.png` | Aplikasi Corner (HP) |
| `S8b-corner-beranda-1440-light.png` | Aplikasi Corner 1440 |
| `S9a-dokumentasi-antrean-390-light.png` | Aplikasi Dokumentasi — antrean (Layanan Sales saja) |
| `S9b-dokumentasi-detail-390-light.png` | Aplikasi Dokumentasi — detail |
| `S9c-dokumentasi-antrean-1440-dark.png` | Aplikasi Dokumentasi — gelap 1440 |
| `S10a-sales-meja-390-light.png` | Izin: Sales tidak punya akses Aplikasi Meja |
| `S10b-gudang-unit360-pekerjaan-1440-light.png` | Izin: Gudang (hanya baca) — tanpa tombol Tunda/Lanjutkan/Mulai di Unit 360 |
| `S11a-rencana-sebelum-status-berubah-1440-light.png` | Status berubah — Rencana SEBELUM (3 unit Diproses) |
| `S11b-rencana-sesudah-status-berubah-1440-light.png` | Status berubah — Rencana SESUDAH (Siap Kirim/Terkirim tidak tampil di backlog) |
| `S11c-order-produksi-terkirim-1440-light.png` | Status berubah — Order Produksi tab Terkirim (histori utuh) |
| `S12a-kpi-laporan-1440-light.png` | KPI & Laporan |
| `S12b-andon-1440-light.png` | Andon TV |
| `S12c-rencana-mode-latihan-1440-light.png` | Rencana dalam Mode Latihan |
| `S12d-status-mode-latihan-1440-light.png` | Status Produksi dalam Mode Latihan |
| `S12e-status-produksi-belum-masuk-papan-1440-light.png` | Status Produksi — 652 unit Diproses belum masuk papan (dikerjakan dari Unit 360) |

## Keputusan & batasan (jujur)
- **Komplain tingkat order → semua unit order** (lihat baris 5). Bila ingin dipersempit, perlu `unitId` pada kasus.
- **Alasan tunda untuk pekerjaan di papan hanya "Menunggu bahan"** (mekanisme kekurangan bahan V2 dengan penutup Gudang). Tiga alasan lain tersedia penuh untuk pekerjaan di luar papan; menyamakan keduanya butuh perubahan kontrak backend — bukan slice ini.
- Laporan/KPI **belum bisa difilter menurut Komplain** (filter prioritas laporan = Normal/Tinggi; Tinggi mencakup nilai lama Mendesak).
- Diagnosis tetap meminta "layanan teknis" sebagai **input** hasil diagnosa (tidak ditampilkan di layar lain); nilai tersimpan tidak diubah.
- Mode Latihan memakai snapshot sintetis lama: kolom baru memakai fallback (status dari enum unit; keberadaan fisik tidak ditebak).
- Dua tombol "Lanjutkan Pekerjaan" bisa tampil bersamaan di Unit 360 untuk unit di luar papan yang tertunda (bagian "Pekerjaan Tertunda" menyelesaikan blokir; bagian "Pekerjaan" memulai ulang tahap) — perilaku endpoint lama dipertahankan.
- Staging dipakai ulang oleh sesi QA (data QA-PV2); status unit yang diubah untuk uji dikembalikan setelah QA. Tidak ada data production disentuh.
- Antrean Aplikasi Dokumentasi tidak difilter menurut status order (dokumentasi tahap akhir justru dikerjakan pada unit yang hampir selesai); yang disembunyikan hanya backlog Rencana dan antrean Meja/Corner/papan.
