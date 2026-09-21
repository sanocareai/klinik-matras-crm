# Finance Mobile 1.0.0 — Protokol Pilot Internal dan Release Acceptance

**Status: pilot BELUM DIMULAI.** Pilot butuh perangkat fisik, pengguna Finance/Owner sungguhan, dan minimal 3 hari kerja transaksi nyata; itu tidak bisa dikerjakan dari sisi pengembang/otomasi. Dokumen ini adalah protokol, lembar catat, dan alat verifikasi server. **1.0.0 tetap "kandidat rilis internal" — bukan APPROVED — sampai kriteria §6 terpenuhi dan penanggung jawab menandatangani §8.** Tidak ada fitur baru selama pilot; hanya perbaikan P0/P1.

## 1. Artefak yang diuji

| Item | Nilai |
|---|---|
| APK internal | `production-apk`, build ID `b66adce0-97cc-4da8-91ad-5dba59af7f4b`, versi **1.0.0**, build number **2**, commit `8a9a4248` |
| Tautan | https://expo.dev/artifacts/eas/Ke0Wcmvk7_lQ7DgXYN4H59fYDMwuOAxzMF-nkUSdc0Y.apk |
| Paket yang HARUS terpasang | `com.sanomatrassehat.finance` (**production**). Bukan `.preview` (baca-saja) dan bukan `.dev` |
| Server | `https://app.sanomatrassehat.com/api` (backend commit `8a9a4248`+; migrasi `20260921120000` terapkan) |
| Push | **OFF** (`EXPO_PUBLIC_PUSH_ENABLED=false`, `FINANCE_PUSH_ENABLED` tidak diset). Tidak boleh dinyalakan selama pilot |

Verifikasi paket setelah pasang (USB debugging, tiap perangkat):
```
adb shell pm list packages | grep sanomatrassehat.finance     # harus com.sanomatrassehat.finance (tanpa .preview/.dev)
adb shell dumpsys package com.sanomatrassehat.finance | grep -E "versionName|versionCode"   # 1.0.0 / 2
```
Di aplikasi: Lainnya → baris bawah harus "SANO Finance 1.0.0 · production" dan **tidak** ada banner "Build preview hanya untuk pengujian baca". Bila banner itu muncul, itu build preview — hentikan dan pasang ulang.

Cabut/hapus build preview/dev dari perangkat pilot agar tidak tertukar.

## 2. Perangkat dan peran

| Perangkat | Wajib | Catatan |
|---|---|---|
| Samsung S25 Ultra | ✔ | Uji layar besar, biometrik, gestur, mode gelap, font besar |
| Android lama (mis. Android 9–10, RAM ≤ 3 GB) | ✔ minimal 1 | Uji performa, memori, cold start, layar kecil |
| Peran | Akun | Yang dicek |
|---|---|---|
| OWNER | akun owner sungguhan | semua layar; keputusan; pembatalan admin |
| FINANCE | akun finance sungguhan | verifikasi pembayaran, mencatat, mengajukan |
| ACCOUNTANT | akun akuntan | baca + mencatat; tidak boleh memutuskan/verifikasi |
| APPROVER | akun penyetuju | hanya memutuskan; tidak mencatat |
Capability yang tampil harus sama dengan server (`GET /api/mobile/auth/me`) untuk tiap peran; menu/tombol yang tidak diizinkan tidak muncul atau nonaktif dengan alasan dari server.

## 3. Tahap 1 — Read-only (hari 1; tanpa menekan tombol yang mengubah data)

Catat lulus/gagal per baris di lembar §7. Screenshot dari build production akan **hitam** (FLAG_SECURE, disengaja) — gunakan foto layar dengan kamera lain atau `adb shell uiautomator dump` untuk teks; jangan matikan FLAG_SECURE.

| # | Area | Langkah | Hasil benar |
|---|---|---|---|
| R1 | Login | Masuk dengan akun sendiri | Masuk; buat PIN 6 digit |
| R2 | PIN & biometrik | Tawaran biometrik → aktifkan; kunci lalu buka dengan biometrik dan PIN; salah PIN 5× | Terbuka benar; salah PIN → jeda, bukan crash |
| R3 | App lock | Background 1 mnt, 5 mnt, tekan Recents | Terkunci sesuai batas; Recents tidak menampilkan isi |
| R4 | Refresh token | Biarkan terbuka > 15 mnt lalu pindah layar | Tetap masuk, tidak diminta login |
| R5 | Logout | Keluar; masuk lagi | Sesi cabut; PIN direset; tidak ada data lama |
| R6 | Beranda | Buka; tarik untuk segarkan | Angka sama dengan dashboard web pada periode sama; "Diperbarui …" |
| R7 | Persetujuan | Buka daftar + satu detail (tanpa memutuskan) | Sama dengan web; tombol keputusan hanya utk yang berhak |
| R8 | Pembayaran | Daftar + satu detail (tanpa verifikasi) | Sama dengan web |
| R9 | Transaksi | Buka SEMUA 9 modul: Pengeluaran, Pembelian, Kasbon, Pemasukan, Piutang, Refund, Supplier, Tagihan, Pembayaran Supplier — daftar + satu detail tiap modul | Tidak crash/kosong; status sama dengan web |
| R10 | Jurnal | Filter, cari, buka satu jurnal | total D/K sama dengan web; ada indikator seimbang |
| R11 | Buku Besar | Pilih akun Bank, bulan berjalan dan "Tahun lalu" | saldo awal/akhir/berjalan **identik** dengan web (`/reports/ledger`) |
| R12 | Rekonsiliasi | Buka daftar + detail (tanpa mencocokkan) | saldo buku/statement/selisih sama dengan web |
| R13 | Laporan | 6 laporan × periode bulan ini/lalu/tahun lalu | Angka identik dengan halaman laporan web periode sama; Neraca menampilkan selisih + laba/rugi tahun berjalan |
| R14 | Tampilan | Gelap/terang; Sembunyikan angka; font sistem 1,5× dan terbesar | Tidak ada teks terpotong/bertumpuk; nominal panjang/negatif utuh |
| R15 | TalkBack | Nyalakan TalkBack; jalankan R6–R13 | Setiap tombol/angka terbaca bermakna; urutan fokus wajar |
| R16 | Offline | Mode pesawat → buka daftar & detail; coba tombol aksi | Banner offline; data terakhir tampil; tombol aksi nonaktif; tidak ada yang terkirim |
| R17 | Jaringan lambat | Throttle (Developer options / jaringan buruk) | Skeleton/loading, bukan blank; timeout → pesan + coba lagi |
| R18 | Background-resume | Buka detail, ke aplikasi lain 2 mnt, kembali; ulang di tengah form | Kembali ke layar yang sama; isian form utuh setelah PIN |
| R19 | Sesi 30 menit | Pemakaian terus-menerus/bergantian 30 mnt | Tanpa crash, tanpa lag berat, memori stabil (`adb shell dumpsys meminfo com.sanomatrassehat.finance` awal vs akhir) |
| R20 | Izin & log | Cek izin yang diminta app; `adb logcat` selama R1–R19 | Hanya kamera (saat dipakai) — tanpa notifikasi/lokasi/mikrofon; log **tanpa** token, PIN, nominal, nama, bukti |

Cek log (jalankan sambil memakai app; hasilnya harus kosong):
```
adb logcat -d | grep -iE "eyJ|Bearer|refresh|password|\"pin\"|Rp ?[0-9]" | grep -i sanomatrassehat
```

## 4. Tahap 2 — Operasional (hari 2–3+; hanya transaksi NYATA)

Aturan keras: **tidak membuat transaksi/jurnal QA palsu.** Hanya aksi yang memang terjadi di bisnis hari itu. Jangan menyentuh JV-19092026-372, akun 2-1600, atau kalibrasi.

Sebelum tiap hari: ambil **snapshot baseline** (§5). Sesudah tiap aksi nyata: cocokkan lima hal — status mobile, status web, jurnal (nomor/sumber/D=K), saldo rekening, dan Neraca.

| # | Workflow nyata | Yang dicek |
|---|---|---|
| O1 | **Draft → submit → approval → posting** satu dokumen nyata (mis. pengeluaran/pembelian yang memang harus dicatat) | Draf tersimpan; ajukan; muncul di Persetujuan penyetuju; setujui (step-up PIN); jurnal terposting **sekali**; status sama di web |
| O2 | **Double-tap**: pada aksi nyata O1 (ajukan/setujui/bayar), ketuk tombol konfirmasi dua kali cepat | Hanya SATU dokumen/jurnal/pembayaran; tidak ada jurnal ganda (`pilot-snapshot` memeriksa) |
| O3 | **Satu lampiran nota/bukti** pada dokumen nyata | Foto terunggah; tampil di web lewat URL bertanda-tangan; nota wajib terpenuhi |
| O4 | **Satu pembayaran** nyata (pembayaran pelanggan diverifikasi, atau bayar reimbursement/tagihan) | Saldo rekening berubah persis sebesar nominal; jurnal Dr/Cr benar; status LUNAS/DIBAYAR di web |
| O5 | **Satu dokumen ditolak** — hanya bila memang ada yang layak ditolak | Alasan tercatat; pengaju melihat status; tidak ada jurnal (atau dibalik bila sudah ada) |
| O6 | Pencocokan bank (hanya bila ada mutasi nyata yang siap dicocokkan) | Status COCOK di mobile & web; lepas hanya bila salah |
| O7 | Capability per peran | ACCOUNTANT tidak bisa memutuskan/verifikasi; APPROVER tidak bisa mencatat; OWNER bisa membatalkan; sesuai server |
| O8 | Kondisi sulit nyata: jaringan putus di tengah aksi | Pesan "status belum pasti"; muat ulang; tidak ada dokumen ganda saat sambungan kembali |

**Akhir hari pilot:** jalankan rekonsiliasi (§5), lalu cocokkan **saldo Kas & Bank** dengan saldo riil bank/kas menurut kebijakan akurasi Finance (saldo riil = kontrol; boleh negatif; koreksi hanya lewat jurnal resmi — bukan lewat pilot).

## 5. Alat verifikasi server (read-only)

`backend/scripts/pilot-snapshot.mjs` — tidak menulis apa pun. Baseline saat protokol dibuat: `docs/pilot/baseline-20260921.json` (21 Sep 2026 02:01 UTC: Neraca seimbang di semua tanggal kunci; JV-19092026-372 sidik jari `4fcf15d4caffab95`, status POSTED; 2-1600 terakhir JV-11022026-191; saldo KEM −12.351.254, PT Sano 29.870.615, Kas 104.500).

Awal hari (baseline baru bila diinginkan):
```
ssh ubuntu@43.133.152.6 "cd ~/klinik-matras && docker compose exec -T backend node --input-type=module -" < backend/scripts/pilot-snapshot.mjs | grep ^SNAPSHOT_JSON= | sed 's/^SNAPSHOT_JSON=//' > docs/pilot/baseline-<tanggal>.json
```
Akhir hari (rekonsiliasi terhadap baseline):
```
ssh ubuntu@43.133.152.6 "cd ~/klinik-matras && docker compose exec -T backend sh -c 'cat > /tmp/base.json'" < docs/pilot/baseline-<tanggal>.json
ssh ubuntu@43.133.152.6 "cd ~/klinik-matras && docker compose exec -T -e PILOT_BASELINE=/tmp/base.json backend node --input-type=module -" < backend/scripts/pilot-snapshot.mjs
```
Keluaran `LAPORAN_JSON`: `hasil` LULUS/GAGAL; daftar jurnal baru (nomor, sumber, dokumen, pembuat); **rekonsiliasi per rekening** (saldo awal + mutasi jurnal = saldo seharusnya vs saldo sekarang); temuan otomatis P0 bila: Neraca tidak seimbang, JV-372 berubah, ada jurnal baru di 2-1600, jurnal tidak seimbang, jurnal ganda / idempotencyKey ganda, saldo berubah tanpa jurnal. Setiap jurnal baru harus bisa ditelusuri ke satu transaksi nyata yang dicatat di lembar §7. **Jurnal baru dari operasi bisnis lain (mis. pengakuan pendapatan otomatis) tampil di daftar** — tandai sebagai "bukan dari mobile" di lembar; itu bukan temuan.

## 6. Kriteria acceptance (semua harus terpenuhi)

1. ≥ 3 hari kerja **atau** semua workflow kritis (O1–O5) sudah terpakai nyata.
2. Tidak ada P0/P1 terbuka.
3. Tidak ada crash berulang (satu crash unik = P2 sampai terbukti berulang).
4. Tidak ada jurnal ganda (`pilot-snapshot` hasil LULUS setiap akhir hari).
5. Neraca seimbang (semua tanggal kunci + hari itu).
6. Saldo berubah **hanya** karena transaksi resmi (rekonsiliasi selisih 0 di semua rekening).
7. Capability tiap peran sama dengan server (O7).
8. Semua temuan tercatat dengan severity, langkah reproduksi, perangkat, foto bila mungkin, dan keputusan fix/defer.

Definisi severity: **P0** kehilangan/salah uang, jurnal ganda/tidak seimbang, kebocoran data sensitif, tidak bisa masuk sama sekali. **P1** workflow kritis tidak bisa dipakai, crash berulang, capability salah, data tidak sama dengan web. **P2** cacat tampilan/UX/performa yang ada jalan lain. **P3** kosmetik.

## 7. Lembar catat temuan (salin per temuan)

```
ID: PIL-001            Severity: P0/P1/P2/P3      Tanggal/jam (WIB):
Perangkat + Android:                              Peran/akun:            Versi/build: 1.0.0 / 2
Layar/langkah:
Langkah reproduksi:
  1.
Hasil aktual:                                     Hasil diharapkan:
Bukti (foto layar/rekaman/logcat tanpa data sensitif):
Dokumen/jurnal terkait (nomor):
Keputusan:  FIX v1.0.0 (P0/P1) | DEFER v1.0.1 | DEFER v1.1 | TIDAK MASALAH      Pemilik:        Status:
```
Lembar hasil per uji Tahap 1 (R1–R20) dan Tahap 2 (O1–O8): kolom `#`, perangkat, peran, lulus/gagal, ID temuan, catatan.

## 8. Keputusan rilis (diisi setelah pilot)

- [ ] Kriteria §6 terpenuhi. Penanggung jawab: __________ Tanggal: __________
- **Jika lulus:** tandai `1.0.0 APPROVED FOR INTERNAL USE`; buat tag Git (`git tag -a finance-mobile-v1.0.0 -m "…" <commit>` lalu `git push origin finance-mobile-v1.0.0`); distribusikan APK **hanya** ke tim Finance/Owner terkait; AAB **tidak** dipublikasikan ke publik; EAS Update production **tidak** dipublikasikan bila tidak ada perubahan JS; push tetap OFF sampai Firebase/FCM siap.
- **Jika ada P0/P1:** hentikan pilot → rollback sesuai `docs/FINANCE-MOBILE-RELEASE-1.0.md` §5 (tarik APK; cabut sesi bila perlu; `FINANCE_PUSH_ENABLED` tetap off; backend `git revert` bila akar masalahnya di server) → perbaiki → jalankan seluruh suite → build ulang (`version` naik bila native berubah) → ulangi pilot untuk area yang terdampak.
- **Jika hanya P2/P3:** catat untuk v1.0.1/v1.1; lanjut.

## 9. Kesiapan rollback (diverifikasi sebelum pilot)

| Item | Kesiapan |
|---|---|
| Build sebelumnya tersimpan di EAS (0.2.0 preview #4; 1.0.0 build 2/3) | ✔ |
| Backend dapat digulung: `git revert` + `docker compose up -d --build backend`; migrasi aditif aman dibiarkan | ✔ (terdokumentasi) |
| Push dapat dimatikan seketika (tidak diset di server) | ✔ (sudah OFF) |
| Cabut sesi pengguna/perangkat (`revoke-user`, keluar dari perangkat) | ✔ |
| Snapshot baseline & alat rekonsiliasi read-only | ✔ (`docs/pilot/baseline-20260921.json`, `backend/scripts/pilot-snapshot.mjs`; dijalankan terhadap produksi tanpa perubahan) |
| Keputusan rollback hanya oleh penanggung jawab pilot; koreksi uang **tidak** lewat rollback aplikasi, melainkan jurnal resmi | ✔ |
