# Nota Kredit / Keringanan Order & Refund Kelebihan Bayar

Status: kandidat rilis (13 Oktober 2026) — belum merge, belum deploy. Baseline = live `c0c678ed`.
Keputusan Owner: Nota Kredit adalah mekanisme resmi potongan/keringanan; perbaikan jurnal refund kelebihan bayar ikut kandidat yang sama
(commit terpisah); audit data lama wajib sebelum rilis; tidak ada backfill/koreksi produksi otomatis.

## 1. Masalah yang diselesaikan

Refund hanya bisa **mengurangi pembayaran bersih**. Tagihan order tidak bisa turun. Akibatnya potongan harga yang disepakati *setelah* pelanggan lunas
(mis. "triplek tambahan tidak jadi") membuat order kembali **Dibayar sebagian** padahal buku besar sudah benar (piutang 0, pendapatan neto sudah dikurangi).
Definisi bisnis "potongan atas tagihan" belum ada di sistem — bukan bug hitung status, bukan bug gerbang Klaim Lunas.

## 2. Definisi (satu sumber: `backend/src/services/finance/notaKredit.js`)

| Istilah | Rumus |
|---|---|
| Tagihan kotor | Nilai order + ongkir yang ditagih |
| Nota kredit | Σ Nota Kredit **aktif** pada order |
| **Tagihan bersih** | Tagihan kotor − Nota kredit |
| Diterima | Σ Payment aktif yang dihitung (gerbang verifikasi + alokasi) |
| Refund disetujui | Σ Refund berstatus DISETUJUI (uang yang benar-benar keluar) |
| **Pembayaran bersih** | Diterima − Refund disetujui (tidak negatif) |
| **Sisa** | Tagihan bersih − Pembayaran bersih |
| Status | BELUM_BAYAR bila pembayaran bersih ≤ 0 · **LUNAS** bila sisa ≤ 0 (dan nilai order > 0) · selainnya DP |
| `paidAt` | **Tanggal pembayaran** yang melewati tagihan bersih (dari ledger) — bukan waktu nota dibuat |

Tidak ada pengurangan ganda: refund yang berasal dari kelebihan bayar tidak dikurangkan lagi dari tagihan; nota mandiri dibatasi sisa piutang buku besar;
nota tertaut refund tidak menjurnal.

## 3. Empat skenario & jurnalnya

| | Kondisi | Hasil |
|---|---|---|
| **A. Kelebihan bayar** | Tagihan 4,0 jt · Payment 4,2 jt · refund 200 rb | Pembayaran bersih 4,0 jt → tetap **LUNAS**. Tanpa nota kredit. Jurnal refund: **Dr Uang Muka Pelanggan 200 rb / Cr Bank 200 rb** (lihat §6). |
| **B. Potongan/keringanan belum dibayar** | Tagihan 4,0 jt · Payment 3,8 jt · Owner kurangi 200 rb | **Nota Kredit mandiri**: Dr Retur & Potongan Penjualan 200 rb / Cr Piutang Usaha 200 rb. Tagihan bersih 3,8 jt → **LUNAS**. Kas/Bank tidak berubah. |
| **C. Refund biasa** | Tagihan 4,0 jt · Payment 3,8 jt · 200 rb dikembalikan | Pembayaran bersih 3,6 jt → tetap **DP**. Nota kredit tidak mengubah sifat refund. |
| **D. Potongan setelah lunas** | Tagihan 4,3 jt · Payment 4,3 jt · refund 200 rb (kasus RES-07102026-037) | Order jadi DP (gejala). **Nota Kredit tertaut refund**: *tanpa jurnal baru* (jurnal refund sudah Dr Retur & Potongan / Cr Bank). Tagihan bersih 4,1 jt = pembayaran bersih 4,1 jt → **LUNAS**. |

Jurnal sebelum/sesudah untuk D (usulan koreksi — **belum dijalankan**): jurnal **tidak berubah**; yang bertambah hanya satu baris `fin_order_credits` + status order DP → LUNAS + `paid_at` terisi.
Dampak: Kas/Bank, Piutang, Pendapatan, Retur & Potongan, Refund = **tidak berubah**.

## 4. Aturan & pengaman (server)

- Izin: baca = `finance:read`; pratinjau, buat, batalkan = `finance:admin`. Buat/batal wajib **Idempotency-Key** dan **token revisi** (409 `REVISI_BERUBAH` bila order berubah sejak layar dibuka).
- Nota **tertaut refund**: refund harus DISETUJUI, harus benar-benar mendebet Retur & Potongan (bukan pengembalian uang muka/kelebihan bayar), dan belum tertaut nota aktif
  (satu nota aktif per refund — dijaga indeks unik parsial di DB). Nominal ≤ bagian refund yang menjadi potongan.
- Nota **mandiri**: ≤ sisa piutang order di buku besar. Order yang belum diserahkan (pendapatan belum diakui) ditolak — ubah harga lewat item order.
- Order **Penjualan Karyawan (PKR)** ditolak: PKR punya ledger & koreksi sendiri.
- Refund yang tertaut nota aktif **tidak bisa dibatalkan/dikoreksi** sebelum nota dibatalkan.
- Tanggal nota: tidak di masa depan, tidak sebelum pengakuan pendapatan; periode akuntansi tertutup memblokir nota mandiri (tanpa dokumen setengah jadi).
- Pembatalan: jurnal dibalik dengan jurnal pembalik (tidak dihapus); status & `paidAt` dihitung ulang dari ledger.
- Replay (Idempotency-Key + isi sama) mengembalikan dokumen yang sama; paralel diserialkan kunci baris order; audit sebelum/sesudah di riwayat aktivitas order.
- Nota kredit **tidak pernah** menyentuh rekening kas/bank.

## 5. Endpoint

| | |
|---|---|
| `GET /api/finance/orders/:orderId/nota-kredit` | Ringkasan server, daftar nota, refund kandidat (finance:read) |
| `GET /api/finance/orders/:orderId/nota-kredit/pratinjau?amount&kind&refundId&date` | Dampak dihitung server — menjalankan jalur simpan yang sama lalu **dibatalkan** (tidak menulis apa pun) |
| `POST /api/finance/orders/:orderId/nota-kredit` | Buat (`amount, kind, reason, refundId?, date?, revisi`) |
| `GET /api/finance/nota-kredit/:id/pratinjau-batal` | Pratinjau pembatalan |
| `POST /api/finance/nota-kredit/:id/batal` | Batalkan (`reason, revisi`) |

## 6. Jurnal refund kelebihan bayar (commit terpisah)

Untuk order yang pendapatannya **sudah diakui**, debit refund berurutan:
1. saldo **Uang Muka Pelanggan** (2-1200) order itu (dibayar sebelum diserahkan, lebih dari tagihan),
2. saldo **kredit Piutang Usaha** order itu (dibayar sesudah diserahkan, lebih dari tagihan),
3. sisanya **Retur & Potongan Penjualan** (4-2100) — potongan harga sungguhan.

Biaya admin transfer tetap Dr Beban Administrasi Bank terpisah; Cr rekening = nominal + biaya. Sebelum perbaikan, refund kelebihan bayar mendebet Retur
(mengurangi pendapatan 200 rb) dan meninggalkan kewajiban palsu di 2-1200.

## 7. Antarmuka (Piutang & Refund)

- Tab **Refund** → menu Aksi refund disetujui → **Buat Nota Kredit** (nonaktif + alasan bila sudah tertaut).
- Drawer detail order di tab **Daftar Piutang** → bagian **Nota Kredit**: riwayat + tombol **Buat Nota Kredit**.
- Dialog: jenis (Potongan/Keringanan Mandiri | Tertaut Refund), jenis potongan, refund sumber, nominal, tanggal, alasan, **pratinjau server** (tagihan bersih, pembayaran bersih,
  sisa, status bayar, paidAt sebelum → sesudah; jurnal atau "Tanpa jurnal—sudah dicatat oleh refund"), konfirmasi dampak.
- Riwayat: nomor, jenis, nominal, pembuat/waktu/alasan, refund sumber, jurnal, status; **Batalkan** dengan pratinjau + alasan.

## 8. Audit produksi read-only (13 Oktober 2026)

- **Indra — PKR-11102026-005 / NEW-11102026-023**: total Rp7.200.000 (3 × Kasur Sorong 3in1 custom Rp2.400.000), satu pembayaran aktif Rp2.500.000 (transfer, 11 Okt, "DP"),
  tidak ada pembayaran dibatalkan, tidak ada klaim/refund/pengeluaran/jurnal manual Rp200.000 yang terkait. **Status benar: Dibayar sebagian, sisa Rp4.700.000.**
  Status "Lunas" tidak bisa diisi langsung (`LUNAS_HANYA_DARI_LEDGER`) dan order PKR memang tidak menerima nota kredit.
  Satu-satunya transaksi Rp200.000 di jendela itu milik **SWS-30092026-018 (SB [Cs vina])** — pembayaran sewa terverifikasi 10 Okt, bukan Indra.
- **Sofyan — RES-07102026-037** (bukan Indra): nilai Rp4.300.000 (Paket Upgrade Fondasi + Lapisan MS Rp3.800.000 + Ganti Kain Standard Rp500.000), satu Payment Rp4.300.000 (9 Okt), RFD-12102026-001 dibatalkan lalu
  RFD-12102026-002 DISETUJUI Rp200.000 + biaya admin Rp2.500 (alasan "refund triplek: udah ngga perlu"; catatan order: "Minta tambahan triplek untuk divan nya"). Jurnal JV-12102026-388: Dr Retur & Potongan 200.000 / Cr Bank 202.500 (+ beban admin).
  Klasifikasi: **potongan barang (triplek tidak jadi), BUKAN pengembalian kelebihan bayar** (Payment = tagihan). Piutang 0, pendapatan neto 4,1 jt — sesuai. Status tersimpan DP, `paid_at` kosong.
  **Kandidat Nota Kredit tertaut RFD-12102026-002. Tidak dikoreksi** — menunggu konfirmasi Owner atas nama/customer yang benar. Catatan: triplek bukan baris item order tersendiri; dasar potongan = alasan refund + catatan order.
- **Refund lama terdampak bug kelebihan bayar**: hanya 1 jurnal refund aktif di produksi (Rp200.000, Dr Retur, tanpa saldo Uang Muka/kredit piutang saat itu) → kelas C. Dampak data lama = Rp0.
  14 order lain memegang saldo Uang Muka tanpa hubungan dengan refund (backlog terpisah).

## 9. Rollback

Migrasi aditif (1 nilai enum + 1 tabel kosong, tanpa backfill). Rollback kode aman **selama tidak ada nota kredit**; bila sudah ada nota aktif, kode lama mengabaikannya dan
status order akan kembali menghitung tagihan kotor. Guard: `scripts/rollback-guard-nota-kredit.sh` (baca-saja; menolak bila ada nota kredit).
