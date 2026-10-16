# Audit Pergerakan Stok Resmi → Persiapan Rekonsiliasi (16 Okt 2026)

Basis: live `be1c98e8` (main = produksi). Branch: `feat/finance-audit-pergerakan-stok-resmi`. **Belum deploy, belum ada perubahan data produksi.**
Cakupan: Stock Count (Stock Opname), Stock Adjustment, Damaged Stock, Return Record — "pergerakan stok resmi" selain Material Issue (K5) dan penerimaan PO.

## 1. Kondisi produksi (baca-saja, 16 Okt 2026)

| Hal | Nilai |
|---|---|
| Stock Count | 1 dokumen: `CC-01092026-BASELINE` (COMPLETED) = backfill saldo pembuka dari Excel; 106 baris, 106 pergerakan ADJUSTMENT (+4.360,4), semua tanpa harga, 0 jurnal |
| Stock Adjustment / Damaged / Return Record | **0 dokumen** semuanya |
| Pergerakan | ADJUSTMENT 106 (semua dari baseline), ISSUE 254 (semua punya `unit_id`, **0 harga**, 0 jurnal), RECEIPT 19 (berharga, 9–16 Okt) |
| Cutover persediaan | `inventory_cutover_date` belum diisi; Persediaan Awal `PSA-30092026-001` masih **DRAFT** (tanggal 2026-10-01) |
| Saldo buku Persediaan Bahan Baku (1-1400) | Rp37.760.500 (dari penerimaan PO) |
| Material aktif | 355; 259 punya harga referensi Excel (**tidak dipakai** sebagai nilai jurnal) |

Artinya: belum ada selisih/penyesuaian/rusak/retur nyata yang perlu dijurnal hari ini. Yang ada hanya baseline migrasi (sengaja DITOLAK) dan 254 ISSUE historis (sengaja TIDAK di-backfill).

## 2. Peta aksi yang mengubah kuantitas

| Dokumen | Aksi (rute Gudang) | Pergerakan ledger | Arah |
|---|---|---|---|
| Stock Count | `complete` (pengaju ≠ penyetuju; selisih disesuaikan terhadap pergerakan sesi hitung) | `ADJUSTMENT` per baris berselisih, `stockCountId` | ± |
| Stock Adjustment | `post` (APPROVED → POSTED) | `ADJUSTMENT`, `stockAdjustmentRequestId` | ± |
| Damaged Stock | `resolve` DISPOSE / RETURN_TO_SUPPLIER | `WASTE` (−), `damagedStockRecordId` | − |
| Damaged Stock | `resolve` REWORK / RESTORE_TO_AVAILABLE | tidak ada (stok tak berubah) | — |
| Return Record | `complete` RETURN_TO_AVAILABLE | `RETURN` (+), `returnRecordId` | + |
| Return Record | resolusi lain (QUARANTINE, REWORK, …) | tidak ada | — |

## 3. Matriks jurnal (yang SEMESTINYA)

Mesin: `bukukanPergerakan` (sama dengan Material Issue) — satu jurnal per dokumen, nilai dari bukti harga, gap bila tanpa harga, sadar-cutover. Sumber jurnal `PEMAKAIAN_BAHAN`, **tanpa dimensi unit/order**.

| Dokumen / aksi | Sumber nilai yang terbukti | Kurang | Lebih | Kunci idempoten | Pembatalan | Status |
|---|---|---|---|---|---|---|
| Stock Count complete | nilai beku pergerakan bila ada; selain itu rata-rata tertimbang penerimaan **pada saat pergerakan** (+ persediaan awal pasca-cutover) | Dr 5-1960 Selisih Stok / Cr 1-1400 | Dr 1-1400 / Cr 5-1960 | `SELISIH_OPNAME:<id>` | reversal resmi (final) | TERKUNCI |
| Stock Adjustment post | idem | Dr 5-1960 (DAMAGE/EXPIRY → 5-1900) / Cr 1-1400 | kebalikan | `SELISIH_PENYESUAIAN:<id>` | reversal resmi | TERKUNCI |
| Adjustment CONVERSION | — (butuh pasangan keluar/masuk, tak ada ikatan) | — | — | — | — | **DITOLAK** |
| Damaged DISPOSE | idem | Dr 5-1900 Beban Susut / Cr 1-1400 | — | `SUSUT_BARANG_RUSAK:<id>` | reversal resmi | TERKUNCI |
| Damaged RETURN_TO_SUPPLIER | bukan susut: ini **Retur Supplier & Debit Note** | — | — | — | — | **DITOLAK** |
| Damaged REWORK/RESTORE | tidak ada pergerakan | — | — | — | — | tidak ada jurnal |
| Return Record RETURN_TO_AVAILABLE | **asal barang tak terbukti** (nilai perolehan barang retur tidak ada) | — | — | — | — | **DITOLAK** |

Aturan keras (semuanya diuji): sakelar PER JENIS (`stok_resmi_opname_aktif/_sejak` (Stock Count), `stok_resmi_penyesuaian_aktif/_sejak` (Stock Adjustment), `stok_resmi_rusak_aktif/_sejak` (Damaged DISPOSE)) semuanya DEFAULT MATI **dan** tanggal mulai jenis itu wajib terisi; dokumen harus final; dokumen sebelum tanggal mulai ditolak; baseline migrasi ditolak; tanpa harga → gap `TANPA_HARGA_PEROLEHAN` (bukan Rp0); harga referensi Excel tidak dipakai; cutover `tertutup` → tidak dijurnal (sudah tercakup persediaan awal), `tunggu_pembuka` → gap, bukan jurnal negatif; periode tertutup → rollback penuh.

## 4. Pemisahan: selisih hitung fisik ≠ pemakaian bahan per order

- Selisih fisik/susut masuk **akun agregat** (5-1960 / 5-1900, tipe BEBAN_POKOK) → baris tersendiri di Laba Rugi. **Tidak pernah** diatribusikan ke order atau unit; jurnal tanpa `unitId`/`orderId`; nilai beku jejak biaya unit tidak ditulis (diuji).
- Pembanding "pemakaian PIC vs ISSUE": bila bukti langkah produksi (6/7/10, bukan `DOC_*`) mencatat bahan lebih besar daripada ISSUE di stok pada jendela yang sama, pratinjau menampilkan `pembandingPemakaianProduksi` + peringatan. **Hanya informasi** — tidak menjurnal, tidak mengubah stok, tidak menyentuh HPP order. Penyelesaiannya lewat pencatatan Material Issue di Produksi–Gudang (K5), bukan lewat opname.
- Konsekuensi: bila pemakaian produksi belum tercatat, opname akan menunjukkan stok fisik < buku dan selisihnya tampak sebagai "susut". Pratinjau memperingatkan; Finance memutuskan sebelum menyetujui (lihat §6).

## 5. Pengaman yang dibangun

`backend/src/services/finance/stokResmi/` (`matriks`, `dokumen`, `pratinjau`, `posting`) + rute Finance:

- `GET  /api/finance/stok-resmi/matriks` (finance:read)
- `GET  /api/finance/stok-resmi/:jenis/:id/pratinjau` (finance:read) — **baca-saja**: perubahan kuantitas & nilai per baris, akun debit–kredit, dokumen sumber, status cutover, gap tanpa harga, alasan penolakan (kode + pesan), pembanding PIC
- `POST /api/finance/stok-resmi/:jenis/:id/posting` | `/pembalikan` (finance:admin, `alasan` ≥ 5 karakter) — **mati selama sakelar MATI**
- Tidak ada pintu Gudang yang memanggil modul ini: **tidak ada posting otomatis baru**; stok & jurnal produksi tidak diubah.
- Perubahan kecil di `posting/inventory.js`: parameter opsional `akunKeyUntuk` (perilaku lama identik; tes K5/Opname hijau).
- Enam pengaturan baru di `fin_settings` (tanpa migrasi), tiga sakelar per jenis + tanggal mulai masing-masing: `stok_resmi_opname_aktif/_sejak` (Stock Count), `stok_resmi_penyesuaian_aktif/_sejak` (Stock Adjustment), `stok_resmi_rusak_aktif/_sejak` (Damaged DISPOSE). Default `false` / kosong; divalidasi di `PATCH /api/finance/settings` (tanggal kalender valid). **Return Record tidak punya sakelar** (ditolak permanen), begitu pula Retur ke Supplier, Konversi, dan baseline migrasi. Sakelar mati menolak posting DAN pembalikan jenis itu (409) sebelum kunci/tulis apa pun.
- Pratinjau berjalan dalam transaksi Postgres `READ ONLY` (jaminan di level database), diuji 24 panggilan paralel tanpa perubahan satu baris pun di tabel mana pun. Izin: pratinjau/matriks = finance:read (ADMIN, OWNER, FINANCE, ACCOUNTANT, APPROVER); posting/pembalikan = finance:admin (ADMIN, OWNER) saja.

Tes (DB terisolasi): `stokResmi.integration.test.js` 16 tes — pratinjau tidak menulis & = baris jurnal; arah debit/kredit; sakelar/tanggal/final; penolakan (Return, Retur Supplier, Konversi, baseline); tanpa harga; idempoten + 6 permintaan paralel = 1 jurnal; reversal final; atomik (rollback jurnal+gap+aktivitas); periode tertutup; cutover tunggu pembuka; isolasi (ledger stok & ISSUE historis tak berubah); izin; validasi pengaturan. `stokResmi.test.js` 6 tes murni.

## 6. Rancangan cutoff rekonsiliasi (usulan — belum diaktifkan)

**A. Prasyarat (berurutan)**
1. Produksi–Gudang siap mencatat Material Issue per unit di lantai (K5) — kalau tidak, selisih opname bercampur dengan pemakaian yang belum tercatat.
2. Harga perolehan lengkap untuk bahan yang akan dihitung (RECEIPT berharga via PO/Penerimaan). Bahan tanpa harga → gap, bukan jurnal.
3. Persediaan Awal (PSA) diposting Finance + Owner pada tanggal cutover (runbook Opname baru); `inventory_cutover_date` diisi.

**B. Yang dihitung fisik** — seluruh bahan aktif bersaldo ≠ 0 pada tanggal cutover (FULL_STOCK_OPNAME). 259 bahan beracuan Excel hanya pembanding, bukan nilai. Hitung buta (blind), penghitung ≠ pemeriksa.

**C. Pembekuan selama hitung** — sesi hitung sudah menandai pergerakan di jendela sesi (`pergerakanSesiHitung`) dan menyesuaikan selisih. Usulan operasional: Gudang tidak menerima/mengeluarkan bahan yang sedang dihitung, atau transaksi saat itu tetap lewat dokumen resmi agar masuk jendela. Jalur cepat receipt/return/waste sudah ditutup (410).

**D. Persetujuan selisih & nilai oleh Finance**
1. Opname COMPLETED (pemisahan tugas sudah berjalan di Gudang).
2. Finance membuka **pratinjau**: kuantitas, nilai, akun, gap, peringatan PIC.
3. Bila selisih tampak sebagai "pemakaian belum tercatat" → selesaikan dulu di Produksi (Material Issue), lalu lihat pratinjau ulang.
4. Finance (finance:admin) memposting dengan alasan tertulis; jurnal agregat, tercatat di log aktivitas. Koreksi = reversal + dokumen baru (final; tidak diposting ulang diam-diam).

**E. Urutan aktivasi tiap jenis dokumen** (tiap jenis punya sakelar + tanggal mulai sendiri = tanggal cutover; QA setiap tahap):
1. Stock Count (selisih opname pertama pasca-PSA) → verifikasi saldo 1-1400 = nilai stok.
2. Stock Adjustment POSITIVE/NEGATIVE/COUNT_DIFFERENCE/OTHER/DATA_CORRECTION.
3. Damaged Stock DISPOSE + Adjustment DAMAGE/EXPIRY (Beban Susut).
4. Ditunda sampai aturan bisnis ada: Return Record (butuh asal & nilai perolehan), Retur ke Supplier (Debit Note), Konversi (pasangan keluar-masuk).

*Catatan teknis:* sakelar kini per jenis (Stock Count / Adjustment / Damaged DISPOSE), semuanya MATI saat rilis. Adjustment tipe DAMAGE/EXPIRY mengikuti sakelar Adjustment (bukan sakelar Damaged).

## 7. Risiko terhadap rekonsiliasi stok

| # | Risiko | Mitigasi / status |
|---|---|---|
| R1 | 254 ISSUE historis tanpa harga & jurnal → HPP bahan kurang; bila diopname, selisih ≈ "pemakaian tak tercatat" | **Tidak di-backfill** (sesuai batasan); hanya diinformasikan lewat pembanding PIC |
| R2 | Baseline 106 baris tanpa harga; harga referensi Excel tentatif | Ditolak sebagai jurnal; PSA yang membawa nilai pembuka lewat persetujuan Finance+Owner |
| R3 | Selisih opname terbaca sebagai susut padahal pemakaian belum tercatat | Pembanding PIC + keputusan Finance §6D.3; tidak diatribusikan ke order |
| R4 | Selisih fisik masuk Laba Rugi sebagai BEBAN_POKOK agregat → kelompok Beban Pokok naik tanpa HPP unit | Dinyatakan di `dampakLaporan`; tidak mengubah HPP per unit/order |
| R5 | Harga rata-rata bergeser setelah dokumen dibuat | Harga dihitung pada waktu pergerakan (konsisten dengan Material Issue); nilai beku dipakai bila ada |
| R6 | Dokumen sebelum cutover diposting → ganda dengan PSA | `tertutup` tidak menjurnal; `tunggu_pembuka` → gap |
| R7 | Return Record / Retur Supplier salah dinilai | Ditolak; butuh aturan bisnis & asal barang |
| R8 | Sakelar dinyalakan sebelum prasyarat A | Default MATI + tanggal mulai wajib; pratinjau memperingatkan |
| R9 | Reversal oleh peran salah | finance:admin saja; alasan wajib; butuh sakelar aktif |

## 8. Status tes regresi

Unit penuh (`tests/*.test.js`): 7 merah **identik dengan baseline `be1c98e8`** (diverifikasi di worktree bersih: checkout CRLF Windows, audit P8 baris 957 `productionStepCommandService.js`, compose staging, Coverage halaman Piutang) — bukan dari perubahan ini. Satu merah baru (audit pembaca P8/P10B untuk `pratinjau.js`) diselesaikan dengan meninjau dan mendaftarkan pembaca baca-saja baru; guard tidak dilonggarkan. Integrasi terkait (K5 Lepas, Material Issue, Persediaan Awal, Ledger, Opname, Rekonsiliasi, Sesi Hitung, Validasi UUID): hijau.

## 9. Batas fase ini

Tidak ada deploy, tidak ada perubahan data produksi, tidak ada posting otomatis, tidak ada backfill 254 ISSUE, tidak ada harga referensi Excel, SO Oktober yang gagal tidak diposting. Pilot PO nyata tetap verifikasi baca-saja dan terpisah.
