# Representasi multi-unit di Order CRM (Penjualan Karyawan)

Dibuat 13 Okt 2026. Kasus pemicu: PKR-11102026-005 / NEW-11102026-023 — satu PKR Rp7.200.000 untuk 3 kasur. Datanya benar (1 order CRM induk + 3 unit
produksi U1/U2/U3 + 1 job pengiriman) tetapi layar Order CRM hanya menampilkan satu baris tanpa rincian unit, sehingga terbaca seolah "1 kasur".

## Aturan (tidak boleh dilanggar)

1. **Satu PKR = satu Order CRM induk.** Unit hanya sub-baris dari order itu. Tidak ada Order database baru, tidak ada Payment/invoice/pendapatan/jurnal CRM.
2. **Order induk tetap Rp0.** Nominal PKR dibaca Finance satu kali dari `fin_penjualan_karyawan`; sub-baris unit sengaja TIDAK menampilkan nominal.
3. **Status per unit = status unit itu sendiri**, bukan agregat order. Delivery per unit = job pengiriman yang menaungi unit itu (`JobUnit`); satu job boleh
   menaungi banyak unit (tidak ada job ganda karena ada banyak unit).
4. **Rencana & PIC** dibaca dari rencana produksi V2 unit (`production_run_plans_v2`). Belum ada rencana → "Belum dijadwalkan" (jujur, tidak ditebak).
5. **Tidak ada backfill** dan tidak ada migrasi: data sudah ada, yang diperbaiki hanya read-model dan UI.

## Alur data

| Lapisan | Berkas |
|---|---|
| Fungsi murni (susun sub-baris + ringkasan) | `backend/src/lib/domain/pkrUnitBaris.js` |
| Read-model (`ringkasOrderPkr` → `unitBaris`, `ringkasUnit`) | `backend/src/services/penjualanKaryawanOrder.js` |
| Daftar order (`GET /api/orders`: `?unitStatus=`, pencarian unit/PKR/pembeli) | `backend/src/routes/orders.js` |
| Logika tampilan murni | `frontend/src/features/orders/pkrUnitLogic.js` |
| Komponen (tabel desktop, kartu mobile, drawer) | `frontend/src/features/orders/PkrUnitBaris.jsx` |
| Pemasangan | `frontend/src/pages/Orders.jsx`, `frontend/src/features/orders/OrderTimelineDrawer.jsx` |

`ringkasUnit`: `total`, `dijadwalkan` (unit dengan rencana produksi bertanggal), `sedangDiproduksi`, `siap` (READY_FOR_DELIVERY / ditahan customer),
`dalamPengiriman`, `terkirim`, `dibatalkan` (tidak ikut total).

## Perilaku UI

- Tabel desktop: tombol "n unit" di sel ID Order membuka/menutup sub-baris (Unit, Item, Ukuran & spesifikasi, Produksi, Rencana & PIC, Delivery).
- Papan/mobile: kartu order induk memuat daftar unit langsung.
- Drawer rincian order: seksi "Unit produksi"; nilai & pembayaran dirujuk ke Finance untuk order PKR.
- Klik unit → drawer Unit 360 (`?unit=<id>`, bertahan saat muat ulang; unit di luar Production V2 jatuh ke tampilan Unit 360 lama).
- Pencarian: nomor order, nomor unit, nomor PKR, nama pembeli PKR, nama pelanggan/karyawan, HP.
- Saringan "Status Unit" memakai status unit (order tampil bila salah satu unit aktifnya berstatus itu).

## Tes

- `backend/tests/pkrUnitBaris.test.js` (murni)
- `backend/tests/integration/pkrUnitCrmBaris.integration.test.js` (PostgreSQL sungguhan)
- `frontend/tests/pkrUnitLogic.test.js`
