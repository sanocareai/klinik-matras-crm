# B3 — Rekonsiliasi Cutoff & Late-Posting Guard (25 September 2026)

Periode rekonsiliasi = snapshot historis **immutable**. Jurnal yang dibuat setelah snapshot tidak mengubah angka lama; ia tampil terpisah.

## Definisi waktu (enam hal berbeda)
| Waktu | Arti | Kolom |
|---|---|---|
| Tanggal buku | tanggal transaksi di jurnal | `fin_journal_entries.date` |
| Waktu dibuat | kapan jurnal dimasukkan | `created_at` |
| Cutoff mutasi bank | batas waktu mutasi bank menurut konfirmasi | `cutoff_start_at/cutoff_end_at` |
| Konfirmasi saldo riil | kapan saldo bank dikonfirmasi | `confirmed_at` |
| Snapshot dibuat | kapan record snapshot ditulis | `snapshot_at` |
| High-water mark | jurnal ber-`created_at` ≤ ini (dan tanggal buku ≤ akhir periode) termasuk snapshot | `hwm_at`, `hwm_entry_number` |

## Skema (aditif)
`fin_recon_snapshots` (satu per periode; trigger DB menolak UPDATE kolom inti dan DELETE; invalidasi hanya sekali) dan `fin_recon_exception_reviews`. Migrasi `20260925100000_rekon_snapshot_cutoff`.

## Klasifikasi jurnal sesudah snapshot
Posting Setelah Cutoff · Reversal Setelah Snapshot · Penyesuaian Buku (bukan mutasi bank) · di luar periode (tanggal buku sesudah periode, tidak memengaruhi). Identitas server: *snapshot + jurnal sesudahnya = saldo buku sekarang*; bila tidak cocok snapshot dinyatakan tidak berlaku. Snapshot tidak dihitung ulang saat halaman dibuka; verifikasi hash penuh hanya atas permintaan.

## Syarat SELESAI (server)
Mutasi bank asli ada · semua baris dicocokkan/dijelaskan · selisih nol · tanpa saldo 2-1700 · **tanpa exception terbuka** · **snapshot berlaku**. Periode yang diselesaikan otomatis dibuatkan snapshot bila belum ada.

## Exception "Perlu Ditinjau" (deteksi saja, tidak memperbaiki)
Dokumen aktif dengan jurnal seluruhnya dibalik · dokumen aktif tanpa jurnal · jurnal aktif tanpa dokumen aktif · pembayaran/jurnal tidak sinkron. Bisa ditandai "ditinjau" dengan catatan wajib; data tidak diubah.

## Periode cutoff 22 Sep 2026
Hanya saldo riil terkonfirmasi owner dan baseline privat; tanpa mutasi bank fiktif, tanpa jurnal koreksi/penyeimbang.
- Cutoff literal 22 Sep 19.00 WIB; **high-water mark efektif 21.33 WIB** (jurnal terakhir ber-created 21.33.14 WIB). Bukti: saldo buku PT Sano sama dengan saldo riil (selisih Rp0) **hanya** bila posting sampai jam itu ikut dihitung (bila hanya sampai 19.00 literal, buku lebih rendah). Kedua waktu disimpan beserta penjelasan.
- KEM: selisih snapshot Rp1.328.719 (buku lebih rendah dari bank) **tidak dikoreksi**; menunggu rekening koran.
- Periode 19–21 Sep: snapshot dibuat pada waktu pencatatan konfirmasi (21 Sep 19.18 UTC); saldo buku pada HWM sama dengan angka yang tercatat pada periode.

## Perubahan perilaku yang perlu diketahui
`saldoBukuSampai` kini memakai definisi Kas & Bank (hanya baris di akun buku rekening). Sebelumnya semua baris bertanda rekening ikut dihitung, termasuk baris beban biaya admin transfer.

## Rollback
Kode: pindahkan backend kembali ke direktori rilis `30270554` (compose sama). Migrasi hanya menambah 2 tabel + 1 trigger; aman dibiarkan. Data: `~/backups/pre-b3-rekon-cutoff-*.sql.gz`.
