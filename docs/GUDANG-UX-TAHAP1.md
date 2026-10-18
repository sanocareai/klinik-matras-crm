# UX Gudang — Tahap 1 (Beranda, Penerimaan Barang, Stok & Lokasi)

Branch `feat/gudang-ux-tahap1` (dari `feat/gudang-koreksi-input` @ `95ec678c`). **Belum di-push, belum dideploy, tidak ada penulisan data production.**
Pengujian memakai database terisolasi (`runIsolated.js`); dua PO BUSA OCEAN di production hanya dibaca (audit), tidak diubah.

## 1. Alur sebelum → sesudah

| | Sebelum | Sesudah |
|---|---|---|
| Halaman awal | "Dashboard": 8 kartu KPI + 6 panel (stok menipis, akurasi opname, dst.) — tidak jelas harus mengerjakan apa | **Beranda**: 5 kartu "yang perlu dikerjakan hari ini" (barang akan datang · jadwal jatuh tempo · belum masuk stok · permintaan bahan · selisih/koreksi menunggu). Angka & contoh dihitung server dari dokumen nyata; tiap kartu membuka daftar yang relevan |
| Menu | 4 grup berdasarkan jenis dokumen; PO dan penerimaan terpisah tanpa penjelasan | 6 grup menurut alur kerja: HARI INI · PENERIMAAN BARANG · STOK · UNTUK PRODUKSI · KONTROL & BIAYA · LAPORAN. Semua rute lama tetap hidup |
| Penerimaan (daftar) | Tabel + drawer dengan modal bertumpuk | Daftar dengan identitas (no. penerimaan, no. PO, supplier, jadwal, pembuat, tanggal), filter tahap, kartu di layar sempit; detail = **halaman** |
| Penerimaan (detail) | Drawer panjang; banyak tombol sekaligus | Halaman: identitas → alur 5 langkah → tabel per item (pesan · dijadwalkan · tiba · diterima · masuk stok · sisa PO) → hanya aksi yang relevan untuk status |
| Dokumen uji hanya Terjadwal | Tidak bisa diubah jadwal / dikembalikan / dibatalkan dari UI | Ubah jadwal, **Kembali ke Draf**, **Batalkan penerimaan** (alasan wajib), jejak ringan, dijaga server |
| Setelah masuk stok | Kartu koreksi di setiap layar | Satu aksi **Koreksi**: PO → *Koreksi Kedatangan* resmi; non-PO → koreksi bertaut (branch koreksi). Kartu koreksi dilipat ("ringkas") bila tidak relevan |
| Stok & Lokasi | Angka "Stok habis 244", "0 perlu reorder", "akurasi 0,0%" tanpa penjelasan | Keadaan dibedakan (ada / menipis / nol menurut pergerakan / minus / **belum ada catatan**), batas minimum "belum diatur" ≠ 0, sumber angka per baris, lokasi = lokasi penerimaan terakhir |

## 2. Matriks aksi yang benar-benar bekerja per status

Sumber tunggal: `backend/src/services/penerimaanStatus.js` (`tampilan.aksi`, dikirim API; UI tidak menebak status).

| Status (label petugas) | Pengaruh stok | Aksi tampil | Bekerja via |
|---|---|---|---|
| DRAFT — Draf | Belum | Ubah jadwal · Jadwalkan · Batalkan penerimaan | PATCH `expectedDate`/status · POST `/:id/batalkan-jadwal` |
| SCHEDULED — Terjadwal, menunggu barang tiba | Belum | Ubah jadwal · Catat barang tiba (PO) / Tandai tiba (non-PO) · Kembali ke Draf · Batalkan | PATCH · modal Catat Kedatangan (existing) · POST `/:id/kembali-draft` · POST `/:id/batalkan-jadwal` |
| ARRIVED — Barang tiba, perlu diperiksa | Belum | Isi hasil pemeriksaan · Lanjut · (PO) Koreksi Kedatangan · Tolak | PATCH baris · PATCH status · modal koreksi resmi · reject |
| INSPECTION — Sedang diperiksa | Belum | sama dengan ARRIVED | idem |
| READY_FOR_PUTAWAY — Siap masuk stok | Belum | **Simpan ke Stok** · Isi pemeriksaan · (PO) Koreksi Kedatangan · Tolak | putaway (satu-satunya penulisan ledger) |
| COMPLETED — Sudah masuk stok | Sudah | **Koreksi** saja: PO → Koreksi Kedatangan (resmi); non-PO → Koreksi penerimaan (bertaut) | `ModalKoreksiKedatangan` · `KoreksiPenerimaanModal` |
| REJECTED tanpa pernah berisi — Dibatalkan | Tidak | (tidak ada) | — |
| REJECTED setelah barang tiba — Ditolak | Tidak | (tidak ada) | — |

Penjagaan server untuk Batalkan/Kembali ke Draf (409 dengan penyebab dan langkah): sudah ada pergerakan stok · barang sudah dicatat tiba · sudah ada jumlah. Tidak ada tombol Edit/Undo/Hapus umum; setelah posting tidak ada jalur yang menyiratkan catatan dihapus.

## 3. Kasus BUSA OCEAN (dua PO berbeda)

Audit read-only production: **satu PO Ocean + dua penerimaan Terjadwal**, tidak ada PO Draf (PO draf uji tidak ada di production saat audit). Dua penerimaan Terjadwal ≠ bukti barang tiba; stok tidak terpengaruh. UI menampilkan nomor PO, nomor penerimaan, pembuat, dan tanggal masing-masing; peringatan "penerimaan lain untuk PO yang sama" hanya informasi, bukan kesimpulan duplikat. Skenario uji terisolasi (dua PO Ocean berbeda): Draf → Terjadwal → Draf, ubah jadwal, batalkan, dan koreksi setelah posting — lihat `backend/tests/integration/gudangUx.integration.test.js`.

## 4. Audit angka Stok (read-only production)

* **373 vs 358**: 373 = terdaftar, 358 = aktif (15 nonaktif). Ringkasan kini menyebut keduanya.
* **244 "stok habis"** = 223 belum pernah punya pergerakan (*belum diketahui*, bukan habis) + 21 saldo minus; yang benar-benar nol menurut pergerakan = 0. Sekarang dipisah.
* **"0 perlu reorder"**: batas minimum belum diatur untuk semua bahan → sistem menyatakan "belum bisa menyimpulkan", bukan 0.
* **"Akurasi 0,0%"**: artefak hitungan BASELINE (saldo pembuka) → dikecualikan; sampel < 30 diberi penanda `sampelCukup=false`.

## 5. Cakupan

Tahap 1 selesai: Beranda, Barang Akan Datang (daftar dokumen penerimaan + tautan + alur), Penerimaan Barang (daftar + detail), Stok & Lokasi, navigasi, judul tab/breadcrumb, kartu koreksi ringkas di drawer lain.

## 6. Perlu Tahap 2

* Pengeluaran Material, Transfer Stok, Stock Opname, Restok, Barang Rusak & Retur masih memakai drawer lama (hanya kartu koreksi dilipat). Perlu halaman detail + matriks aksi seperti Penerimaan.
* `GoodsReceiptDetailDrawer.jsx` dipertahankan (tidak dipakai daftar baru) karena 7 tes kontrak lama masih membaca teksnya; hapus setelah tes dimigrasi ke `PenerimaanDetail.jsx`.
* Saldo **per lokasi** tidak ada di database (hanya lokasi penerimaan terakhir) — butuh keputusan desain data.
* Batas minimum belum diatur untuk semua bahan — keputusan Owner/Gudang; sampai itu "perlu reorder" tidak dapat dihitung.
* Koreksi GR-PO untuk bahan/lokasi dan transaksi lanjutan: tetap panduan (batas ditampilkan dengan langkah), belum dikerjakan otomatis.

## 7. Celah yang masih berupa panduan (bukan aksi otomatis)

* Koreksi bahan/lokasi pada penerimaan dari PO → panduan + Koreksi Kedatangan resmi (jumlah/tanggal); ganti bahan tetap lewat retur/koreksi Finance.
* Koreksi saat ada transaksi lanjutan (stok sudah dipakai/dipindah/dihitung) → penyebab dan langkah penyelesaian ditampilkan; tidak dipaksa.
* Aksi `Lanjut`/`Tandai tiba` pada dokumen non-PO tetap memakai alur lama.

## 8. Integrasi dengan branch koreksi

* Branch ini dibangun **di atas** `95ec678c` — tidak membuat sistem koreksi kedua. `warehouse_corrections`, `KartuJalurKoreksi`, `KoreksiPenerimaanModal`, `jalurDokumen` dipakai apa adanya; satu-satunya perubahan di file koreksi: prop `ringkas` pada `KartuJalurKoreksi` (aditif).
* Urutan rilis yang disarankan: (1) rilis koreksi (`95ec678c`, migration `20261220090000`) → (2) rilis UX Tahap 1 (code-only, tanpa migration baru). Bila UX dirilis sebelum koreksi, tombol Koreksi non-PO tidak boleh tampil — branch ini tidak bisa dirilis terpisah tanpa koreksi karena memuatnya.
* Migration berurutan: live 258 → Produksi `20261219090000` → koreksi `20261220090000`. Tahap 1 tidak menambah migration.
* Rilis kedua wajib merge live + ulang gerbang (kesepakatan dengan sesi Produksi).

## 9. Risiko rilis

* Menu dipindah-pindah: pengguna harus diberi tahu (rute tidak berubah, bookmark aman).
* Detail penerimaan pindah dari drawer ke halaman: tautan lama `?buka=<id>` dialihkan otomatis.
* Endpoint baru `/inventory/beranda` baca-saja dan dua aksi baru (kembali ke Draf, batalkan jadwal) menulis hanya status header + jejak; stok/Finance/Produksi tidak tersentuh (diuji).
* Tes frontend lain gagal di lingkungan ini (exceljs tidak terpasang di node_modules bersama; tes Produksi/driver) — tidak terkait perubahan ini.
* Belum diuji dengan perangkat fisik dan pengguna nyata; uji layar sempit baru berupa kontrak struktur (kelas responsif, target sentuh 44px), bukan screenshot.

## 10. Penutupan bukti (17 Okt 2026)

* **Pemulihan dokumen** (tanpa menghapus jejak, tanpa pergerakan stok): `POST /goods-receipts/:id/batalkan-tiba` (salah klik Barang tiba → kembali Terjadwal; syarat: belum ada hasil pemeriksaan, stok, faktur, retur, pengganti; catatan lama tersimpan utuh di jejak), `/pulihkan` (Dibatalkan yang tak pernah berisi → Draf), `/buat-ulang` (Ditolak/Dibatalkan → dokumen BARU Draf, kedua dokumen saling tertaut; aman diulang). Jejak tampil di halaman detail.
* **Stok & Lokasi:** kolom "Riwayat penerimaan" (bukan lokasi stok saat ini); saldo belum diketahui / 0 habis / minus tampil berbeda.
* **exceljs:** ada di `package.json` dan lockfile, tetapi `node_modules` bersama dipasang 22 Sep (sebelum exceljs ditambahkan) → modul tak ditemukan. Bukan regresi kode. Lockfile menunjuk mirror `mirrors.tencentyun.com` yang tak terjangkau; pemasangan terisolasi memakai salinan lockfile yang di-rewrite ke registry.npmjs.org (repo tidak diubah).
* **Tes kandidat vs baseline** (checkout LF): baseline `95ec678c` 1096/1097 lulus, kandidat 1110/1111; satu-satunya kegagalan sama di keduanya (`penjualanKaryawanManualUi`: regex `createPenjualanKaryawan({date: f.date…` tak cocok dengan `bodyLengkap()` — perubahan Finance lama). 9 kegagalan lain di checkout CRLF adalah artefak akhir baris (tes membaca sumber dengan `\n`), hilang di checkout LF.
* **Build penuh** (`vite build`, exceljs ter-resolve): sukses.
* **QA visual** 390 px dan 1440 px pada server lokal terisolasi (DB `km_qa_gudang_ux_test`): temuan yang diperbaiki — judul tab "Inventory"/"Goods Receipt" → "Stok & Lokasi"/"Penerimaan Barang"; nomor GR, nama bahan, badge status terpotong; aksi detail terkubur di bawah tabel (HP) → kartu aksi tepat di bawah identitas; ringkasan Stok mendorong daftar ke bawah → terlipat + pencarian di atas; padding ganda kartu daftar (p-6) dan bullet bawaan di HP; tab filter 3 baris → satu baris geser. Belum diperbaiki (bukan lingkup): matriks 13 angka per item di modal PO (`PanelKedatangan`, dipakai bersama Finance) panjang di HP.

## 11. Kandidat final (18 Okt 2026) — di atas live Koreksi Gudang 08d62e7d

* Baseline live: `08d62e7d713b08fc9e0f1d898c37791352476b5b` (Koreksi Gudang). `origin/main` belum memuatnya; kandidat ini menggabungkan `origin/feat/gudang-koreksi-input-on-live` (08d62e7d + perbaikan smoke 31f77a28). Migrasi `20261220090000_gudang_koreksi_dokumen` sudah terpasang di produksi; **UX Tahap 1 tidak membawa migrasi** (pohon `backend/prisma` identik dengan live, 260 migrasi).
* Rilis: `node scripts/gen-release-ux-gudang-tahap1.cjs --base 08d62e7d [--check]` → `scripts/release-ux-gudang-tahap1.sh` (--preflight-only baca-saja). Gerbang: ancestry live, allowlist, tanpa prisma/dependensi, berkas pelindung (inti Koreksi, jurnal, izin, Stock Count, Produksi override) identik, terpasang == kandidat (0 pending), sidik jari beku, backup, build web + image, kode baru terhadap restore backup nyata (sidik jari semua tabel sebelum = sesudah), switch, smoke baca-saja. Rollback = tag image `rollback-pre-uxg-<sha8>`, tanpa perubahan database.
* Panel PO ringkas (HP, hanya Gudang): pengiriman (nomor GR + aksi utama) tampil di atas daftar item; tiap item memuat empat sel Pesan · Tiba · Belum datang · Masuk stok dan "Dijadwalkan: GR-… n · GR-… n" (per dokumen, tidak dijumlahkan); rincian lengkap dilipat; Finance tetap tampilan penuh (`ringkas` default false).
* Izin: server menyembunyikan aksi (`tampilan.aksi = []`, `izin.tulis=false`) untuk akun tanpa izin tulis Inventory; server tetap menolak 403.
* QA browser interaktif (Chrome, 390 px dan 1440 px, DB terisolasi): 94 pemeriksaan lulus — Draf→Terjadwal→Draf, ubah jadwal, catat tiba→batalkan catatan tiba, batalkan→pulihkan, tolak→buat penerimaan baru tertaut, sudah masuk stok→Koreksi (resmi/bertaut), izin hanya-lihat, panel PO banyak item; setiap aksi diverifikasi setelah refresh (status, jejak, klik ganda = satu efek, tanpa pergerakan stok sebelum posting).
