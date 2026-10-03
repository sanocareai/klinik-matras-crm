# Runbook — Operator Meja

**Tujuan:** mengerjakan tahap 1–9 satu per satu, mengirim bukti yang benar, dan melapor bila bahan kurang.
**Skenario latihan:** S2 (lihat Ganti Kain) · S4 Bahan kurang · S5 rework setelah QC gagal · S1 Normal.

## 0. Masuk & antrean Anda
1. Buka alamat staging → email + password dari pelatih. Anda langsung masuk ke **Operasional Produksi**.
2. Buka **Aplikasi Meja** (`/produksi/meja`). Layar menampilkan **satu kartu aktif**: kode unit, pelanggan, meja, detail kasur, berat badan, keluhan, **Layanan Sales**, **Request khusus**.
3. Di bawah kartu: **Tindakan berikutnya · Tahap N** + **satu tombol biru besar**. Hanya itu yang boleh Anda kerjakan sekarang.

## 1. Baca kartu sebelum bekerja (30 detik)
- **Layanan Sales** = yang dijual. Jika **Ganti Kain** → kotak oranye *"pastikan sesuai permintaan customer"*. Baca *Request khusus* (jenis/warna kain). Kalau tertulis *"Catatan kain belum tersedia"* → **berhenti, tanya Production Lead/Sales**.
- Tulisan merah *"Melewati target selesai"* = informasi, bukan alasan melewati tahap.

## 2. Mengerjakan tahap (pola yang sama tiap tahap)
1. Tekan tombol biru (mis. **Mulai: Foto Sebelum Bongkar**, **Kirim Diagnosa**, **Kirim Bukti …**).
2. Isi formulir tahap. Ambil **foto/video** sesuai aturan tahap (tanda *wajib*; beberapa tahap **wajib video**).
3. Tekan **Kirim**. Tunggu centang hijau. Kartu pindah ke tahap berikutnya.
4. Jaringan putus → tombol *Coba Lagi*; **jangan mengisi ulang dari awal** — isian disimpan.

Urutan: 1 Sebelum Bongkar → 2 Uji Rasa Awal → 3 Hasil Bongkar & Material Lama → 4 Uji Fondasi Lama → **5 Diagnosa Teknis** → 6 Fondasi Baru → 7 Lapisan Baru → 8 Uji Tekstur Akhir → 9 Kirim ke Corner (Corner mengambil alih tahap 10–12).

## 3. S4 — Diagnosa & bahan kurang
1. U26 menunggu **Kirim Diagnosa**. Isi temuan, pilih layanan, lalu pada daftar bahan pilih **QA-PV2 Busa Langka**, qty **4**.
2. Setelah dikirim, Gudang mencoba mereservasi. Bila stok kurang, kartu Anda menampilkan **Menunggu bahan baku** — tekan **Menunggu Bahan Baku** (merah) supaya Gudang langsung melihat kekurangan. Pekerjaan berstatus *dijeda*; **jangan lanjut tahap 6**.
3. Tunggu Gudang menambah stok, menyerahkan bahan, lalu menekan *Tandai Sudah Diserahkan*. Tombol Anda berubah menjadi **Lanjutkan Pekerjaan** — tekan. Tombol berikutnya **Lanjutkan** (tahap 5) — tekan lagi (**dua kali tekan berturut-turut itu normal**). Tahap 6 *Fondasi Baru* lalu mulai otomatis; kirim bukti (**video wajib**; tanpa bukti ditolak) seperti biasa.
> Tidak ada tombol "Jeda" manual di aplikasi ini: jeda terjadi otomatis lewat *Menunggu Bahan Baku*.

## 4. S5 — Rework setelah QC gagal
Bila QC memutuskan **GAGAL**, kartu kembali ke tahap yang ditunjuk QC dengan label **Ulangi … (Rework)**. Baca alasan QC di kartu. Perbaiki, kirim bukti baru. Bahan tambahan: minta Gudang lewat Production Lead. Setelah **Uji Tekstur Akhir** terkirim → kartu **menunggu QC ulang**. Anda tidak bisa memutuskan QC sendiri.

## 5. Bila ada pesan ini
| Pesan | Lakukan |
|---|---|
| *Tahap ini belum waktunya* | Kerjakan tahap yang disebut dulu |
| *Unit ini ditugaskan ke PIC lain* | Berhenti — hubungi Production Lead |
| *Data unit sudah berubah* | Kartu dimuat ulang → cek → kirim lagi |
| *Ada foto/video belum selesai terunggah* | Unggah ulang lalu kirim |
| *Berkas terlalu besar* | Rekam lebih singkat (video ≤ 80 MB, foto ≤ 15 MB) |
| *Menunggu QC / Menunggu Gudang* | Anda tidak perlu berbuat apa-apa — ambil unit lain |

## 6. Larangan
- Jangan mengirim foto lama/foto unit lain (sistem menolak foto yang sama dipakai unit lain).
- Jangan "menyelesaikan" tahap tanpa mengerjakannya agar antrean cepat kosong.
- Jangan mengerjakan unit yang bukan di antrean Anda.
