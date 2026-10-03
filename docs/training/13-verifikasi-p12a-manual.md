# Verifikasi manual P12A (Owner/Admin nyata + Samsung S25 Ultra fisik)

Dua pemeriksaan ini **belum dapat dilakukan engineer** (butuh login ADMIN/OWNER asli di production dan perangkat fisik). Kerjakan sekali; catat **LULUS / GAGAL** + foto layar. **Jangan menjadwalkan, menyeret, atau menyimpan data nyata** — yang diuji hanya **Mode Demo** (data fiktif, hanya-baca).

## A1. Mode Demo di production — Owner atau Admin asli (±5 menit, laptop)
1. Login → **Production Operations → Rencana Produksi**.
2. Di bar atas halaman: nyalakan **Lihat Data Demo**.
   - [ ] Banner oranye **"MODE DEMO — bukan data operasional"** tampil terus-menerus.
   - [ ] Halaman terisi **12 unit contoh** (nama berawalan **QA-PV2**), bukan data pelanggan Anda.
3. **Seret simulasi**: tahan ikon **⋮⋮** pada satu kartu *Belum Dijadwalkan* → seret ke **Meja 1** → lepas.
   - [ ] Kartu pindah + muncul pemberitahuan **"Simulasi Mode Demo … Tidak disimpan"**.
   - [ ] (Opsional, DevTools → Network) **tidak ada request POST/PUT/PATCH/DELETE** ke server.
4. **Muat ulang** halaman (F5).
   - [ ] Kartu kembali ke susunan awal (fixture).
5. Matikan **Lihat Data Demo** (atau buka halaman tanpa `?demo=1`).
   - [ ] Banner hilang, **data nyata** kembali, dan unit nyata **tidak berubah posisi**.
6. Pastikan **tidak ada** unit nyata yang ikut berpindah/berubah di Rencana Produksi.

## A2. Samsung S25 Ultra (fisik) — pakai Mode Demo juga (±10 menit)
Buka di Chrome HP **alamat production yang sama**, login Owner/Admin, **Rencana Produksi → nyalakan Lihat Data Demo**.
- [ ] **Gulir**: sentuh dan geser jari pada **badan kartu** (teks) → halaman menggulir normal, **tidak ada kartu pindah**.
- [ ] **Ketuk kartu** → Unit 360 terbuka.
- [ ] **Tahan lalu seret** lewat **⋮⋮**: ghost kartu mengikuti jari, garis biru/slot sorot, label tujuan terbaca; lepas di Meja → simulasi berhasil.
- [ ] **Ketuk ⋮⋮ saja** (tanpa menggeser) → **tidak** memindahkan apa pun.
- [ ] **Gulir otomatis**: seret ke dekat tepi bawah layar → halaman ikut menggulir.
- [ ] Teks kartu terbaca (nama customer besar; label tidak terpotong); **tidak ada overflow** horizontal.
- [ ] Muat ulang → fixture kembali.
Catat bila ada: gerakan jari yang salah terbaca (kartu pindah tanpa sengaja), handle sulit ditekan, teks terlalu kecil.

## A3. Untuk staging latihan di S25 (opsional, setelah A2)
Ikuti `12-akses-staging-latihan.md` (USB + `adb reverse`) dan jalankan satu skenario Dokumenter offline (S6) di HP.

**Bila ada yang GAGAL:** catat langkah, foto layar, versi Chrome HP. Perbaikan targeted dibuat di **branch terpisah** (bukan di branch training).
