# D-180 — Finance Workspace (buku besar double-entry)

**Tanggal:** 17 September 2026
**Cakupan:** workspace ke-6 (`/finance/*`), 19 tabel `fin_*`, mesin posting
otomatis dari transaksi operasional yang SUDAH ADA, dan 4 laporan keuangan baku.

---

## 1. Masalah yang diselesaikan

Sebelum ini sistem punya SEMUA transaksi nyata (Order, Invoice, Payment,
StockMovement, VehicleExpense, AdSpend) tapi **tidak punya akuntansi**: tidak ada
bagan akun, tidak ada jurnal, tidak ada cara menjawab "kas kita berapa",
"piutang berapa", "bulan ini untung atau rugi".

Angka keuangan yang ada selama ini (`SUM(Order.value)` di Laporan/Kendali) adalah
**OMZET**, bukan pendapatan akuntansi — dan tidak pernah dipisahkan dari DP yang
belum jadi hak perusahaan. Lubang yang sudah dicatat di CLAUDE.md §19
("`Order.paymentStatus` tidak terhubung ke tabel `payments`") adalah gejala dari
ketiadaan lapisan ini.

---

## 2. Empat aturan yang menentukan seluruh bentuk modul

Ditulis lengkap di kepala blok FINANCE di `backend/prisma/schema.prisma`.
Ringkasnya:

1. **Tidak ada sumber data tandingan.** Finance tidak pernah meminta orang
   mengetik ulang transaksi yang sudah ada. Yang benar-benar baru hanyalah
   transaksi yang memang belum punya rumah: pengeluaran operasional non-kendaraan,
   tagihan supplier, transfer antar kas, refund, jurnal manual.
2. **Nominal presisi desimal** — `Decimal(18,2)`, bukan Int rupiah. Yang
   dilindungi adalah hasil HITUNGAN (alokasi proporsional, HPP rata-rata), yang
   kalau dibulatkan per langkah menghasilkan jurnal tidak seimbang.
3. **Posting atomik & idempoten** — satu kejadian sumber = maksimal satu jurnal,
   dijamin `idempotencyKey @unique` di level database (bukan cek di kode).
4. **Jurnal terposting tidak pernah diubah/dihapus** — koreksi selalu lewat
   REVERSAL dengan tanggalnya sendiri.

---

## 3. Keputusan akuntansi yang paling penting: DP BUKAN PENDAPATAN

Tiga kejadian, tiga jurnal (`services/finance/posting/orderRevenue.js`):

```
1. UANG MASUK (Payment tercatat — sales di konfirmasi order / driver di stop)
   sebelum pendapatan diakui:  Dr Kas/Bank   Cr Uang Muka Pelanggan  ← KEWAJIBAN
   sesudah pendapatan diakui:  Dr Kas/Bank   Cr Piutang Usaha

2. PENDAPATAN DIAKUI (order DISERAHKAN — DELIVERED / SEWA_DIKIRIM)
   Dr Piutang Usaha            Cr Pendapatan (Layanan/Produk/Sewa) + Ongkir
   Dr Uang Muka Pelanggan      Cr Piutang Usaha   (DP dipindah jadi pelunasan)

3. REFUND
   Dr Retur Penjualan / Uang Muka Pelanggan   Cr Kas/Bank
```

**Kenapa pengakuan pendapatan saat DISERAHKAN, bukan saat invoice dikirim.**
Invoice di sistem ini lahir OTOMATIS sebagai draft begitu order dibuat
(`services/invoice.js`) — kalau invoice jadi pemicu, seluruh order yang baru masuk
antrean akan langsung diakui sebagai pendapatan, termasuk yang belum dikerjakan.

**Dua titik pemicu, dua jalur:** `services/orderStatusSync.js` (jalur otomatis dari
status Unit) DAN `PATCH /orders/:id` (jalur manual, yang justru menyalakan
`statusLocked` sehingga sync berhenti menyentuhnya). Tanpa keduanya, order yang
ditutup manual akan punya uang masuk tanpa pendapatan yang pernah diakui.

---

## 4. Integrasi ke workspace lain — TIDAK menggandakan apa pun

| Sumber | Tempat input (TIDAK berubah) | Yang dilakukan Finance |
|---|---|---|
| Payment pelanggan | CRM (DP) & Armada (stop pengiriman) | jurnal penerimaan + alokasi ke order |
| Status order | Produksi/Delivery/CRM | pengakuan pendapatan saat diserahkan |
| Goods receipt putaway | Gudang | nilai persediaan (Dr Persediaan, Cr Utang Barang Belum Ditagih) |
| Material issue | Gudang | HPP (Dr Beban Pokok Bahan, Cr Persediaan) |
| VehicleExpense / VehicleService | Delivery > Biaya | jurnal beban kendaraan |
| AdSpend | Pengaturan CRM | jurnal beban iklan (tanggal buku = akhir bulan ybs) |

**Nol baris `stock_movements` ditulis dari modul finance.** Kuantitas tetap milik
`services/inventoryLedger.js`; finance hanya membaca baris yang sudah ditulis
gudang beserta `unitCost`-nya.

**Pola GR/IR** dipakai supaya penerimaan barang dan tagihan supplier tidak
menggandakan utang: putaway → `Utang Barang Belum Ditagih` (2-1150); tagihan
disetujui → akun itu ditutup, `Utang Usaha` lahir, selisihnya masuk
`Selisih Harga Pembelian`. Nilai persediaan yang sudah tercatat **tidak pernah
diubah surut**.

---

## 5. Kejujuran data — `FinPostingGap`

Mesin posting **tidak pernah mengarang angka**. Kalau sesuatu tidak bisa
dibukukan, lahir baris `fin_posting_gaps` yang tampil sebagai daftar kerja di
Finance > Pengaturan, dan SEMUA laporan menyebut jumlahnya di banner atas.

Tiga penyebab nyata yang ditangani:
- **Rekening belum dipetakan** — `Payment.method` (CASH/TRANSFER/QRIS) tidak tahu
  uangnya masuk ke rekening mana. Menebak akan merusak rekonsiliasi bank.
- **Material tanpa harga perolehan** — HPP tidak dihitung dari
  `Material.referenceUnitCost` (itu snapshot import Excel Agustus 2026, bukan nilai
  hidup) maupun rata-rata material lain.
- **Nilai order masih Rp0** — order diserahkan tapi belum pernah dihargai.

**Modul finance tidak pernah menjatuhkan operasional** (`services/finance/hooks.js`):
kegagalan konfigurasi ditelan jadi gap, pembayaran/putaway/material issue tetap
berhasil. Yang tetap dilempar adalah bug sungguhan (jurnal tidak seimbang).

**Saldo awal TIDAK dikarang.** Neraca baru lengkap setelah admin memasukkan jurnal
pembukaan (`source = SALDO_AWAL`). Sebelum itu laporan menyebut dirinya "sejak
sistem finance aktif".

---

## 6. Gerbang verifikasi pembayaran — default MATI, disengaja

Permintaan aslinya: "status pembayaran di CRM harus mengikuti pembayaran
terverifikasi". Mekanismenya **dibangun penuh & teruji**, tapi **default-nya
mati**, dan ini keputusan migrasi yang sadar:

Perilaku hari ini (dan default): SEMUA payment menentukan `Order.paymentStatus` —
alasannya ditulis panjang di `services/paymentLedger.js`. Menyalakan gerbang di
hari deploy berarti ratusan order yang sales anggap sudah DP mendadak balik jadi
"Belum Bayar" sampai finance sempat memverifikasi satu per satu.

Jalur aman yang dipakai:
- antrean verifikasi tersedia di Finance > Pembayaran & Verifikasi,
- penyalaan = satu klik admin di Finance > Pengaturan,
- saat dinyalakan, tanggal aktivasi **dikunci** ke saat itu (`*_GATE_SINCE`) —
  hanya payment BARU yang terkena. **Riwayat tidak pernah dinilai ulang secara
  surut.**

UI menyebut status gerbang apa adanya di Dashboard & halaman Pembayaran, supaya
tidak ada yang mengira antrean verifikasi sudah menahan sesuatu padahal tidak.

---

## 7. Permission — empat, bukan sepasang

`finance:read` · `finance:post` · `finance:approve` · `finance:admin`
plus `finance:expense:submit` untuk divisi lain.

Pemisahan tugas adalah inti kontrol keuangan, bukan hiasan: yang mencatat
pengeluaran bukan yang menyetujuinya, dan yang menyetujui pembayaran harian tidak
otomatis boleh mengubah bagan akun / menutup periode / membalik jurnal terposting.

`FINANCE` **tidak** dapat `finance:admin` (itu ADMIN/OWNER). Pengaju tidak bisa
menyetujui pengajuannya sendiri — kecuali pemegang `finance:admin`, dan
pengecualian itu **tercatat di metadata audit**, bukan disembunyikan.

---

## 8. Laporan

Semuanya diturunkan dari `fin_journal_lines`, tidak ada kolom saldo tersimpan
(prinsip sama dengan stok & status bayar di repo ini).

- **Laba Rugi** — akun kontra (Retur Penjualan) dibedakan lewat `normalBalance`,
  bukan `type`; memakai tipe saja akan menghitung retur sebagai penjualan.
- **Neraca** — laba tahun berjalan dihitung langsung dari akun pendapatan & beban
  sejak 1 Januari, **tidak** dari akun Laba Ditahan. Neraca jadi selalu seimbang
  tanpa bergantung pada proses tutup buku yang bisa lupa dijalankan.
- **Arus Kas** — metode LANGSUNG, dikelompokkan menurut kategori akun lawan.
  Transfer antar rekening sendiri DIKECUALIKAN (uangnya tidak ke mana-mana). Akun
  tanpa kategori tampil di kelompok "Belum Dikategorikan" apa adanya, bukan
  dipaksa masuk Operasi.
- **Neraca Saldo** — total debit ≠ total kredit ditampilkan sebagai KEADAAN
  DARURAT, bukan selisih biasa: seluruh jurnal buatan aplikasi dijamin seimbang.
- **Umur Piutang** — dari saldo akun Piutang Usaha per order, **bukan** "nilai
  order dikurangi pembayaran". Order yang belum diserahkan tidak punya piutang.

---

## 9. Penegakan di level database (migration, bukan schema.prisma)

`20260917100000_finance_workspace_ledger` — **murni aditif**, nol `ALTER TABLE`
pada tabel yang sudah ada. Rollback = DROP tabel `fin_*`.

CHECK constraint yang tidak bisa dinyatakan Prisma:
- `fin_journal_lines`: debit/kredit ≥ 0 DAN tepat satu yang > 0
- unique `(entry_id, line_no)`
- nominal dokumen selalu > 0 (satu-satunya nominal bertanda adalah baris koran bank)
- transfer kas: rekening asal ≠ tujuan
- periode: bulan 1..12; koran bank: `period_end >= period_start`

---

## 9b. Invoice & jatuh tempo — sisi Finance

Invoice TIDAK dibuat dari workspace Finance. Ia lahir OTOMATIS sebagai draft
begitu order dibuat (`services/invoice.js#ensureInvoiceForOrder`), dan isinya —
item, harga, alamat, pengiriman ke customer lewat WA/PDF — tetap dikelola dari
Rincian Pesanan di CRM.

Halaman `/finance/invoices` mengerjakan satu hal yang memang milik finance:
memastikan tagihan punya **jatuh tempo**, dan menindaklanjuti yang lewat tempo.
Penulisan `dueDate` memakai endpoint LAMA `PATCH /orders/:id/invoice` — tidak
ada jalur tulis kedua untuk kolom yang sama.

Nominalnya memakai ULANG `hitungNominal()` + `statusEfektif()` dari
`services/invoice.js`, bukan rumus baru: invoice yang dilihat finance wajib
menampilkan angka yang SAMA PERSIS dengan dokumen yang sudah diterima customer.

Kolom **Sumber** per baris jujur menyebut apakah angka "sudah dibayar" berasal
dari ledger pembayaran atau dari dropdown status bayar manual (order lama tanpa
satu pun entri `payments`). Ringkasannya juga tampil sebagai peringatan di atas
tabel — angka yang tidak punya rincian tidak boleh terlihat sama meyakinkannya
dengan angka yang punya.

---

## 9c. Pemilih order, bukan ID mentah

`features/finance/OrderPicker.jsx` dipakai di Refund, Alokasi Pembayaran, dan
pembebanan biaya ke order. Sebelumnya form-form itu meminta **ID order mentah**
(cuid 25 karakter) ditempel manual.

Itu bukan sekadar tidak nyaman: ID order tidak pernah muncul di layar yang
dilihat finance sehari-hari (yang tampil `orderNumber`), jadi satu-satunya cara
mengisinya adalah menyalin dari URL halaman Order. Salah tempel satu karakter =
"order tidak ditemukan"; salah tempel ID order LAIN = refund yang dibukukan ke
order yang salah, dan itu baru ketahuan saat rekonsiliasi.

Memakai `GET /api/orders` yang sudah ada (pencarian nomor order & nama pelanggan
sudah didukung di sana) — tidak ada endpoint pencarian kedua.

---

## 9d. Penomoran dokumen & timezone

`generateDocumentNumber()` menerima **tanggal buku** (tengah malam UTC) dan
membacanya dengan getter **UTC**, bukan getter lokal.

Bedanya bukan teoretis: tanggal buku "1 Oktober" tersimpan sebagai
`2026-10-01T00:00:00Z`; dibaca `getMonth()` di mesin ber-offset negatif ia jadi
30 September, sehingga nomor dokumennya memakai counter **bulan sebelumnya** —
bisa bentrok dengan dokumen September yang sudah ada. Server production memang
UTC sehingga gejalanya tidak muncul di sana, tapi mesin developer TIDAK.

Dikunci tes: `tests/financeJournal.test.js` → "nomor mengikuti TANGGAL BUKU,
tidak bergeser oleh timezone mesin". Seluruh suite unit diverifikasi hijau di
UTC, UTC−4, dan UTC+14; dengan getter lokal (kode sebelum perbaikan) suite itu
MERAH di UTC−4 — jadi tesnya terbukti benar-benar menangkap, bukan hiasan.

⚠️ `TZ=... npm test` TIDAK berpengaruh di Windows/Git Bash lingkungan ini
(`getTimezoneOffset()` tetap ikut mesin). Yang bekerja: men-set
`process.env.TZ` DI DALAM proses sebelum `Date` mana pun dibuat, lalu
menjalankan runner lewat API `node:test#run`.

---

## 10. Yang BELUM dikerjakan (jujur, bukan kelupaan)

- **Pajak (PPN/PPh)** belum dimodelkan. Akun "Utang Pajak" tersedia untuk jurnal
  manual; tidak ada mesin hitung otomatis, karena data faktur pajak memang belum
  ada di sistem ini.
- **Backfill 228 order LUNAS historis** tidak dijalankan otomatis. Menjurnalnya
  berarti mengarang tanggal & rekening untuk uang yang detailnya tidak pernah
  dicatat (CLAUDE.md §19 sudah melarang backfill ini). Jurnal saldo awal adalah
  jalan yang benar.
- **Integrasi API bank** tidak ada, dan halaman Rekonsiliasi tidak berpura-pura
  ada — baris koran bank diinput manual.
- **Penyusutan aset tetap** belum otomatis (akun tersedia, jurnalnya manual).
