# AOV Tim Sales — Order Masuk vs Order Lunas (29 Okt 2026)

Kode: `backend/src/services/salesAov.js` · API: `GET /api/analytics/sales-aov`, `GET /api/analytics/sales-aov/orders` · UI: Laporan › Sales (`KartuAovTim.jsx`).
Tes: `backend/tests/integration/salesAov.integration.test.js` (DB terisolasi).

## Dua metrik (jangan dicampur)
| | AOV Order Masuk Tim | AOV Order Lunas Tim |
|---|---|---|
| Himpunan order | dibuat (`createdAt`) di periode | menjadi lunas (`paidAt`) di periode |
| Rumus | Σ nilai bersih ÷ jumlah order dari himpunan **yang sama** | idem |
| Order dibuat bulan lalu, lunas bulan ini | tidak ikut | ikut (ditandai "lintas periode") |

Pembilang dan penyebut tiap metrik selalu dari satu himpunan order; kartu, daftar drilldown, dan ringkasan di modal memakai query yang sama (parity diuji).

## Cakupan Tim (sama dengan Laporan Sales)
- Periode = tanggal kalender WIB, awal inklusif, akhir eksklusif (awal hari berikutnya). Tanpa from/to = semua waktu.
- Tim = akun **aktif** berperan SALES + akun aktif bertanda Team Lead (mis. Novi, berperan ADMIN). Closing pribadi Team Lead **ikut**.
- Atribusi: pemilik eksplisit (`salesOwnerId`) di Tim; bila kosong → percakapan INDIVIDUAL pelanggan dipegang anggota Tim. Tiap order dihitung **satu kali**.
- Dikecualikan: CANCELLED, PENDING, pelanggan SPAM, order Penjualan Karyawan (PKR), order tanpa atribusi ke Tim, order milik akun di luar Tim (mis. Sales nonaktif). Dua kelompok terakhir **dilaporkan** di `diagnosa`, tidak dibuang diam-diam.
- Nilai = **nilai bersih** (`Order.value` − Nota Kredit aktif, tidak pernah negatif). Order Rp0 tetap dihitung sebagai order.
- Refund: tidak mengubah AOV Masuk. Refund yang membuat order tidak lagi Lunas mengosongkan `paidAt` (routes/orders.js) → keluar dari AOV Lunas. Refund pada order yang tetap Lunas tidak mengubah nilai; jumlahnya ditampilkan (`orderBerefund`).

## Beda definisi terhadap angka lain
| Angka | Populasi | Selisih terhadap AOV Tim |
|---|---|---|
| AOV Dashboard (`/revenue-series`) dan Ringkasan Laporan (`/business-summary`) | **seluruh perusahaan**, order dibuat di periode, bersih, tanpa PKR | = AOV Masuk Tim + order tanpa atribusi + order milik akun di luar Tim |
| AOV per Sales (tabel Laporan Sales) | per Sales, order dibuat | order yang percakapannya dipegang dua anggota Tim terhitung di keduanya; kartu Tim menghitung sekali |
| "Nilai Order yang Menjadi Lunas" (Laporan Sales) | basis `paidAt`, per Sales dijumlah | = pembilang AOV Lunas Tim (kecuali order lunas ganda antar-Sales) |
| AOV di halaman Order (`Orders.jsx`) | order pada filter halaman itu | filter bebas, bukan periode WIB Laporan |

## Perbaikan terkait
`/revenue-series` (Dashboard) menjumlah nilai tanpa mengecualikan order PKR, padahal penyebutnya (jumlah order) mengecualikan PKR — pembilang dan penyebut dari populasi berbeda. Sekarang keduanya tanpa PKR. Pada data produksi Oktober 2026 dampaknya Rp0 (order PKR bernilai Rp0), jadi ini perbaikan pencegahan.

## Bug yang ditangkap tes sebelum rilis
Diagnosa order tanpa atribusi memakai `NOT (salesOwnerId IN … OR …)` di SQL; `salesOwnerId` NULL membuat ekspresi NULL sehingga order tanpa atribusi lenyap dari diagnosa. Diganti selisih himpunan di JS.

## Rollback
Tanpa migrasi dan tanpa perubahan skema; kode saja. Kembalikan image/dist sebelumnya; endpoint `sales-aov*` hilang dan kartu "AOV Tim" lama kembali.
