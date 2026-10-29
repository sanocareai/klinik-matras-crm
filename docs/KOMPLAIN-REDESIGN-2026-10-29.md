# Redesign UI/UX Kasus Komplain — 29 Oktober 2026

Cabang: `feat/komplain-redesign` (dari live `e7883bc6`). Status: **kandidat, belum merge, belum deploy.**

## Tujuan
Tim langsung paham keluhan, PIC, progres, dan langkah berikutnya — tanpa scroll panjang dan tanpa memilih status teknis.
**Tidak berubah di backend:** 15 status rinci, graf transisi, izin lintas divisi (complaint:write / job:write / inventory:write / qc:write / order:write), audit, dan gerbang konfirmasi pelanggan
(SELESAI hanya lewat `POST /complaints/:id/confirm-customer`).

## Empat tahap (hanya di tampilan)
| Tahap | Status rinci |
|---|---|
| 1. Terima & Periksa | BARU, VERIFIKASI, INVESTIGASI |
| 2. Tentukan Solusi | ACTION_REQUIRED |
| 3. Kerjakan & Kirim | DIJADWALKAN, DALAM_PENANGANAN, QC, SIAP_DIKIRIM, DIKIRIM_ULANG, MENUNGGU_MATERIAL*, MENUNGGU_JADWAL* |
| 4. Konfirmasi Pelanggan | KONFIRMASI_CUSTOMER, MENUNGGU_CUSTOMER* |

\* "menunggu" tampil sebagai kasus **tertahan** pada tahapnya (penanda oranye). SELESAI/DIBATALKAN = Riwayat (mode baca).
Pemetaan, aksi utama per status, dan "Tindakan lainnya" ada di `frontend/src/features/complaints/complaintFlow.js` dan dikunci tes terhadap graf backend.

## Aksi
Satu **aksi utama** kontekstual (kalimat natural, mis. "Cari penyebab masalah", "QC lolos — siap dikirim", "Pelanggan puas — selesaikan kasus"); semua transisi sah lainnya serta aksi lintas divisi
(buat tugas pengambilan/kirim ulang, minta bahan, tautkan QC, catat tindak lanjut, batalkan) masuk **Tindakan lainnya**. Tombol dikunci dengan petunjuk ("Hanya Delivery (dispatcher) yang bisa
melakukan ini") berdasarkan cermin peran; penegak tetap server (403).

## Bahasa
Root Cause → Penyebab masalah · Resolusi → Solusi yang disepakati · Material Requirement → Minta bahan · Biaya Penyelesaian → **Perkiraan biaya penanganan** (perkiraan tim, bukan pengeluaran
aktual Finance; belum ada tautan data ke pengeluaran Finance per kasus) · Objek Tertaut → Yang sudah dijalankan.

## Daftar
Aktif dan Riwayat dipisah. Sebelumnya `GET /complaints` memotong 300 kasus **tanpa penanda**. Kini: halaman 30 kasus + "Muat lagi (N kasus tersisa)", `Menampilkan X dari Y kasus`.
API aditif (pemanggil lama tetap menerima `{ cases }`): `?scope=aktif|riwayat&statuses=A,B&q=&limit=1..300&offset=`, respons tambahan `total/limit/offset/hasMore`;
`GET /complaints/ringkasan` (jumlah per status, aktif/riwayat, prioritas, lewat target). Masukan tidak valid = 400.

## Rollback
Tanpa migrasi dan tanpa perubahan skema. Rollback = pasang kembali image/dist sebelumnya; tidak ada data yang berubah.
