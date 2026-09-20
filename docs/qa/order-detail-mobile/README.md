# QA — Detail Order mobile (`mobile/src/screens/OrderTimelineScreen.js`), 20 Sep 2026

Emulator Android (Pixel 8 AVD, dev client, API lokal dengan data contoh). Gambar "sebelum-*" diambil dari kode lama, "sesudah-*" dari kode baru.

## Akar masalah
1. **Layout**: header, kartu ringkasan, dan kartu alamat/info order berada DI LUAR `ScrollView`; isi tab memakai `ScrollView` sendiri dengan `flex: 1`
   sehingga hanya mendapat sisa layar (nested scroll, area sempit). Tab terakhir ("Invoice") terpotong karena bilah tab tidak bisa digeser otomatis.
2. **Rekening Transfer**: `styles.methodChip` memakai `flex: 1` (flexBasis 0). Pada baris `flexWrap` dengan override `flexGrow: 0`, chip rekening
   runtuh ke lebar padding saja → dua kotak vertikal sempit tanpa teks. Data API sebenarnya benar (2 rekening BANK aktif; `GET /orders/payment-accounts`).
   Kegagalan muat rekening juga ditelan diam-diam (`.catch(() => {})`), dan rekening dipilih ikut terkirim untuk metode Tunai.

## Perbaikan
- Satu `ScrollView` vertikal untuk seluruh halaman; hanya bilah tab (`stickyHeaderIndices`) yang menempel. Padding bawah = safe-area + 32.
- Bilah tab: item `flexShrink: 0`, tinggi ≥ 44dp, otomatis menggulir tab aktif ke tengah; geser mendatar bila ruang kurang.
- Kartu rekening lebar penuh (stack vertikal), seluruh kartu bisa ditekan (`Pressable`, role radio), menampilkan bank, pemilik, nomor tersamarkan
  (`accountNumberMasked`, tambahan aditif di API; nomor lengkap tidak pernah dikirim), dan status terpilih (radio + border + latar).
- Status rekening: memuat / gagal (pesan ramah + "Coba lagi") / kosong (empty state) / 1 / 2+.
- Draft pembayaran diangkat ke layar: jumlah, metode, rekening PER METODE, dan foto bertahan saat pindah tab/metode. Tunai tidak pernah mengirim `cashAccountId`.
- Kartu angka mengikuti `fontScale` (turun baris, tidak memotong kata di font 1,5 / 360dp).

## Hasil uji (semua lulus)
| Skenario | Hasil |
|---|---|
| 360×640dp, font 1,5, terang & gelap | tidak ada teks terpotong; kartu ringkasan satu per baris; form & tombol terjangkau |
| 1080×2400 (font 1,0) dan tablet ±600dp | 6 tab terlihat penuh; isi lebar mengikuti layar |
| Scroll dari atas ke bawah | header + ringkasan + alamat ikut naik; bilah tab menempel; satu scroll vertikal |
| Transfer dengan 0 / 1 / 2 rekening | empty state / 1 kartu / 2 kartu lebar |
| Gagal muat rekening (backend mati) | pesan + "Coba lagi"; setelah backend hidup kartu tampil |
| Pindah metode & tab | pilihan Transfer tetap saat kembali; QRIS tidak membawa pilihan Transfer; Tunai tanpa rekening |
| Keyboard numerik | field terlihat, halaman tetap bisa digulir |
| Navigasi gesture | isi tidak tertutup bilah gesture |
| Rotasi | aplikasi terkunci portrait (`app.json`), tidak berlaku |

Tes otomatis: `cd mobile && npm test` (logika draft/normalisasi rekening), `cd backend && node --test tests/maskAccount.test.js`.
