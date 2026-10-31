# Aset logo bank (Ringkasan Keuangan Finance)

Logo dipakai sebagai identitas rekening di tabel "Saldo rekening" (`frontend/src/features/finance/RingkasanPanels.jsx`, `LogoBank`).
Disimpan lokal di `frontend/src/assets/bank/` — tidak ada hotlink, **berkas tidak dimodifikasi** (SHA-256 salinan di repo = berkas yang diunduh) (warna, bentuk, dan rasio asli; hanya ditampilkan `object-fit: contain` di wadah 40px).

| Berkas | Sumber (diunduh 31 Okt 2026) | Ukuran | SHA-256 |
|---|---|---|---|
| `bca.svg` | https://pustaka.bca.co.id/public-assets/logo-bca.svg (aset yang dimuat situs https://www.bca.co.id) | 70.236 B | `c976d013d44175675919cc661dcac427f48f541b793ce04c1570f267e065e1b3` |
| `mandiri.png` | https://bankmandiri.co.id/image/layout_set_logo?img_id=31567 (logo header situs https://bankmandiri.co.id), PNG 400×117 | 12.152 B | `36849816bb2e5d28052541ce0ae636dd4cb145a6ecfdb70a2ba0a4e1abe81020` |

## Status izin — PENTING
- Aset diambil dari situs resmi masing-masing bank. **Tidak ada dokumen izin pakai merek yang dimiliki**; ini BUKAN klaim bahwa izin sudah ada.
- Merek dagang milik BCA dan Bank Mandiri. Penggunaan di sini hanya untuk mengidentifikasi bank dari rekening perusahaan sendiri.
- Bila pemilik merek menyediakan pedoman/kit logo resmi, ganti berkas dengan kit tersebut tanpa mengubah nama berkas.

## Aturan pemakaian di kode
- Logo hanya dipilih dari `kind` dan `bankName` rekening (normalisasi: trim, spasi ganda, tanpa membedakan kapital). Nama rekening/pemilik tidak pernah dipakai untuk menebak bank.
- Kas tunai dan e-wallet memakai ikon dompet; bank tidak dikenal memakai ikon bank netral.
- Logo dekoratif (`alt=""`) karena nama bank dan nomor rekening selalu tertulis sebagai teks di sampingnya.
