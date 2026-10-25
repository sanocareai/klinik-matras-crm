# Atribusi Fase 3.2 — kelengkapan spend per rentang (kandidat kode-saja)

**Masalah:** bila spend hanya terisi sebagian hari dalam rentang laporan, CPL/CPA/ROAS dihitung dari spend parsial dibagi lead SELURUH rentang (menyesatkan).

**Perubahan (backend saja, tanpa migrasi/skema, tanpa perubahan frontend):**
- `spend.js#muatSpendPerAd` ikut membaca tanggal yang punya spend (tingkat akun) di rentang.
- `biayaKpi.js#kesegaranSpend` menghitung `hariHilang` (hari WIB di rentang tanpa satu pun baris spend; hari berjalan tidak dihitung hilang) dan `termasukHariBerjalan`.
- Bila `hariHilang` tidak kosong: semua KPI berbasis CRM (CPL, cost per qualified, cost per customer ber-order, CPA, booked/cash ROAS) = `null` dengan alasan `SPEND_TIDAK_LENGKAP`, status biaya `DATA_TERLAMBAT` bila spend tertinggal > 2 hari, selain itu `SPEND_TIDAK_LENGKAP`, peringatan `SPEND_TIDAK_LENGKAP` memuat tanggal yang hilang. Spend, percakapan platform, jumlah lead/order/DP/lunas tetap tampil. `SEBELUM_ATRIBUSI` dan `HARI_ATRIBUSI_PARSIAL` tetap didahulukan.
- Rentang yang mencakup hari ini: peringatan `SPEND_HARI_BERJALAN_PARSIAL` (KPI tidak di-null hanya karena itu).
- Pemanggil lama tanpa `dari`/`hariTersedia` = kelengkapan tidak diketahui = perilaku lama.

**Rilis:** `scripts/release-atribusi-spend-lengkap.sh <DEPLOY_SHA> <BASE_SHA> [--preflight-only|--rollback]` (baseline = release aktif; web dipakai ulang; backup pg_dump; image rollback; verifikasi pasca-rilis termasuk rentang tanpa spend → KPI null). Tidak mengubah data, `.env`, flag, atau Meta.
