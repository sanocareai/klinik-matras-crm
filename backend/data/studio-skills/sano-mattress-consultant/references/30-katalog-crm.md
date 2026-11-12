# Katalog CRM — Kartu yang Dikirim Konsultan

Sumber: katalog produk SANSS (66 item, dicek 12 Nov 2026 via `daftar_produk`). Setiap item punya foto + teks dan bisa dikirim dari chat.
Agent memilih kartu dengan **nama persis** di bawah, lalu menulis aksi: `[KIRIM_KATALOG: <nama produk>]`.

Aturan kirim (Modul 9): maks **1–3 kartu sekali kirim**, selalu diberi 1 kalimat konteks, tidak di-spam.

## 1. Kartu edukasi — tahap edukasi (sebelum harga)

| Situasi | Kartu |
|---|---|
| Kasur sudah lama / customer heran kenapa kempes | `UMUR BUSA` |
| Berat badan pengguna > ±70 kg, kasur amblas | `BERAT VS KASUR` |
| Menjelaskan apa itu kasur sehat | `Konsep kasur sehat` |
| Keluhan pegal baru-baru ini | `dampak jangka pendek` |
| Keluhan sudah lama / berulang | `dampak jangka panjang` |

## 2. Kartu bukti — testimoni yang mirip kondisi customer

| Keluhan customer | Kartu |
|---|---|
| Saraf kejepit / HNP | `TESTIMONI SARAF KEJEPIT / HNP (2)` (2 foto) atau `TESTIMONI SARAF KEJEPIT / HNP` (1 foto) |
| Sakit pinggang | `TESTIMONI KELUHAN SAKIT PINGGANG` |
| Sakit pinggang + pegal berat | `Testimoni SAKIT PINGGANG & PEGAL AKUT` |

## 3. Kartu produk — tahap harga (setelah diagnosa), sesuai ukuran

| Layanan | Nama kartu (ganti `[UK]` dengan 90/100, 120, 160, 180, 200) |
|---|---|
| Paket Upgrade Fondasi + Lapisan | `Paket Upgrade [UK] Fondasi+lapisan Matras sehat` |
| Upgrade Fondasi saja | `Upgrade [UK] (SFS) Fondasi Matras sehat` |
| Upgrade Lapisan saja | `Upgrade [UK] (SLS) lapisan Matras sehat` (ukuran 200: `…(SLS) Lapisan…`) |
| Service Fondasi + Tambah Busa | `Service [UK] Fondasi+Tambah busa` |
| Ganti Kain Standard | `Ganti kain Standard [UK]` |
| Ganti Kain Premium | `Ganti kain Premium [UK]` |
| Kasur Sehat Custom baru | `Kasur Sehat [UK]x200x[15/20/25/30]cm` (90/100 ditulis `90/100x200x…`) |
| Service Fondasi saja | `Service [UK] Fondasi Matras Sehat` |
| Paket Upgrade Fondasi EXTRA + Lapisan | `Paket Upgrade [UK] Fondasi EXTRA+lapisan Matras sehat` |
| Full Service | `Full Service [UK] (Service+Tambah Busa+Ganti Kain)` |

Kartu "mulai dari" (satu kartu, rincian per ukuran di deskripsi): `Add Fondasi Extra 200kg` · `Add Lapisan Memory Foam` · `Add Lapisan Soft Foam` ·
`Upgrade Lapisan Latex` · `Rubah Texture (Lebih Empuk / Lebih Keras)` · `Sterilisasi Tungau/Kutu` · `Ganti Kain Pinggir` · `Ganti Kain Atas/Bawah` ·
`Topper Kasur Sehat 6cm` / `8cm` / `10cm` · `Kasur Sehat 2in1` · `Sewa Kasur Pengganti`.
Item tambahan ini **belum punya foto** (kartu teks) — sampai aset visual siap, sertakan 1 kalimat penjelasan saat mengirim.

## 4. Kartu garansi — kirim tepat setelah kartu produk

| Layanan | Kartu |
|---|---|
| Upgrade (fondasi/lapisan/paket) & Kasur Sehat Custom | `GARANSI PREMIUM 20 TAHUN` |
| Service (Service Fondasi, Service + Tambah Busa, Full Service) | `Garansi 10 tahun` (dikonfirmasi Owner 12 Nov 2026) |

---

## Status katalog (dirapikan 12 Nov 2026 — 95 item, 89 aktif)
- ✅ 5 item FULL UPGRADE F+L+KAIN dinonaktifkan.
- ✅ Typo testimoni diperbaiki, deskripsi kain/service/garansi/dampak diperbarui.
- ✅ 28 item baru dibuat (aktif, belum berfoto).

## Aset visual berikutnya (belum ada)
- Foto/desain untuk 28 item baru.
- Testimoni per segmen: BB > 100 kg, pasangan beda berat, skoliosis, pasca operasi, kasur merek premium (King Koil/Serta).
- Kartu **Proses Klinik Matras** (jemput → diagnosa → 1–4 hari + update foto/video → antar → bayar setelah sampai).
- Kartu **Upgrade vs Kasur Sehat Custom**.
- Kartu **Hasil Pengujian 70 kg** (foto/video uji penurunan).

Saat aset baru dibuat, cukup perbarui nama kartu di file ini — alur agent tidak berubah.
