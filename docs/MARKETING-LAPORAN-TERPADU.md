# Laporan → Marketing (menggantikan Traffic + Akuisisi + Iklan)

Branch `feat/marketing-tab-terpadu`, dasar = live `382027ef` (memuat laporan Meta MCP `e89bb0ea`). Hanya frontend; tidak ada perubahan backend, migrasi, env, atau data.

## Navigasi
Tab Laporan: Ringkasan | Sales | **Marketing** | Performa Tim | Pipeline.
Marketing: ringkasan semua sumber → klik sumber → detail sumber → (Meta) campaign → ad set → ad. Breadcrumb + tombol Back browser; periode, urutan, kolom, banding, sumber, level/campaign/adset, peringkat, umur tersimpan di URL (`?tab=Marketing&dari&sampai&sumber&urut&kolom&banding&level&campaign&adset&rank&umur`; nilai bawaan tidak ditulis).
URL lama: `?tab=Traffic` → Marketing; `?tab=Akuisisi[&sumber=X]` → Marketing[&sumber=X]; `?tab=Iklan` → Marketing&sumber=META. Periode dipertahankan; URL dikanonikalkan sekali (replace).

## Peta fitur lama → baru
| Lama | Posisi baru |
|---|---|
| Traffic · Total Lead Masuk | Kartu "Total lead (termasuk spam)" (service /sumber) + butir rekonsiliasi di Kualitas data |
| Traffic · Rata-rata/hari, Hari tidak normal, Jam tersibuk, Respons rata-rata | Marketing → "Pola lead & respons" (dapat dibuka) |
| Traffic · Tren harian + pita baseline | Grafik "Tren lead harian" (di ringkasan) |
| Traffic · Peta hari × jam, Jam tersibuk, Jam rawan | Pola lead & respons |
| Traffic · Atribusi sumber (%), peringatan rendah, antrean konfirmasi WhatsApp | Kualitas data (butir "Sumber lead diketahui" + tautan daftar) |
| Traffic · Sumber Lead (bar + tautan daftar customer) | Tabel semua sumber; detail sumber → "Daftar customer sumber ini" |
| Traffic · Performa per Platform (legacy CPA/ROAS/Nilai per lead) | Detail sumber → "Kreatif & tautan (basis label CRM)" (RincianKreatif, sumber terisi awal) |
| Traffic · Rincian per Iklan (kreatif/tautan) | Idem |
| Traffic · Export XLSX | Tombol "Export Marketing": sheet baru Marketing + Meta CTWA (= layar); sheet Traffic dan Rincian Iklan dipertahankan sebagai "(legacy)" berlabel |
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

## Label lead (satu istilah = satu penyebut)
| Tampilan | Penyebut / basis | Termasuk spam? |
|---|---|---|
| Kartu & tabel "Total lead (termasuk spam)" (label CRM, `/atribusi/iklan/sumber`) | customer baru dibuat di periode (WIB), tanpa B2B/penjualan karyawan | ya |
| "Lead sah" (sub-kartu, kolom lengkap) | total lead − spam − staf internal/profil karyawan | tidak |
| Konversi utama | ber-order ÷ **total lead (termasuk spam)**; konversi non-spam kolom terpisah | — |
| "Tren lead harian (tanpa spam)", "Pola lead & respons", "Volume lead (tanpa spam)" (`/analytics/traffic`) | customer dibuat di periode, **tanpa spam** dan tanpa B2B/penjualan karyawan | tidak |
| Detail Meta "Lead CTWA terbukti (termasuk spam)" (`/atribusi/iklan`) | customer baru dengan touch CTWA pertama terbukti per Ad ID — **bukan label CRM** | ya |
Setiap detail memisahkan "Ringkasan label CRM" dari "atribusi CTWA terbukti — bukan label CRM".

## Ekspor (CSV dan XLSX = layar)
- **CSV sumber** (`marketing-sumber-<dari>_<sampai>.csv`): periode, evaluasi pembayaran sampai (cutoff server), dasar sumber, basis laporan, urutan yang terlihat; baris dalam urutan layar; null = sel kosong + kolom alasan; kolom "Total lead (termasuk spam)".
- **CSV Meta** (`marketing-meta-<level>-…csv`): basis, dasar "Atribusi CTWA terbukti per Ad ID (bukan label CRM)", periode, cutoff = waktu hitung server (WIB), level, urutan; kolom "Lead CTWA terbukti (termasuk spam)"; UNMAPPED/UNKNOWN ikut (UNKNOWN tidak dikreditkan).
- **XLSX** ("Export Marketing"): sheet `Marketing` (laporan sumber = layar), `Meta CTWA` (campaign terbukti; bila laporan Meta belum termuat, ada catatan di sheet Marketing), lalu dua sheet **legacy** berlabel: `Traffic (legacy)` ("TRAFFIC LEAD (LEGACY — TANPA SPAM)") dan `Rincian Iklan (legacy)` ("BASIS LABEL CRM"). null → "—" (bukan 0); 0 nyata tetap 0. Tombol ekspor menolak bila laporan belum termuat.

## Navigasi, request, dan riwayat
- Permintaan basi dibuang: tiap pemuatan (sumber, Meta, traffic Laporan) memakai token "terbaru menang"; angka periode lama tidak tampil di bawah banner periode baru; antrean `berurutan()` melewati pekerjaan basi (tidak dikirim, tidak diulang) sehingga tidak menumpuk. 429: maksimal 4 percobaan (jeda 1,2 → 2,4 → 3,6 dtk), lalu pesan galat + "Coba lagi"; tidak ada loop.
- Riwayat per tab shell: entri riwayat yang dibuat/ditempati Laporan diberi `tabShellId`. Back/Forward hanya menyinkronkan entri milik tab itu; entri tab Laporan lain mengaktifkan tab pemiliknya (tidak menimpa tab aktif). Efek yang memanggil `replaceActivePath` (menulis ke tab AKTIF) hanya jalan bila tab Laporan itu yang aktif (kanonikalisasi URL lama, popstate).

## Validasi (30 Okt 2026)
Harness: `frontend/qa-harness/` — `marketing-server.mjs` (fixture), `marketing-prodcopy-server.mjs` (SALINAN backup produksi), `marketing-rekon-salinan-db.cjs`, `marketing-rekon-api.cjs`, `marketing-browser-salinan.cjs` (API↔layar↔CSV↔XLSX↔DB), `marketing-navigasi.cjs` (navigasi), `marketing-browser.cjs` (regresi 64 pemeriksaan, fixture), `serve-dist.mjs` (menyajikan dist hasil build).
- Tes logika frontend: `tests/marketingLogic|marketingEkspor|marketingData|periodeLaporan|akuisisiLogic|biayaIklanLogic.test.js`.
- Navigasi (37 pemeriksaan, dev server DAN dist hasil build): URL langsung ke level Ad + refresh; Back/Forward dalam Marketing; Back/Forward dari tab shell lain; dua tab Laporan berstate berbeda; URL lama di tab background; ganti periode saat request berjalan; hasil lama tidak menimpa; 429 terbatas.
- Rekonsiliasi pada salinan backup produksi (`pre-laporan-produksi-66c8beef-20261030_135646.sql.gz`, sha256 cocok, dipulihkan ke DB lokal `km_prodcopy_20261030_test`; produksi tidak ditulis): 3 periode × 41 pemeriksaan.

## Rilis & rollback (belum dilakukan)
Frontend-saja: `scripts/release-marketing-tab.sh` (dibangkitkan `scripts/gen-release-marketing-tab.cjs --base <BASELINE_LIVE>`; JANGAN edit manual). Gerbang: identitas kode live (isi, bukan marker), allowlist, **audit perubahan frontend** (daftar berkas, tepat 3 tab lama dihapus, sidik jari diff `frontend/`), backend/compose identik, build di release dir baru, uji logika pada arsip kandidat, bundel baru memuat tampilan baru + bundel lama kehilangan teks tab lama + fitur live tetap ada, aset lama dibawa, switch dist saja (image sama), smoke URL lama/baru + endpoint Marketing (401) + aset, `.env`/hitungan data identik, RestartCount=0. Mode: `--preflight-only`, `--build-only`, rilis penuh, `--rollback` (kembali ke folder release baseline, image sama). Tidak ada migrasi/data yang dibalik.
