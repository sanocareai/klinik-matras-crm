# Training Production–Warehouse (P12B) — mulai di sini

Materi ini dipakai **di lantai kerja**, bukan dibaca sekali lalu disimpan. Semua latihan dilakukan di **staging latihan** (data fiktif QA-PV2). **Production tidak disentuh.**

## Cara kerja satu sesi latihan
1. Pelatih menyiapkan staging (lihat `07-checklist-pelatih.md`): reset → `training` → terbitkan password.
2. Peserta memilih **satu peran** dan mengerjakan **runbook perannya** (maks. 2 halaman) dengan unit latihan yang sudah disiapkan.
3. Pelatih mengisi **lembar hasil simulasi** (`08-lembar-hasil-simulasi.md`): waktu, salah klik, istilah membingungkan, langkah yang butuh bantuan, bug vs masalah SOP.
4. Peserta dinilai **LULUS / PERLU PENDAMPINGAN / GAGAL-BLOCKER** memakai kriteria di bagian bawah.

## Isi folder
| Berkas | Untuk siapa |
|---|---|
| `01-runbook-admin-production-lead.md` | Owner / Admin / Production Lead |
| `02-runbook-operator-meja.md` | Operator Meja |
| `03-runbook-pic-corner.md` | PIC Corner |
| `04-runbook-qc.md` | QC |
| `05-runbook-gudang.md` | Gudang |
| `06-runbook-dokumenter.md` | Dokumenter |
| `checklist/` | satu halaman per peran — ditempel/dicetak di meja |
| `09-jika-terjadi-masalah.md` | semua peran |
| `10-matriks-siapa-melakukan-apa.md` | semua peran |
| `11-istilah.md` | semua peran |
| `07-checklist-pelatih.md`, `08-lembar-hasil-simulasi.md` | pelatih |
| `12-akses-staging-latihan.md` | pelatih / IT |

## Tujuh skenario latihan (data sudah disiapkan)
| # | Skenario | Unit | Titik mulai |
|---|---|---|---|
| S1 | Normal | U21 | pickup selesai, belum dikonfirmasi tiba |
| S2 | Ganti Kain | U22 | sudah tiba, belum dijadwalkan |
| S3 | Prioritas | U23 (Normal), U24 (Tinggi), U25 (Mendesak) | sudah tiba, belum dijadwalkan |
| S4 | Bahan kurang | U26 | Meja 1 — tinggal **Diagnosa** (tahap 5) |
| S5 | QC gagal | U27 | Meja 2 — **menunggu QC** |
| S6 | Dokumentasi offline | U28 | produksi selesai, foto baru sebagian |
| S7 | Retur sisa | U29 | tahap 12 selesai, **barang jadi tertahan** retur |

## Standar lulus (semua peran, tanpa bantuan engineer)
1. Login dan menemukan **antrean sendiri**.
2. Membuka **Unit 360** unit latihan.
3. Menyelesaikan tugas perannya pada skenario yang ditugaskan.
4. Menyebut **status berikutnya** setelah tugasnya selesai (siapa & apa yang menunggu).
5. Mengatasi **konflik / data basi** (pesan "sudah diubah orang lain", "meja penuh") tanpa panik: muat ulang → coba lagi → atau minta bantuan.
6. Tahu **kapan berhenti dan meminta bantuan** (lihat `09-jika-terjadi-masalah.md`).
7. **Keluar lalu masuk lagi** tanpa kehilangan pekerjaan.

**Nilai:** `LULUS` = 7/7 tanpa bantuan · `PERLU PENDAMPINGAN` = 5–6/7 atau butuh petunjuk 1–2 kali · `GAGAL/BLOCKER` = ≤4/7, atau ada tindakan yang berisiko data (mis. melewati QC, mengabaikan peringatan Ganti Kain).

> Aturan emas semua peran: **jangan menebak.** Kalau layar menyuruh berhenti/menunggu, berhenti dan beri tahu Production Lead.
