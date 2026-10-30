# Laporan → Marketing (menggantikan Traffic + Akuisisi + Iklan)

Branch `feat/marketing-tab-terpadu`, dasar = live `382027ef` (memuat laporan Meta MCP `e89bb0ea`). Hanya frontend; tidak ada perubahan backend, migrasi, env, atau data.

## Navigasi
Tab Laporan: Ringkasan | Sales | **Marketing** | Performa Tim | Pipeline.
Marketing: ringkasan semua sumber → klik sumber → detail sumber → (Meta) campaign → ad set → ad. Breadcrumb + tombol Back browser; periode, urutan, kolom, banding, sumber, level/campaign/adset, peringkat, umur tersimpan di URL (`?tab=Marketing&dari&sampai&sumber&urut&kolom&banding&level&campaign&adset&rank&umur`; nilai bawaan tidak ditulis).
URL lama: `?tab=Traffic` → Marketing; `?tab=Akuisisi[&sumber=X]` → Marketing[&sumber=X]; `?tab=Iklan` → Marketing&sumber=META. Periode dipertahankan; URL dikanonikalkan sekali (replace).

## Peta fitur lama → baru
| Lama | Posisi baru |
|---|---|
| Traffic · Total Lead Masuk | Kartu "Total lead" (service /sumber, memuat spam) + butir rekonsiliasi di Kualitas data |
| Traffic · Rata-rata/hari, Hari tidak normal, Jam tersibuk, Respons rata-rata | Marketing → "Pola lead & respons" (dapat dibuka) |
| Traffic · Tren harian + pita baseline | Grafik "Tren lead harian" (di ringkasan) |
| Traffic · Peta hari × jam, Jam tersibuk, Jam rawan | Pola lead & respons |
| Traffic · Atribusi sumber (%), peringatan rendah, antrean konfirmasi WhatsApp | Kualitas data (butir "Sumber lead diketahui" + tautan daftar) |
| Traffic · Sumber Lead (bar + tautan daftar customer) | Tabel semua sumber; detail sumber → "Daftar customer sumber ini" |
| Traffic · Performa per Platform (legacy CPA/ROAS/Nilai per lead) | Detail sumber → "Kreatif & tautan (basis label CRM)" (RincianKreatif, sumber terisi awal) |
| Traffic · Rincian per Iklan (kreatif/tautan) | Idem |
| Traffic · Export XLSX | Tombol "Export Marketing" (sheet Traffic + Rincian Iklan, tidak berubah) |
| Akuisisi · 4 kartu + 6 kartu uang | Satu baris 6 kartu ringkas |
| Akuisisi · kartu sumber (mobile) / tabel perbandingan | Tabel semua sumber (desktop) + kartu (mobile); kolom utama + "Kolom lengkap" |
| Akuisisi · sorotan server, urutan, Bandingkan, Ekspor CSV | Badge sorotan di tabel, pilih urutan, tombol Bandingkan, Ekspor CSV sumber |
| Akuisisi · catatan data, status ledger/spend, pengecualian | Kualitas data (butir + "Catatan dari server") |
| Akuisisi · detail sumber | Detail sumber (komponen sama; jejak Marketing › Sumber) |
| Akuisisi · Kelola biaya iklan | Tombol "Kelola biaya iklan" (dialog existing tidak diubah) |
| Iklan · campaign/ad set/ad + umur kohort | Detail Meta (URL-driven), peringkat dapat dipilih, umur kohort tetap ada |
| Iklan · cakupan, selisih label META_ADS, peringatan | Kualitas data (butir "Cakupan atribusi Meta" memuat selisih; catatan server) |
| Iklan · Impor spend / Target KPI / Monitoring | Detail Meta → tombol panel (komponen existing) |
| (baru) kesehatan atribusi, referensi Ad ID, daftar UNMAPPED, unduh daftar ID | Detail Meta → "Kesehatan & referensi" (baca-saja: /kesehatan, /referensi, /ekspor-id) |
| Belum ada di per-sumber: kolom "Prospek" | Tetap hanya di Meta (lengkap, "Prospek"); service /sumber tidak menghitung prospek per label CRM — tidak ditambah (tidak ada perhitungan paralel) |

## Audit total lead (snapshot sama, periode sama)
- Traffic "Total Lead Masuk" = customer dibuat di rentang WIB, **tanpa SPAM**, tanpa B2B/penjualan karyawan.
- Akuisisi "Lead" = customer dibuat di rentang WIB, **termasuk spam** (penyebut konversi utama), tanpa B2B/penjualan karyawan; "lead sah" = tanpa spam/staf internal/profil karyawan.
- Iklan "Lead" = hanya customer baru dengan touch CTWA pertama terbukti (subset), termasuk spam.
- Rekonsiliasi: total lead − spam = lead tanpa spam = total tren (fixture: 46 − 6 = 40). Definisi tidak diubah; kartu menampilkan "40 sah · 6 spam" dan Kualitas data menandai selisih (bila ada) — wajar hanya bila dua pembacaan terjadi pada saat berbeda (hari berjalan).
- "Closing" punya tiga makna lama (stage CRM TRANSACTION/REVIEWED di tab Traffic; closing utama = lunas ledger di Iklan). Label ambigu dihapus: "Customer lunas (ledger)" / "Transaksi (stage CRM)" (legacy, diberi catatan basis).

## Pengaman
Akuisisi berbasis label CRM dan atribusi campaign terbukti dipisah (judul + catatan "jangan dipertukarkan"). Konversi utama = ber-order ÷ total lead (termasuk spam); non-spam terpisah. Null + alasan dipertahankan; organik = "tidak tersedia". Total CPA/ROAS = dari total server; konversi total = Σ ber-order ÷ Σ lead. Biaya sumber manual tidak mengisi biaya campaign (service tidak diubah). Peringkat Meta memakai kriteria yang sama dengan tool MCP (dites sejajar).

## Pembacaan berurutan
Server hanya mengizinkan satu perhitungan laporan atribusi sekaligus (429 SEDANG_DIHITUNG); klien membaca /sumber lalu /atribusi/iklan berurutan dengan coba ulang singkat (`marketingData.js`).

## Back browser di shell bertab
`replaceActivePath` hanya replace; navigasi Marketing menambah satu entri riwayat (pushState) lalu mengisi tab; `popstate` menyinkronkan path tab. Berlaku hanya di halaman Laporan.

## Validasi
Lihat laporan akhir. Harness: `frontend/qa-harness/marketing-server.mjs` (backend asli + DB fixture terisolasi), `marketing-rekon-api.cjs`, `marketing-browser.cjs` (Chrome, 64 pemeriksaan).

## Rilis & rollback (belum dilakukan)
Frontend-saja: rilis lewat skrip rilis frontend-saja bergerbang (pola 382027ef/drw.sh): bangun dist dari worktree bersih, gerbang kode-live. Rollback: `dist` rilis sebelumnya (tag rollback skrip). Tidak ada migrasi/data yang dibalik.
