# Laporan Produksi Terpadu (KPI & Laporan → 4 tab)

Menggantikan halaman "KPI & Laporan" (`/bengkel/kpi`, `/warehouse/kpi`). Baca-saja; satu-satunya aksi tulis adalah **Pengaturan target** (komponen `TargetPanel` yang sudah ada, izin `production_target:write`).

## Empat tab
| Tab | Isi | Izin server |
|---|---|---|
| Ringkasan | 6 kartu + 2 grafik + daftar tindakan | `production_report:read` |
| Biaya per Order | HPP Bahan operasional per order, status Lengkap/Parsial/Belum diketahui, rincian bahan | `production_report:read` **atau** `finance:read` |
| Kinerja Produksi | Per Meja / Per PIC (Meja, Corner), rencana vs aktual | `production_report:read` |
| Bahan & Gudang | Permintaan bahan, kelengkapan pencatatan, pemakaian per bahan | `production_report:warehouse` (atau read) |

Nominal (Rp: HPP, harga, subtotal, susut, nilai per bahan) **hanya** untuk pemegang `finance:read`; bagi yang lain server mengirim `null` dan kolom Rp dibuang dari Excel (`sensitif`). Sales/Driver: 403.

## Cakupan data (audit batas laporan lama)
Laporan lama (`/production-v2/reports/*`) hanya membaca unit dalam kohort pembaca V2 (flag `production_v2_reader`, di production hanya unit ber-rencana). Laporan baru membaca **semua unit non-batal**: dikerjakan langsung (Order Produksi), historis, atau di luar rencana V2. Endpoint lama tetap ada untuk "Ringkasan Saya" (PIC/dokumentasi/QC).

## Definisi dan dasar tanggal (hari kalender WIB)
- **Order / unit / baris pemakaian** dihitung terpisah. Order dikerjakan = order dengan pemakaian bahan pada periode ATAU unit yang diserahkan sebagai barang jadi pada periode. Opsi lanjutan "sertakan order yang masuk" menambah order yang unitnya dibuat pada periode tanpa aktivitas bahan.
- **HPP Bahan diketahui** = Σ nilai pemakaian − pengembalian ± koreksi yang **sudah dibekukan** dengan harga berlaku resmi (`stock_movement_biaya_operasional`, status `DINILAI`, baris terakhir). Susut dan SANO GUARD tidak ikut. Pemakaian lama **tidak** dihitung ulang dengan harga master terbaru.
- **Tanggal pemakaian** (dasar metrik biaya): tanggal yang dilaporkan pada pembetulan (`[dilaporkan YYYY-MM-DD]`) > tanggal pemakaian catatan historis tertaut > hari pencatatan. Waktu pencatatan tetap ditampilkan terpisah di rincian.
- **Status biaya**: Lengkap = tanpa masalah dan ada nilai dibekukan (atau semua unit dinyatakan tanpa bahan baru); Parsial = ada nilai tetapi masih ada masalah; Belum diketahui = belum ada nilai dibekukan. Nilai kosong ≠ Rp 0.
- **Masalah** (bisa ditindaklanjuti): pemakaian belum dibekukan / tanpa harga / pembekuan gagal; catatan historis tertahan (PERLU_DICEK/SIAP_POSTING); unit dinilai tanpa pemakaian; pemakaian sementara belum direkonsiliasi; SANO GUARD. Pemakaian = menurut tanggal pemakaian dalam periode; catatan/unit = posisi saat ini (sumber klasifikasi yang sama dengan filter Kelengkapan Order Produksi).
- **Unit selesai produksi** = waktu produksi menyerahkan barang jadi ke Gudang (custody `FINISHED_GOODS`). Setiap unit dihitung sekali. Meja/PIC = penetapan terakhir pada rencana/jadwal; tanpa penetapan → "Tidak tercatat" (Σ baris = total).
- **Durasi produksi** hanya bila mulai produksi dan serah barang jadi sama-sama tercatat; n < 3 → "data belum cukup". **Target historis** dan **QC** tampil "belum tersedia" bila tidak ada data (target bawaan sistem tidak dipakai sebagai pembanding).
- **Rencana terisi** = unit terjadwal ÷ (kapasitas per meja per hari × hari berjadwal). Rencana ≠ pekerjaan aktual; tidak ada skor performa.

## SANO GUARD
Bahan produksi internal. Hubungan biaya perakitannya ke bahan penyusun belum tersedia di sistem; menjumlahkan keduanya berisiko hitung ganda. Nilainya **tidak** dijumlahkan sebagai biaya terbukti: baris ditandai "SANO GUARD · tidak dihitung", order berstatus Parsial, detail menjelaskan risikonya.

## Keterbatasan data production yang diketahui (diukur pada restore 29 Okt 2026)
- Belum ada pemakaian dengan harga beku (0 baris `DINILAI`; 268 dari 270 pergerakan belum dibekukan) → semua order tampil "Belum diketahui" sampai penerapan harga dilakukan (Stok → Harga Berlaku → Penerapan).
- Belum ada unit dengan waktu serah barang jadi → "Unit selesai" = 0 pada semua periode; 658 unit Siap Kirim/Terkirim disebut sebagai "tanpa waktu serah tercatat".
- PIC hanya ada pada 3 rencana V2; selebihnya "Tidak tercatat".

## Endpoint
`GET /api/production-v2/laporan/{meta,ringkasan,biaya-order,biaya-order/:orderId,kinerja,bahan-gudang,export}` — periode `from`/`to` (YYYY-MM-DD WIB), filter `q,status,masalah,urut,termasukMasuk,peran`, paginasi `page,pageSize`. Ringkasan/ekspor memakai fungsi data yang sama (layar = grafik = tabel = Excel).
