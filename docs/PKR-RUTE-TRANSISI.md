# Mode rute Produksi (transisi) — PKR tanpa rute tidak lagi memblokir (14 Okt 2026)

Branch `feat/produksi-rute-transisi` (di atas live/main `fe253367`). **Tanpa migrasi, tanpa perubahan `schema.prisma`.**

## Masalah
Produk/kategori PKR yang rute Produksinya belum dipetakan (mis. PKR-11102026-005, Kasur Baru, "Kasur Sorong 3in1 Custom") DITOLAK di semua pintu penyimpanan — Finance tidak bisa mencatat tambahan pesanan nyata selama workspace Produksi masih dikembangkan.

## Perilaku baru (mode `TRANSISI`, default)
* Item, harga, dan tambahan pesanan **tersimpan**; unit dan tautan order dibuat (idempoten, Idempotency-Key/replay tetap berlaku).
* Rute **tidak ditebak** dan Produksi **tidak ditandai selesai**: unit lahir `RECEIVED` tanpa lini/jenis produk. Status "Menunggu penentuan alur Produksi" adalah TURUNAN data unit (BARU: alur produk `UNCONFIRMED`; LAYANAN: belum ada layanan produksi) — bukan kolom baru. Rencana Produksi memakai jalur yang sudah ada: unit dengan jenis produk belum jelas meminta konfirmasi jenis produk saat dijadwalkan (tidak menebak).
* Admin Produksi memetakan rute di Pengaturan Produksi › Katalog Item PKR, lalu **menerapkannya** ke unit yang belum mulai (pratinjau → terapkan; idempoten, aman paralel, audit `alur_diterapkan`). Unit yang sudah mulai tidak disentuh; tahap/status/jurnal/stok/harga tidak berubah.
* **Mode `KETAT`** = perilaku lama (item tanpa rute ditolak dengan kode `RUTE_*`); dipilih Admin di panel "Mode rute Produksi" (alasan ≥ 5 huruf, tercatat). Mengubah mode **tidak mengubah dokumen/unit/status lama**. Disimpan di `fin_settings` (`PRODUKSI_RUTE_MODE`); tanpa baris = TRANSISI.

## Kesiapan FISIK (pengecualian operasional Delivery, hanya mode TRANSISI)
`POST /api/armada/orders/:orderId/kesiapan-fisik { unitIds, alasan, bukti? }` + `Idempotency-Key` (JOB_WRITE atau PKR_CATALOG_MANAGE). Mencatat `delivery_execution_events` aksi `UNIT_READY_PHYSICAL` (pelaku, waktu server, alasan, bukti; append-only) — **tanpa** mengubah status unit/tahap Produksi/jurnal/stok dan tanpa menyatakan semua unit selesai.
* Siap kirim = status Produksi `READY_*` **atau** kesiapan fisik terkonfirmasi — dipakai SATU penilai (`services/deliverySiapFisik.js`) di: job otomatis (menunggu seluruh unit yang dikirim), kirim sebagian resmi, pembuatan job manual, daftar unit tersedia, konfirmasi muat, dan penyelesaian/POD driver (order PKR).
* Unit yang tidak ada / belum siap fisik tidak ikut job diam-diam; pengiriman sebagian memakai alur resmi (`kirim-sebagian`) dan sisa unit tetap terlihat. Mode KETAT: konfirmasi fisik lama diabaikan, yang baru ditolak (`MODE_KETAT`).

## Audit pintu yang menolak rute kosong
| Pintu | Sebelum | Sesudah |
|---|---|---|
| Pembuatan PKR / pratinjau / Item terpadu / Lengkapi | `RUTE_*` 400 | TRANSISI: tersimpan + peringatan `MENUNGGU_ALUR_PRODUKSI`; KETAT: 400 |
| Koreksi Order — Tambahan permintaan customer, Koreksi Item (tambah/ganti produk/tambah jumlah) | 422 `RUTE_*` | idem |
| Rencana Produksi | unit rute kosong → konfirmasi jenis produk (sudah ada, tidak menebak) | tidak berubah |
| Pembuatan job | hanya unit `READY_*` | `READY_*` atau siap fisik (TRANSISI) |
| Muat / POD | tanpa pemeriksaan unit fisik | order PKR: unit tanpa dasar siap → 409 `UNIT_BELUM_SIAP_FISIK` |

## Izin
Ubah mode & terapkan alur: `pkr_catalog:manage` (Admin/Owner). Baca mode: Finance/Admin. Konfirmasi fisik: dispatcher/Admin (JOB_WRITE) atau pengelola katalog. Sales/Driver/Finance biasa ditolak (403).

## Dampak & urutan rilis bersama Delivery Manifest
1. Delivery Manifest (`fe253367`) sudah LIVE — rilis ini membangun di atasnya; tidak ada ketergantungan migrasi.
2. Rilis ini: kode saja (backend + web). Perilaku produksi berubah SEGERA setelah deploy: default TRANSISI ⇒ item tanpa rute mulai tersimpan; muat/POD driver (order PKR) mulai memeriksa unit fisik.
3. Gerbang muat unit (`DELIVERY_UNIT_CONFIRM_REQUIRED`) tetap MATI; OTA RN belum terbit (lihat `docs/DELIVERY-MANIFEST-RN-OTA.md`). Pemeriksaan "unit siap fisik" di endpoint muat juga berlaku untuk RN lama yang memanggilnya (RN lama belum memanggil unit-load).
4. Rollback kode aman (tanpa migrasi): kode lama menolak item tanpa rute lagi; unit yang sudah terlanjur dibuat tanpa rute tetap ada (kode lama menampilkannya apa adanya, tanpa label "menunggu alur"); Produksi tetap menahannya sampai jenis produk dikonfirmasi. Konfirmasi fisik yang tersimpan hanya event (tak berdampak pada kode lama).

## Tes
`backend/tests/integration/pkrRuteTransisi.integration.test.js` (8): default tersimpan + replay idempoten + 3 unit Indra; KETAT = perilaku lama; izin; pemetaan kemudian (pratinjau/terapkan/paralel/audit/unit mulai dilewati); Koreksi Order tambahan pada order lama; kesiapan fisik + pengiriman sebagian; muat/POD; order biasa tidak berubah. Frontend: `frontend/tests/pkrRuteTransisiUI.test.js`. QA browser 1440/390 terang/gelap.
