# B3.7 — Koreksi Pembayaran Masuk Terverifikasi

Finance → Pembayaran & Verifikasi → **Uang Masuk Terverifikasi**: menu ⋯ per baris — Lihat Detail, Edit Informasi, Koreksi Pembayaran, Riwayat Perubahan. Menu yang tidak bisa dipakai tetap tampil, dengan alasan dan arah tindakan dari server.

## Endpoint (`/api/finance/pembayaran/:id/…`)
| Endpoint | Izin | Catatan |
|---|---|---|
| `POST /info` | `payment:koreksi` | bukti, catatan, nomor referensi, keterangan internal. Tanpa jurnal. Alasan + Idempotency-Key wajib. |
| `POST /koreksi` | `payment:koreksi` + PIN Finance | `{ reason, amount?, tanggal?, cashAccountId?, method?, orderId?, alokasi?, preview? }`. `preview:true` = jalankan kode yang sama lalu ROLLBACK (tanpa PIN & tanpa Idempotency-Key). Simpan: PIN + Idempotency-Key wajib. |
| `GET /riwayat` | `finance:read` | rantai versi, audit (sebelum/sesudah/alasan/aktor), rantai jurnal. |

`payment:koreksi` dipegang FINANCE, ADMIN, OWNER (ACCOUNTANT/APPROVER/SALES tidak). Endpoint PIN (`/pin`, `/pin/verifikasi`, `/pin/status`) kini juga terbuka untuk pemegang `payment:koreksi`.

## Cara kerja koreksi (satu transaksi DB)
1. Kunci kanonis grup → order → payment; kunci baris jurnal aktif payment (bersaing dengan pencocokan bank); blokir dievaluasi di bawah kunci.
2. Semua jurnal aktif Payment lama **dibalik** (reversal bertanggal sama dengan jurnal asli).
3. Payment lama ditandai batal (jejak tetap); Payment **baru** dibuat dengan `replacesPaymentId` (**UNIQUE** — satu payment hanya bisa diganti sekali) + verifikasi + alokasi.
4. Jurnal pengganti lewat `postPaymentReceived`: kredit **Uang Muka** bila pendapatan order belum diakui, kredit **Piutang** bila sudah.
5. Order yang pendapatannya sudah diakui dinormalkan (true-up Uang Muka↔Piutang, bertanggal jurnal pengakuan): R = Piutang − Uang Muka; R>0 → UM 0; R<0 → Piutang 0, UM = −R.
6. Status/paidAt semua order terkait dihitung ulang; invoice membaca Payment aktif.

Alokasi: Σ = nominal (bulat rupiah). Resi memakai `validasiAlokasiResi`/`pastikanGrupLayak` (helper kanonis); nominal berubah tanpa alokasi eksplisit → dibagi proporsional (largest-remainder). Order tunggal: tanpa baris alokasi (kompatibel); kontribusi lama yang sudah melebihi tagihan tetap boleh dikoreksi TURUN. Child Resi tidak bisa jadi tujuan lewat jalur order tunggal.

## Blokir (kode → arah tindakan)
`SUDAH_DIGANTI`/`SUDAH_DIBATALKAN`, `BELUM_DIVERIFIKASI`, `JURNAL_TIDAK_ADA`, `PRA_SALDO_AWAL` (lawan Laba Ditahan), `ADA_REFUND`, `KLAIM_LUNAS_ORDER`, `KLAIM_LUNAS_AKTIF` (Resi), `SUDAH_DIREKONSILIASI` (baris jurnal dicocokkan ke mutasi bank), `PERIODE_REKON_SELESAI` (rekening efektif asal/tujuan), periode akuntansi tertutup (dari `postJournal`).

## Migrasi
`20261002080000_payment_koreksi_versi` — aditif: 4 kolom nullable di `payments` + UNIQUE + FK Restrict.

## Gap yang diketahui
- **paidAt** (dasar komisi) mengikuti aturan lama `recomputeOrderPaymentStatus`: diisi "sekarang" saat status masuk LUNAS. Koreksi yang memindahkan pelunasan antar order/periode menggeser paidAt ke tanggal koreksi — perlu keputusan Owner (mis. paidAt = tanggal pembayaran pelunas) sebelum diubah.
- Periode Rekonsiliasi berstatus `DRAF_MENUNGGU_MUTASI` (sementara, saldo dikonfirmasi owner) tidak ikut memblokir; hanya `SELESAI` dan baris yang sudah dicocokkan.
