# Redesain Pesanan Pembelian (PO) — Finance → Pembelian & Supplier

Tahap 1 (1 Nov 2026): daftar PO, editor PO lebar, Rincian PO. **UI saja.** Tidak ada perubahan endpoint, schema, jurnal, stok, Harga Berlaku, aturan persetujuan, atau proses bisnis.
Dasar: live `dca5ab7d` (diverifikasi di VPS 1 Nov 2026; `925cd796` dan `6e03a1c6` adalah leluhurnya).

## Berkas

| Berkas | Peran |
|---|---|
| `frontend/src/pages/finance/FinancePurchaseOrders.jsx` | Halaman (state daftar, saringan, pemuatan, pesan). Dulu 1262 baris; kini perakit. |
| `frontend/src/features/finance/po/poTampilan.js` | Logika tampilan murni (KPI, ringkasan penerimaan, izin, aksi per status, teks dampak Harga Berlaku). |
| `frontend/src/features/finance/po/DaftarPO.jsx` | Strip alur, KPI, toolbar, daftar. |
| `frontend/src/features/finance/po/EditorPO.jsx` | Editor lebar (item, pemilih bahan, rincian baris, footer, strip Harga Berlaku). |
| `frontend/src/features/finance/po/BarangBaruPO.jsx` | "Buat Barang Baru" + panel masalah barang mirip — **dipindah apa adanya**. |
| `frontend/src/features/finance/po/RincianPO.jsx` | Rincian, faktur, dialog (batal/revisi/faktur) — dialog **dipindah apa adanya**, hanya kerangka Rincian yang baru. |
| `frontend/src/components/financeIconsPO.jsx` | Ikon duotone PO. |
| `frontend/src/styles/sanss-finance-po.css` | Gaya, dikunci ke `.fin-po` / `.fin-poed` / `.fin-pod`; diimpor dari halaman (chunk lazy), bukan `main.jsx`. |
| `frontend/src/lib/financeHubs.js` | Hanya label menu PO → "Pesanan (PO)". Rute dan tujuan lain tidak berubah. |

## Perilaku PO (dari kode)

**Status**: `DRAFT → DISETUJUI → DITERIMA_SEBAGIAN → SELESAI`, atau `DIBATALKAN`. `DITERIMA_SEBAGIAN`/`SELESAI` diturunkan server dari jumlah *diterima baik* (`hitungUlangStatus`); tidak ada tombol manual.

| Tindakan | Syarat status | Izin server | Catatan |
|---|---|---|---|
| Buat / Ubah draf | — / `DRAFT` | `finance:post` | Barang baru dari PO: `finance:admin` |
| Setujui | `DRAFT` | `finance:approve` | Validasi ulang isi; **tidak** menulis harga |
| Batalkan | `DRAFT` (post) · `DISETUJUI` (admin) | — | `DITERIMA_SEBAGIAN`/`SELESAI` tidak bisa dibatalkan (sudah ada stok) |
| Revisi jumlah | `DISETUJUI`, `DITERIMA_SEBAGIAN` | `finance:approve` | Tidak boleh di bawah jumlah diterima baik; harga tidak berubah |
| Catat faktur | `DISETUJUI`+ | `finance:post` | Faktur & pembayaran tidak menambah stok |

Peran: FINANCE = read+post+approve · ACCOUNTANT = read+post · APPROVER = read+approve · ADMIN/OWNER = semua + admin.

**Rantai dokumen**: PO (komitmen, tanpa stok/jurnal) → Catat Barang Tiba (penerimaan sendiri per pengiriman, belum menambah stok) → Gudang memeriksa baik/ditolak → **Simpan ke Stok** (satu-satunya yang menambah stok + jurnal) → Faktur supplier (dicocokkan per baris dengan barang baik yang belum ditagih; disetujui = utang) → Pembayaran. Lima angka berbeda dan tidak boleh disamakan: *dipesan*, *sudah datang* (fisik, termasuk yang ditolak), *ditolak/diterima baik*, *masuk stok*, *ditagih*. Retur supplier mengurangi "diterima bersih", bukan "masuk stok" bruto.

**Satuan**: baris PO memakai satuan beli; bila ≠ satuan stok material wajib faktor (maks 4 desimal; jumlah × faktor maks 4 desimal; harga per satuan stok ≥ Rp1). Server tidak menjumlah lintas satuan — `ringkasProgresPO` hanya menjumlah bila semua baris satu satuan; selain itu "n/m baris masuk stok".

## Harga Berlaku — temuan aktual (`services/finance/hargaDariPO.js`)

- **Kapan**: saat PO **berhasil disimpan** — draf baru (`DIBUAT`) **dan** ubah draf (`DIUBAH`), satu transaksi dengan PO-nya. **Draf juga memengaruhi harga.** Menyetujui TIDAK menulis harga; membatalkan tidak mengembalikan harga.
- **Baris yang menulis**: hanya yang harga/satuan/faktornya *berubah* dibanding baris tersimpan (`barisSama`). Mengubah jumlah saja, memindah supplier, atau menyimpan ulang isi sama tidak menulis. Harga = harga sekarang ⇒ tidak ada baris baru.
- **Tanggal & riwayat**: efektif "saat disimpan" (tanpa tanggal mundur); tersimpan di `MaterialHargaBerlaku` dengan sumber `{poId, poNumber, barisPO, revisi, aksi, pelaku}` dan kunci idempoten `po-harga:<poId>:<bahan>:r<revisi>`.
- **Satuan**: ditulis per *satuan stok*; konversi tanpa faktor sah, atau bahan sama dengan harga berbeda di dua baris ⇒ PO **tidak tersimpan** (galat bernomor baris, HTTP 422). Hasil bagi >4 desimal dibulatkan dan diberitahukan.
- **Pemakai harga ini**: HPP operasional — Biaya Bahan per Unit, pemakaian bahan Gudang/Produksi (dibekukan saat pemakaian diposting), Laporan Produksi, kelengkapan Order Produksi, pembetulan bahan unit. **Bukan** nilai persediaan/jurnal Finance.
- **Saklar**: `HARGA_DARI_PO=0` mematikan seluruhnya (UI membaca `aktif:false` dari pratinjau).

Teks di editor mengikuti ini: "Saat PO disimpan (termasuk sebagai draf), harga bahan yang berubah langsung menjadi Harga Berlaku operasional" + daftar rinci di "Lihat dampak". Kalimat lama "Disimpan sebagai draf … menyimpan PO tidak mengubah stok" tetap benar tetapi tidak lengkap; tidak lagi dipakai sebagai satu-satunya penjelasan.

## Keputusan desain

- KPI: rumus & populasi lama dipertahankan (dihitung dari daftar yang dimuat, ikut tab & pencarian; maks 300 PO terbaru). Kini ada keterangan cakupan di bawah KPI. "Nilai belum masuk stok" disebut **estimasi** (sisa jumlah × harga PO), eksplisit bukan utang/uang keluar.
- Penerimaan di daftar: satu satuan → "98,25 / 224,79 kg masuk stok" + "tiba 130,5 · ditolak 2,25"; satuan campuran → "2 dari 4 baris masuk stok penuh" + satu segmen per baris, tanpa persentase kuantitas gabungan.
- Rincian: angka per item = Dipesan · Sudah datang · Masuk stok · Belum masuk stok · Nilai; definisi lengkap (belum datang, menunggu pengganti, diretur, diterima bersih, ditagih) di "Rincian" tiap item dan di legenda server. Status pesanan, barang, faktur, utang, pembayaran tetap kartu terpisah (`StatusEmpatPO`).
- Izin: tombol yang tidak boleh dipakai peran tetap tampil **nonaktif dengan alasan** (dibaca pembaca layar), tidak hilang diam-diam. Server tetap penentu akhir.
- Editor: pemilih bahan = combobox (ARIA, panah/Enter/Esc), arah buka mengikuti ruang di area gulir editor, bahan yang sudah di baris lain nonaktif. Satuan di kolom adalah **teks baca-saja** (mengikuti material); mengganti satuan beli + faktor ada di "Rincian baris".

## Tidak dibuat (dan alasannya)

- Pagination/sorting dari mockup: API hanya `take 300` terbaru tanpa sorting/halaman.
- Dropdown Supplier & "Status penerimaan" dari mockup: server tidak punya filter status penerimaan; supplier sudah dicari lewat kolom pencarian.
- Pajak/diskon/ongkir/termin baru/field baru: tidak ada di sistem.

## Temuan di luar lingkup UI (tidak diubah)

1. `daftarPO` memanggil `bentukPO` berurutan untuk sampai 300 PO (N+1: tiap PO menjalankan query kuantitas, progres, dan retur sendiri) — berpotensi lambat saat PO bertambah. Perlu agregat set-based bila daftar membesar.
2. KPI dihitung di klien dari daftar yang dimuat, bukan agregat server; di atas 300 PO angka KPI bisa lebih kecil dari kenyataan (kini diberi keterangan cakupan).
3. Membatalkan **draf** yang pernah disimpan meninggalkan Harga Berlaku hasil simpan itu (tidak dikembalikan). Dialog batal sudah menyatakannya; perilakunya kebijakan Owner, bukan bug UI.

## Pengujian

- `tests/poRedesignLogika.test.js` (14): KPI, penerimaan satu-satuan vs campuran, izin per peran/status, payload & subtotal sama dengan perilaku lama, validasi, kalimat dampak Harga Berlaku.
- Tes pemasangan lama diarahkan ke sumber gabungan (`tests/_poSumber.js`); asersi yang mengunci struktur lama (10 kolom, `<ModalPO>`) diganti dengan padanan perilakunya.
- QA browser terisolasi (DB `km_po_redesign` lokal): peran, keyboard, keadaan gagal/kosong, kontras terang/gelap, payload POST identik dengan kontrak lama.
