# Koreksi Penerimaan (Okt 2026)

Branch `feat/koreksi-penerimaan`, dibuat dari lineage live `8dc95ee4` (release aktif saat dikerjakan). **Satu pintu koreksi**: `koreksiKedatangan` (`services/finance/kedatangan.js`) — dipanggil route Gudang (`POST /api/inventory/barang-akan-datang/penerimaan/:id/koreksi`) dan Finance (`POST /api/finance/purchase-orders/penerimaan/:id/koreksi-kedatangan`). Tidak ada endpoint/dialog koreksi kedua; sesudah Simpan ke Stok, mekanisme pembalik + pengganti (`koreksiPenerimaan.js`) dipanggil DARI pintu yang sama.

## Yang bisa dikoreksi, per tahap

| Bidang | Tiba (belum diperiksa) | Diperiksa / Siap disimpan | Sudah masuk stok |
|---|---|---|---|
| Tanggal tiba | ya¹ | ya¹ | ya¹ |
| PIC, catatan, surat jalan, bukti | ya | ya | ya |
| Jumlah datang (KG) | ya | ya (≥ baik + ditolak) | ya (tanpa efek stok) |
| Jumlah baik / ditolak | — (belum ada: isi lewat pemeriksaan) | ya (satu transaksi) | ditolak: ya; **baik: pembalik + pengganti, bila terbukti aman** |
| Lembar (pendamping aktual) | ya | ya | ya (tanpa efek stok/jurnal) |
| Kaitan pengganti | ya | ya | ya |

¹ Menggeser jatuh tempo faktur **belum disetujui** (dihitung ulang, terlihat di pratinjau). Bila baris penerimaan sudah diklaim faktur DISETUJUI → diblokir `TERMIN_TERKUNCI`.

Wajib: alasan (≥ 5 karakter), `Idempotency-Key` untuk penerapan, revisi yang dilihat pengguna (kunci optimistis). Riwayat append-only `goods_receipt_events` memuat sebelum–sesudah per bidang, jalur, nomor pergerakan stok, dan nomor jurnal koreksi.

## Pratinjau dampak (server)

Body yang sama + `pratinjau: true` (tanpa Idempotency-Key). Server menjalankan koreksi PENUH di transaksi lalu membatalkannya, sehingga angka identik dengan penerapan: progres PO sebelum→sesudah per baris, jatuh tempo faktur atas PO, stok (jumlah baik/selisih), status PO, dan — hanya Finance — jurnal koreksi. Gudang tidak menerima nilai rupiah. Koreksi yang diblokir dikembalikan sebagai `{ boleh:false, blokir:[{kode,pesan,arah}] }`. UI mewajibkan "Lihat Dampak" untuk isian yang sama sebelum Simpan.

## Sesudah Simpan ke Stok: pembalik + pengganti

Catatan lama tidak diubah. Untuk koreksi jumlah baik: pergerakan `RECEIPT` **pembalik** (qty negatif, harga sama) + `RECEIPT` **pengganti** (qty baru), keduanya bertaut penerimaan + catatan; SATU jurnal koreksi selisih (Dr/Cr Persediaan ↔ Utang Barang Belum Ditagih, tanggal hari ini, kunci `PENERIMAAN_BAHAN:{id}:KOREKSI:{revisi}`). Jurnal penerimaan asli tetap POSTED. `dasarHargaRataRata` mengurangkan pembalik dari baris penerimaan yang sama. Status PO dihitung ulang (Selesai ↔ Diterima Sebagian).

### Diblokir (sebab + arah tindakan pada pesan)

| Kode | Sebab | Arah |
|---|---|---|
| `RETUR_AKTIF` | Retur Supplier draf/keluar/selesai pada baris (kontrak Retur; trigger DB pagar terakhir) | Batalkan retur dulu (Gudang) |
| `FAKTUR_DISETUJUI` | Jumlah baik sudah diklaim faktur disetujui | Finance: batalkan faktur (+ pembayaran), koreksi, catat ulang |
| `TAGIHAN_LAMA` | Tagihan lama aktif menutup penerimaan | Batalkan/koreksi tagihan lebih dulu |
| `STOK_SUDAH_BERGERAK` | Bahan sudah dipakai/bergerak sejak disimpan (rata-rata tertimbang tanpa lot → asal stok tak pasti) | Koreksi stok (opname/penyesuaian) oleh Gudang. Retur Supplier per penerimaan (`SUPPLIER_RETURN`) bukan pemakaian dari kolam stok dan tidak ikut dihitung |
| `TERMIN_TERKUNCI` | Tanggal tiba menggeser jatuh tempo faktur disetujui | Batalkan faktur, koreksi tanggal, catat ulang |
| `PERIODE_TERTUTUP` | Periode pembukuan hari ini tertutup (koreksi dibukukan hari ini) | Buka periode di Finance › Pengaturan |
| `STOK_TIDAK_CUKUP` / `STOK_DIRESERVASI` | Stok tersedia tidak cukup untuk pengurangan | Selesaikan reservasi / penyesuaian stok |
| `MELEBIHI_PO` / `MELEBIHI_PENOLAKAN` | Melampaui sisa PO / sisa penolakan | Kurangi, atau Finance revisi jumlah PO |
| `PENERIMAAN_BELUM_DIBUKUKAN` / `HARGA_TIDAK_ADA` / `LEDGER_TIDAK_SINKRON` | Dasar nilai/ledger tidak lengkap | Lengkapi pembukuan/harga; penyesuaian stok |
| `BELUM_DIPERIKSA` | Baik/ditolak diisi sebelum pemeriksaan | Isi lewat Penerimaan Barang |
| `KAITAN_TIDAK_VALID` / `DI_BAWAH_PENGGANTI` | Kaitan pengganti tidak masuk akal | Pilih penolakan yang benar / koreksi pengganti dulu |

Faktur disetujui, pembayaran, dan periode tertutup **tidak pernah diubah diam-diam**.

## Urutan kunci & paralel

penerimaan → PO → material (di dalam `postStockMovement`). Retur Supplier: retur → PO → material; kedua alur serial di kunci PO. Dua koreksi serentak pada revisi sama → satu menang, yang lain `REVISI_USANG`; replay kunci sama = hasil sama.

## Kontrak dengan Retur Supplier

`pastikanTanpaReturAktifJikaAda` memanggil `pastikanTanpaReturAktif()` (returSupplier.js) sebelum koreksi kuantitas; tidak berbuat apa pun bila fitur Retur belum terpasang. Tes lintas fitur: `koreksiPenerimaan.integration.test.js` › "RETUR AKTIF" (di-skip tanpa Retur; berjalan di kandidat gabungan).

Aturan interaksi (diuji di `koreksiRetur.integration.test.js`):

- **Penolakan** membawa sebab dan arah: `409 RETUR_AKTIF` + "Batalkan Retur Supplier itu (Gudang → Retur Supplier → Batalkan) lalu ulangi koreksi". Setelah retur dibatalkan, koreksi boleh.
- **Trigger DB** `trg_goods_receipt_line_terkunci_retur` aktif untuk kolom yang tercantum di SET walau nilainya sama — karena itu koreksi hanya menulis kolom yang BERUBAH. Koreksi lembar/kaitan pengganti pada baris yang punya retur tetap lolos.
- **Rata-rata harga** (`dasarHargaRataRata`): pembalik koreksi dikurangkan dari RECEIPT positif penerimaan yang sama lebih dulu, baru retur (`SUPPLIER_RETURN`); baris pembalik (qty negatif) tidak pernah ikut dikurangi retur.
- **Kapasitas retur** memakai jumlah baik SESUDAH koreksi (koreksi 6→5 lalu retur 2 → diterima bersih 3). Selama ada retur aktif jumlah baik tidak bisa diubah sama sekali, jadi tidak ada koreksi yang menembus jumlah yang sudah diretur.
- **Urutan kunci**: koreksi = penerimaan → PO → material; retur = retur → PO → material; keduanya serial di kunci PO. Balapan koreksi vs retur pada baris yang sama: apa pun pemenangnya, stok = baik − diretur dan persediaan = stok × harga.

## Perubahan perilaku (disengaja)

- Jumlah datang kini bisa dikoreksi sampai Siap Disimpan (sebelumnya terkunci setelah pemeriksaan).
- Koreksi tanggal yang menggeser jatuh tempo faktur disetujui kini diblokir (sebelumnya jatuh tempo faktur disetujui ikut bergeser tanpa pemberitahuan).
- Tes lama `poTerintegrasi` yang memuat dua perilaku itu diperbarui.

## Keterbatasan

- Koreksi jumlah baik sesudah stok hanya untuk bahan yang belum bergerak; selebihnya lewat opname/penyesuaian.
- Penerimaan dengan dua baris bahan sama tidak bisa dikoreksi per baris sesudah stok (`BARIS_GANDA_BAHAN`).
- Pratinjau memegang kunci baris selama satu transaksi singkat.
