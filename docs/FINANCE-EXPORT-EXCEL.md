# Export Excel Finance (B3.9)

Tombol **Export Excel** ada di 11 halaman Finance: Pemasukan, Pembayaran & Verifikasi, Pengeluaran, Pembelian, Kasbon, Uang Muka Operasional, Piutang & Refund, Supplier & Utang, Rekonsiliasi, Jurnal Umum, dan Buku Besar. Berkas dibangun **server-side** (exceljs) dan mengunduh persis data yang sedang tampil.

## Endpoint
`POST /api/finance/export/:modul` — body `{ periode?: {from, to}, filter?: {...}, ids?: [...], filterLabel?: "..." }` → berkas `.xlsx`.
Kunci modul: `pemasukan`, `pembayaran`, `pengeluaran`, `pembelian`, `kasbon`, `uang-muka`, `piutang-refund`, `supplier-utang`, `rekonsiliasi`, `jurnal-umum`, `buku-besar`.
Read-only (tidak menulis apa pun). POST dipakai karena `ids` bisa panjang.

## Aturan yang ditegakkan (satu tempat: `backend/src/services/finance/export/excel.js`)
- **Filter/pencarian/status/periode aktif**: modul yang difilter di server menerima `filter`/`periode` yang sama dengan parameter layar; modul yang difilter di klien mengirim `ids` baris yang tampil (urutan layar) dan server memuat ulang baris itu.
- **Satu sumber query**: setiap modul memakai fungsi baca yang SAMA dengan endpoint layar (mis. `kasbonRead.js`) — angka berkas tidak bisa berbeda dari layar. Dikunci tes paritas per modul.
- **Tanggal WIB**: kolom tanggal kalender dibaca apa adanya; instant (mis. `createdAt`) dikonversi ke jam dinding WIB (UTC+7). Batas periode = batas hari WIB.
- **Nominal = angka Excel** (format ribuan), tanggal = tanggal Excel — bukan teks.
- **Header Bahasa Indonesia**, kepala berkas berisi judul, periode, filter aktif, waktu ekspor (WIB), dan nama pengekspor. **Baris total** dihitung server dari baris yang sama yang diekspor (subtotal/total sesuai layar).
- **Nama berkas**: `Finance_<Modul>_<periode>.xlsx` (mis. `Finance_Kasbon_2026-09-01_sd_2026-09-30.xlsx`; tanpa periode: `..._per_<tanggal WIB>.xlsx`).
- **Formula injection dicegah**: sel teks yang diawali `=` `+` `-` `@` TAB CR diberi apostrof di depan (kepala, kolom, catatan, nama pengekspor).
- **Izin**: izin modul = izin endpoint daftar layar (tanpa login 401, tanpa izin 403). **Kolom sensitif** (catatan internal, nomor rekening lengkap, tautan bukti/lampiran, alasan pembatalan) DIBUANG kecuali pengekspor punya `finance:admin` — isinya tidak ikut satu sel pun.
- **Batas**: 50.000 baris per berkas; lebih dari itu ditolak `413` dengan pesan mempersempit periode/filter (tidak pernah dipotong diam-diam).
- Tidak dicatat sebagai respons idempoten (`/finance/export/*` dikecualikan dari middleware Idempotency-Key).

## Menambah modul
Buat `backend/src/services/finance/export/<kunci>.js` (ekspor default `{ kunci, nama, izin, ambil }`), daftarkan di `registry.js`, pakai fungsi baca bersama layar, dan tambah tes integrasi (pola: `financeExportKasbon.integration.test.js`). `tests/financeExport.test.js` memastikan semua berkas terdaftar dan 11 modul tersedia.

## Frontend
`frontend/src/features/finance/ExportExcel.jsx` (`TombolExportExcel`, `labelFilterAktif`) + `api.exportFinanceExcel`. `ambilBody()` dipanggil saat klik supaya memakai state filter terbaru.

## Catatan hasil review (29 Sep 2026)
- **Satu export pada satu waktu** (maks. 2 menunggu, sisanya `429 SIBUK`) dan batas **400.000 sel** (baris × kolom, semua sheet) di samping 50.000 baris: pembuat xlsx bekerja di memori & menahan event loop proses backend yang sama dengan webhook WhatsApp. Sel teks dipotong 32.000 karakter (batas Excel).
- **Alasan pembatalan/pembalikan = sensitif**: kolom "Alasan Pembalikan" (Jurnal Umum) hanya untuk `finance:admin`, dan keterangan jurnal balik ("Pembatalan JV-… — alasan") dipotong sebelum " — " untuk non-admin (Jurnal Umum, Buku Besar, Pemasukan). "No. Referensi" pembayaran supplier ikut sensitif. Keterangan/referensi mutasi bank di Rekonsiliasi SENGAJA tidak sensitif (data inti kerja Finance).
- **`ids` hanya bila ada filter sisi-klien**: Pembayaran & Verifikasi tanpa pencarian/chip menjalankan periode+tab di server tanpa batas 300 baris layar. Untuk modul lain yang mengirim `ids` (layar sendiri membatasi baris yang dimuat), berkas mencantumkan catatan bila ≥200 baris.
- Input rusak (objek/enum/uuid) → `400 FILTER_TIDAK_VALID`, tanpa membocorkan pesan Prisma.
- **Perubahan perilaku layar (disengaja)**: `GET /customer-payments` kini memakai batas hari WIB (`startOfDayWIB`/`endOfDayExclusiveWIB`) — sesuai CLAUDE.md §11. Pembayaran jam 00:00–07:00 WIB di hari pertama periode kini masuk; yang jam 00:00–07:00 WIB sehari setelah hari terakhir kini keluar. Angka kartu periode bisa bergeser sedikit dibanding sebelum rilis ini.
- Cek nginx: `proxy_read_timeout` bawaan 60 dtk memotong export yang sangat lama (504) — dengan batas sel di atas, export terbesar ± beberapa detik.
