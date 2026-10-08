# P12D — Aplikasi Dokumentasi (mode aplikasi) — screenshot review desain

Dihasilkan dari QA browser nyata (puppeteer, klik UI) terhadap staging terisolasi QA-PV2 (data & media sintetis; bukan production), pada **image kandidat bersih** yang dibangun dari `git archive` commit `99eabd2b` (765 berkas backend + seluruh `frontend/dist` identik dengan arsip; bukan backend hasil `docker cp`). **75/75 pemeriksaan lulus.**
Viewport 390 (HP) dan 1440 (desktop); terang dan gelap. Bottom navigation: **Unit · Kamera · Draf · Akun**. Tanpa sidebar desktop.

> **Keselarasan visual dengan mockup: BELUM TERVERIFIKASI.** Mockup yang dilampirkan tidak sampai ke sesi ini (tidak ada berkas gambar di pesan maupun di repositori). Tampilan mengikuti brief tertulis (putih/off-white, navy, royal blue, dark mode setara) dan komponen Aplikasi Meja/Corner. Screenshot ini bahan review desain, bukan bukti bahwa desain sudah sesuai mockup.

| Topik | Berkas |
|---|---|
| **Antrean** (kartu foto-pertama: foto, customer, resi/unit, layanan, tahap, PIC, kelengkapan %, kekurangan) | `Q1-antrean-390-light`, `Q1-antrean-390-dark`, `Q1-antrean-1440-light`, `Q1-antrean-1440-dark` |
| **Detail** Before / Proses / After, kategori, minimum/kekurangan, thumbnail + sumber/waktu/pengunggah (foto banyak: 100+ foto satu kategori) | `Q2-detail-390-light`, `Q2-detail-390-dark`, `Q2-detail-1440-light`, `Q2-detail-1440-dark` |
| **Kamera** (tab): pilih unit → pilih kategori → sheet Ambil Foto / Galeri | `Q3-kamera-unit-*`, `Q3-kamera-kategori-*`, `Q3-kamera-sheet-*` (390/1440 × terang/gelap) |
| **Ambil Foto** dari bilah aksi detail (satu langkah) + keterangan | `Q4-kamera-sheet-390-light`, `Q4-detail-setelah-kirim-390-light` |
| **Draf** (tab): antre/menunggu sinyal, thumbnail, hitungan, lencana | `Q13-draf-390-light`, `Q13-draf-390-dark`, `Q13-draf-1440-light`, `Q13-draf-1440-dark` |
| Offline → refresh → online | `Q6-offline-sheet-390-light`, `Q6-draf-offline-390-light`, `Q6-draf-setelah-terkirim-390-light` |
| Retry (503 otomatis; ditolak 409 lalu dilanjutkan) | `Q7-draf-retry-390-light`, `Q7-ditolak-sheet-390-light` |
| Dua tab (lease/idempotensi) | `Q8-dua-tab-B-draf-390-light` |
| Koreksi beralasan + riwayat versi lama | `Q9-koreksi-sheet-390-light`, `Q9-riwayat-koreksi-390-light` |
| Read-only (Gudang: hanya UNIT_READ) | `Q10-readonly-detail-390-light`, `Q10-readonly-detail-1440-dark` |
| Perpindahan pengguna, Akun | `Q11-pindah-user-draf-390-light`, `Q11-akun-390-light` |
| Kamera/Draf 1440 gelap, hapus draf | `Q12-kamera-sheet-1440-dark`, `Q12-draf-1440-dark` |

## Yang diuji (semua lewat klik UI nyata, server = otoritas)

- Antrean: angka kartu = angka server; filter & pencarian; tanpa gulir horizontal/galat konsol di 4 kombinasi.
- Detail: segmen Before/Proses/After; jumlah/minimum/kekurangan/status kategori = kontrak server; foto banyak; kategori kosong; pratinjau besar dengan pengunggah & waktu.
- Ambil Foto (kamera) dan Galeri (multi-foto) dari bilah aksi; keterangan; geser urutan; kirim → server menambah tepat sesuai; status/tahap unit **tidak berubah** (baris unit identik sebelum/sesudah).
- Offline → refresh → online: draf tersimpan di IndexedDB (Blob), tetap ada setelah refresh, terkirim otomatis saat online, IndexedDB kosong sesudahnya.
- Retry: 503 → antre "percobaan 1/5" lalu terkirim sekali (kunci idempoten dipakai ulang); 409 → pesan jelas, draf tidak hilang, lanjut mengirim sekali.
- Dua tab: draf dibuat di tab A terlihat di tab B; online bersamaan → terkirim **tepat satu kali** (lease), tanpa draf yatim.
- Koreksi: tombol terkunci sampai alasan ≥3 huruf; versi baru aktif, versi lama tetap di riwayat (immutable) dengan alasan & pelaku.
- Read-only: tanpa bilah Ambil Foto, tambah foto, atau koreksi; Kamera memberi tahu.
- Perpindahan pengguna: draf pengguna A tidak terbaca B dan dibuang; tidak ada kiriman atas nama siapa pun; Keluar membersihkan draf; hapus draf membersihkan Blob.

## Batasan yang jujur

- Offline disimulasikan dengan membatalkan permintaan `/api` dan `/media` + `navigator.onLine=false` (service worker PWA dilewati oleh harness); cangkang offline lewat service worker tidak diuji di sini.
- Peran read-only yang diuji: Gudang. Belum diuji dengan login production nyata atau perangkat fisik (S25).
- Foto pada data staging adalah gambar uji acak, bukan foto kasur.
