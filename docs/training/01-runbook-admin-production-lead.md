# Runbook — Admin / Production Lead

**Tujuan:** mengatur siapa mengerjakan apa, di meja mana, dengan urutan apa — dan memantau supaya tidak ada unit tertahan.
**Skenario latihan:** S1 Normal · S2 Ganti Kain · S3 Prioritas (juga mendampingi S4–S7).

## 0. Masuk
1. Buka alamat staging latihan → **Email** + **Password** dari pelatih → *Masuk*.
2. Anda mendarat di **Portal**. Pilih workspace **Production Operations** (default-nya Sales CRM — itu bukan tempat kerja Anda).
3. Menu kiri: **Ringkasan · Status Produksi · Rencana Produksi · Quality Control · Laporan Produksi**.
4. Keluar: klik **nama Anda (kanan atas / kiri bawah) → Keluar**.

## 1. Baca keadaan hari ini (2 menit)
- **Ringkasan**: angka target harian (12 unit = 4 meja × 3), unit terlambat, menunggu bahan, menunggu QC. Klik angka → daftar unit.
- **Status Produksi**: 10 kolom dari kiri ke kanan — *Akan Masuk — Pickup Terjadwal → Dalam Perjalanan → Tiba / Belum Mulai → Tahap Bongkar → Uji Fondasi → Fondasi Jadi → Lapisan Jadi → Uji Tekstur Sebelum Corner → Corner → Siap Kirim*. Kartu **tidak bisa diseret**: tahap hanya berubah setelah orang di lapangan mengirim proses + bukti.
- *Akan Masuk* = perkiraan kedatangan, **bukan** pekerjaan berjalan dan **tidak** dihitung target.

## 2. Jadwalkan unit (S1, S2, S3)
Buka **Rencana Produksi**. Kiri = *Belum Dijadwalkan* (terurut **Mendesak → Tinggi → Normal**), kanan = **Meja 1–4** (maks. **3 unit/meja**).
- **Cara A — seret:** pegang ikon **⋮⋮** pada kartu, tahan lalu seret ke meja. Garis biru = posisi sisip. Tunggu *Menyimpan…* selesai.
- **Cara B — tombol:** **Jadwalkan** (dari backlog) atau **Pindahkan** (antar meja) → pilih tanggal, meja, PIC → *Simpan Jadwal*. Hasilnya sama dengan seret.
- **▲ ▼** di kartu = naik/turun urutan di meja.
- **Prioritas** (Normal/Tinggi/Mendesak) dipilih saat menjadwalkan. Prioritas hanya **mengurutkan backlog** dan menentukan **posisi awal** unit masuk meja.
- **Urutan manual selalu menang.** Jika Mendesak/Tinggi berada di bawah unit yang lebih rendah, muncul peringatan oranye *"Urutan manual dihormati — tidak diubah otomatis"*. Itu peringatan, bukan error — putuskan sendiri: biarkan atau naikkan dengan ▲.
- Unit **12/12** (semua tahap selesai) terkunci di dasar meja dan tidak bisa diseret.

### S2 — Ganti Kain
Kartu unit Ganti Kain punya **garis oranye** + kotak *"Ganti Kain — pastikan sesuai permintaan customer"*. Baca **Catatan Sales** (jenis kain, warna). Jika tertulis *"Catatan kain belum tersedia — konfirmasi ke Sales"* → **hubungi Sales dulu**, jangan jadwalkan sampai jelas.

### S3 — Prioritas
Jadwalkan U23 (Normal) lalu U25 (Mendesak) ke meja yang sama; tarik U25 ke bawah U23 → peringatan muncul; muat ulang halaman → urutan **tetap**.

### Siapa boleh apa (singkat)
Owner/Admin: jadwal, urutan, prioritas, **target harian**, harga di Unit 360. **Tombol *Unit Tiba di Workshop*** (Status Produksi) hanya untuk **Production Lead**; Owner/Admin tidak. Foto dokumentasi: Production Lead & Dokumenter (Owner/Admin hanya melihat). Rincian: `10-matriks-siapa-melakukan-apa.md`.

## 3. Buka Unit 360
Klik kartu mana pun → **Unit 360**: identitas + foto, proses per tahap, bahan, QC, dokumentasi, riwayat. Harga hanya tampil untuk peran berizin (Owner/Admin) — **di sini saja, bukan di kartu**.

## 4. Bila ada pesan ini
| Pesan | Artinya | Lakukan |
|---|---|---|
| *Meja sudah penuh (maks. 3 unit per meja)* | Meja 3/3 | Pilih meja lain atau keluarkan unit lain |
| *Rencana unit ini sudah diubah orang lain* | Revisi basi | Layar dimuat ulang otomatis → ulangi sekali |
| *Isi meja berubah saat Anda menyeret* | Ada unit masuk/keluar | Ulangi urutannya dari layar terbaru |
| Kartu **TERLAMBAT** | Lewat target selesai | Cek tahap & PIC; tanya Operator |
| **Menunggu Bahan** | Gudang belum menyerahkan | Hubungi Gudang (lihat `09`) |

## 5. Selesai latihan jika
Anda bisa menunjukkan: (1) S2 terjadwal dengan peringatan kain dibaca, (2) S3 tiga unit terurut dan urutan manual bertahan setelah muat ulang, (3) satu konflik revisi basi ditangani, (4) siapa menunggu siapa pada S4–S7.
