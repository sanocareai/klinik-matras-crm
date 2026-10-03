# Matriks: siapa melakukan apa

**M** = boleh · **—** = ditolak server (403) · **L** = hanya melihat. Sumber: **probe respons server** pada staging (4 Okt 2026) — bukan perkiraan tampilan. Aturan ditegakkan **server**.

| Tugas | Owner | Admin | Production Lead | Operator Meja | PIC Corner | QC | Gudang | Dokumenter |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Lihat Status Produksi, Unit 360 | M | M | M | M | M | M | M | M |
| Lihat Laporan/KPI Produksi | M | M | M | — | — | — | — | — |
| Lihat Antrean Gudang | M | M | M | — | — | — | M | — |
| Lihat **harga** di Unit 360 | **M** | **M** | — | — | — | — | — | — |
| **Penerimaan Unit** (Gudang → *Periksa & Terima*) | — | — | — | — | — | — | **M** | — |
| Tombol **Unit Tiba di Workshop** (Status Produksi) | — | — | M | M | M | M | — | — |
| **Jadwalkan** / pindah meja / **urutan** / prioritas | M | M | **M** | — | — | — | — | — |
| Atur **target harian** | M | M | — | — | — | — | — | — |
| Kerjakan **tahap produksi** (hanya unit yang ditugaskan padanya) | — | — | M¹ | **M** | **M** | M¹ | — | — |
| Lapor **Menunggu Bahan Baku** | — | — | M | **M** | M | M | — | — |
| **Reservasi** / **serahkan bahan** | — | — | — | — | — | — | **M** | — |
| **Tutup kekurangan bahan** | — | — | — | — | — | — | **M** | — |
| **Tambah stok** (penerimaan) | — | — | — | — | — | — | **M** | — |
| **Terima retur sisa** | — | — | — | — | — | — | **M** | — |
| **Terima barang jadi** | — | — | — | — | — | — | **M** | — |
| **Putusan QC** PASS / FAIL | —² | —² | — | — | — | **M** | — | — |
| Upload & koreksi **foto dokumentasi** | — | — | M | — | — | — | — | **M** |

¹ Izin ada, tetapi server hanya menerima tahap dari **PIC yang ditugaskan** pada unit itu. ² Owner/Admin hanya dapat memakai jalur **pengecualian (WAIVE)**, tercatat — bukan PASS/FAIL biasa.

## Alur serah-terima (siapa menunggu siapa)
```
Pickup ─▶ Gudang: Penerimaan Unit ─▶ Lead: Jadwalkan ─▶ Meja: tahap 1–8
   ├─(bahan kurang)──▶ Gudang: tambah stok → serahkan → tutup kekurangan ─▶ Meja: Lanjutkan
   ├─▶ QC: PASS ─▶ Meja: tahap 9 ─▶ Corner: 10–12 ─▶ Gudang: retur sisa (bila ada) ─▶ barang jadi
   └─▶ QC: FAIL ─▶ Meja: rework ─▶ QC ulang ───────────┘
Dokumenter: melengkapi 12 kategori foto kapan saja selama produksi / siap kirim.
```
