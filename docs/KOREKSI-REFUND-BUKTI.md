# Koreksi Refund — bukti transfer + biaya admin bank (Okt 2026)

Fitur untuk **Admin Keuangan** (`finance:admin`) pada refund yang sudah DISETUJUI. Branch `feat/koreksi-refund-bukti-biaya-admin`; migrasi aditif `20261105090000_refund_bukti_biaya_admin`.

## 1. Perilaku sebelum fitur ini (audit)

| Hal | Kondisi lama |
|---|---|
| Catat refund | `POST /finance/refunds` (status MENUNGGU_APPROVAL), batas = uang yang pernah diterima; `approve` mengunci baris order dan memposting jurnal via `postRefund`. |
| Biaya admin | **Sudah ada** sejak 24 Sep 2026: `fin_refunds.transfer_fee_type/transfer_fee_amount`, dihitung server (`transferFee.js`); jurnal `Dr akun refund · Dr Beban Administrasi Bank · Cr rekening (nominal+biaya)`. Baris biaya admin sengaja TANPA `cashAccountId` (saldo rekening = total keluar saja). |
| Koreksi refund | `koreksiRefund()` (B3.8): dokumen lama → DIBATALKAN, jurnal lama dibalik, dokumen pengganti (`replaces_refund_id` UNIQUE) + jurnal pengganti, satu transaksi; pratinjau = kode yang sama + ROLLBACK. UI generik hanya mengubah nominal/tanggal/rekening — **biaya admin dan bukti tidak bisa dikoreksi dari layar**. |
| Bukti | Hanya `attachment_url` (teks), disalin apa adanya ke pengganti; **tidak ada** unggahan, validasi isi, relasi dokumen↔bukti, atau penyajian aman. Infrastruktur bukti yang ada: nota (`receipts.js`, JPEG terkompres, tanpa PDF) dan **Klaim Lunas** (`klaimLunasBerkas.js`: magic bytes JPG/PNG/WEBP/PDF, 8 MB, nama acak, URL bertanda-tangan). |
| Export refund | Kolom nominal/biaya/total/rekening sudah ada; tanpa referensi & jumlah bukti. |

## 2. Yang ditambahkan

**Tanpa sistem penyimpanan kedua.** Validasi + penyimpanan berkas memakai `klaimLunasBerkas.js` (kini menerima parameter folder); URL bertanda-tangan memakai `lib/mediaSigning.js` (label kunci `refund-bukti-v1`, 5 menit); penyaji ada di router media Finance yang sudah ada (`/media/finance-receipts/refund-bukti/:file`) — `backend/src/index.js` tidak diubah.

Skema (aditif, tanpa backfill):

| Objek | Isi |
|---|---|
| `fin_refunds.transfer_reference` VARCHAR(120) NULL | nomor referensi transfer (opsional) |
| `fin_refund_evidences` | berkas bukti: `stored_name` (acak), `original_name` (dibersihkan), `mime_type` (dari ISI), `size_bytes` ≤ 8 MB, `sha256`, `status` STAGED→DIGUNAKAN, pengunggah. Baris DIGUNAKAN **tidak pernah berubah/terhapus** (trigger). |
| `fin_refund_evidence_links` | relasi eksplisit dokumen↔bukti (`origin` BARU / DIBAWA). Append-only (trigger) — bukti dokumen lama tetap melekat ke dokumen lama; dokumen pengganti punya tautan sendiri. |

Alur bukti: **unggah dulu** (STAGED, milik pengunggah) → koreksi merujuk id → pada simpan, tautan dibuat + STAGED→DIGUNAKAN dalam transaksi koreksi. Pratinjau di-ROLLBACK (tautan & status tidak tersimpan). Mode: `LAMA` (bukti dokumen lama dibawa), `TAMBAH` (lama + baru), `GANTI` (hanya baru). Dokumen pengganti **wajib ≥ 1 bukti**; refund lama tanpa bukti wajib unggah. Batal/tutup dialog → UI menghapus bukti STAGED; server menyapu yang basi (> 2 jam) pada setiap unggahan/koreksi — tidak ada berkas yatim.

Pengaman koreksi: `finance:admin`, alasan wajib, `Idempotency-Key` wajib (replay = respons yang sama; isi beda dengan kunci sama = 422), baris dokumen/order/rekonsiliasi dikunci + UNIQUE `replaces_refund_id` (paralel: satu 201, satu 409), revisi optimistis `expectedUpdatedAt` (wajib pada alur baru), blokir periode tertutup / rekonsiliasi / sudah diganti / belum disetujui, akun Beban Administrasi Bank diperiksa SEBELUM menulis (fail-closed, pesan Indonesia).

Deteksi biaya admin ganda (`refundBiayaGanda.js`, baca-saja): jurnal PENGELUARAN/MANUAL/PEMBELIAN berlaku dengan uang keluar dari rekening yang sama tepat sebesar biaya admin, ±3 hari, menyentuh Beban Administrasi Bank atau keterangan "admin/biaya bank". **KUAT** = tanggal sama atau referensi transfer muncul di keterangan; **LEMAH** = selisih hari. Sistem tidak menebak/menghapus; kecocokan KUAT yang **menambah eksposur** (biaya/rekening/tanggal berbeda dari dokumen lama) butuh `konfirmasiBiayaGanda: true` — dicatat di audit.

## 3. Jurnal — contoh angka

Refund Rp200.000 + biaya admin BI-FAST Rp2.500 (order sudah diakui):

```
Dr 4-xxxx Retur Penjualan                 200.000   ← nominal pelanggan (tetap 200.000)
Dr 6-1700 Beban Administrasi Bank           2.500   ← biaya bank (beban; bukan omzet/piutang/refund)
   Cr 1-1200 Bank · BCA Operasional                  202.500   ← total keluar
```

Koreksi biaya 2.500 → 5.000 (Lainnya): jurnal lama **dibalik utuh** (termasuk biaya 2.500; isi tidak berubah), dokumen lama DIBATALKAN (tidak diedit), dokumen + jurnal pengganti: Dr Retur 200.000 · Dr Beban Admin 5.000 · Cr Bank 205.000. Saldo BCA: −202.500 → −205.000; Beban Administrasi Bank: 2.500 → 5.000; Retur tetap 200.000. Jurnal selalu seimbang; jurnal tidak ditulis manual di route (`postRefund` / `reverseJournal`).

## 4. Laporan & export

Laporan Laba Rugi: Retur = nominal pelanggan saja; Beban Administrasi Bank memuat biaya admin sekali. Mutasi Kas & Bank = total keluar. Export Refund: *Nominal Refund · Biaya Admin · Total Keluar · Rekening · Referensi · Jumlah Bukti* (TOTAL hanya refund Disetujui). Riwayat versi: nominal, biaya admin, total keluar, rekening, referensi, bukti (nama), pembuat/penyetuju, waktu, alasan koreksi.

## 4b. Lampirkan Bukti — tanpa koreksi

Untuk refund yang **nominal, tanggal, rekening, dan jurnalnya sudah benar** tetapi belum punya bukti transfer. Menu Aksi → **Lampirkan Bukti** (juga di panel detail refund dan di Riwayat perubahan per versi). `POST /finance/refunds/:id/lampirkan-bukti`, `{ reason, bukti: { ids } }`.

Yang dilakukan: membuat/memakai bukti (alur unggah yang sama dengan koreksi: isi berkas menentukan tipe, ≤ 8 MB, nama acak, URL bertanda-tangan 5 menit, bersih bila batal) **dan** menambah tautan append-only (`origin = BARU`) ke dokumen yang dipilih. **Tidak** membuat dokumen pengganti, **tidak** membalik/menulis jurnal, **tidak** menyentuh baris `fin_refunds` (nominal, biaya admin, rekening, tanggal, status, `updated_at` identik — dikunci tes). Bukti bisa ditambah bertahap (maks 10 per dokumen, lampiran lama ikut terhitung); yang sudah terlampir tidak bisa diganti/dihapus (trigger DB).

| Aturan | Perilaku |
|---|---|
| Izin | hanya `finance:admin`; Finance murni/SALES 403 |
| Masukan | alasan ≥ 5 karakter, ≥ 1 bukti, `Idempotency-Key` wajib (tanpa kunci 428; kunci sama + isi beda 422; replay = respons pertama) |
| Paralel | baris dokumen dikunci + bukti dikunci `FOR UPDATE`; dua permintaan dengan bukti sama → tepat satu tautan (satu 201, satu 409) |
| Boleh | refund **DISETUJUI**, atau versi lama **DIBATALKAN yang sudah diganti koreksi** (bukti merujuk transaksi versi itu) |
| Diblokir 409 `REFUND_BELUM_BERTRANSAKSI` | menunggu persetujuan, ditolak, dibatalkan tanpa pengganti |
| Audit | `DOCUMENT_EDITED` dengan `aksi: lampirkan_bukti_refund` (pelaku, waktu, alasan, jumlah sebelum/sesudah, nama berkas, `dampakKeuangan: Rp0`); Riwayat menampilkan "Bukti dilampirkan" dengan nama pelaku |
| Konfirmasi UI | "Tindakan ini hanya melampirkan bukti. Tidak mengubah jurnal atau saldo." + ringkasan rekening/nominal/biaya admin/total keluar + dampak Rp0 (tanpa pratinjau jurnal) |

Setelah dilampiri, koreksi berikutnya bisa memakai **Gunakan bukti lama** (bukti dibawa sebagai `DIBAWA` ke dokumen pengganti; bukti dokumen lama tetap melekat ke dokumen lama).

## 5. Rilis & rollback

`scripts/release-refund-bukti-biaya-admin.sh` (fail-closed; allowlist, pin SHA-256 migrasi, pemindai DDL + mutan negatif, backup + restore nyata, rehearsal dengan uji perilaku, sidik jari tabel lama, smoke baca-saja) dan `scripts/rollback-guard-refund-bukti-biaya-admin.sh`: rollback kode **ditolak** bila ada bukti/relasi bukti, referensi transfer, atau koreksi refund ber-biaya-admin yang dibuat sesudah migrasi terpasang.
