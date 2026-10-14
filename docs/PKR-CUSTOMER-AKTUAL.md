# Customer aktual & form order terpadu — Penjualan Karyawan (PKR)

Dibuat 14 Okt 2026. Kasus pemicu: PKR-11102026-005 / NEW-11102026-023 — penjual **Kemal**, pembeli sebenarnya **Bpk. Indra**, tetapi kolom Pelanggan di Order CRM menampilkan Kemal.

## Akar masalah

`buatAtauTautkanOrder` (services/penjualanKaryawanOrder.js) selalu memakai `profilCustomerKaryawan(sellerId)` — profil internal karyawan penjual (`Customer.staffUserId`) — sebagai
`Order.customerId`. Nama pembeli sebenarnya hanya tersimpan sebagai teks bebas `FinPenjualanKaryawan.buyerName` dan `Order.notes.pembeliPkr`. Semua workspace membaca `order.customer.name`,
sehingga yang tampil adalah karyawan penjual.

## Peta identitas (tiga hal yang TIDAK boleh tercampur)

| Identitas | Sumber | Menjadi |
|---|---|---|
| Karyawan penjual | `FinPenjualanKaryawan.sellerId` | sumber transaksi PKR; bukan Customer (kecuali ia membeli untuk dirinya sendiri) |
| Customer/pembeli | `Order.customerId` → Customer ber-nomor | tampil sebagai Pelanggan di CRM, Produksi, Delivery |
| Penerima | `Order.recipientName/recipientPhone` (opsional) | default = customer; boleh berbeda |

Satu read-model: `backend/src/lib/domain/pkrIdentitas.js` (`identitasPkr`, `proyeksiIdentitas`). Jangan membentuk label sendiri di pembaca lain.

## Aturan

- 1 PKR = 1 Order CRM induk (Rp0); item × jumlah = Unit; tidak ada Payment/invoice/pendapatan CRM kedua. Jumlah per item hingga **200** (DB CHECK dilonggarkan 20 → 200).
- Dedupe customer **hanya** lewat nomor telepon ternormalisasi (`normalisasiNomorTelepon`); pembuatan di bawah kunci penasihat per nomor (paralel = satu Customer).
  Customer yang sudah ada **tidak ditimpa** (nama beda dilaporkan). Nomor milik profil karyawan/staf internal/SPAM ditolak dengan arahan.
- Customer baru: `leadSource = PENJUALAN_KARYAWAN`, tanpa Sales pemegang, tanpa percakapan; dikecualikan dari funnel/lead/pipeline/komisi Sales seperti `B2B_DIRECT`.
- Klien lama (tanpa objek `pembeli`) tetap bekerja: order memakai profil karyawan dan ditandai **legacy** ("Data customer belum lengkap"); jalur "Pembeli adalah karyawan"
  (`pembeli.adalahKaryawan = true`) memakai profil yang sama tetapi SAH (penanda `notes.pembeliKaryawan`).

## Legacy & dry-run

- `GET /api/finance/penjualan-karyawan/pembeli/dry-run` atau `node backend/scripts/pkr-pembeli-dry-run.js` (baca-saja): order yang masih menunjuk profil karyawan + data tersedia/kosong.
- Tidak ada backfill. Admin melengkapi per order lewat **Lengkapi Data Customer** (nomor wajib) → order berpindah ke Customer aktual tanpa mengubah PKR/Unit/Job/Payment/jurnal.

## Koreksi (satu pintu)

`POST /finance/penjualan-karyawan/:id/koreksi-pembeli[/pratinjau]` dan jalur sempit `POST /orders/:id/pkr/koreksi-pembeli[/pratinjau]` (Produksi: catatan Produksi;
Delivery: penerima/alamat/Maps/patokan/catatan Delivery). Alasan ≥5 karakter, pratinjau dampak (fungsi hitung sama), `expectedRevision` (buku revisi `pkr_item_revisions`, jenis `PEMBELI`),
`Idempotency-Key`, audit sebelum/sesudah. Aturan progres Delivery: terjadwal → job yang SAMA disinkronkan (tidak ada job kedua); EN_ROUTE/ARRIVED → 409; COMPLETED → data historis
tidak ditimpa (hanya catatan). Nama customer hanya dikoreksi bila tidak dipakai order lain dan tidak punya percakapan.

## Privasi

Proyeksi per audiens (`proyeksiIdentitas`): Produksi = nama + keluhan + catatan Produksi (tanpa telepon/alamat/penerima); Delivery = nama/penerima, telepon, alamat, Maps, patokan,
catatan Delivery (tanpa keluhan/catatan Produksi). Status pembayaran PKR hanya untuk yang berizin harga/Finance (`null` untuk Produksi/Gudang/Driver).

## Tes

`backend/tests/integration/pkrCustomerAktual.integration.test.js`, `pkrEditProgres.integration.test.js`, `frontend/tests/pkrPembeliLogic.test.js`.
