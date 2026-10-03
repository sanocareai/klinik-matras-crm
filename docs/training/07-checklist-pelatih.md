# Checklist pelatih

## A. Sehari sebelum (30 menit)
- [ ] Jalankan dari root repo: `bash scripts/staging/audit-isolation.sh` → harus **AUDIT ISOLASI: LULUS** (jaringan internal, tanpa port publik, egress mati, DB production tak terjangkau).
- [ ] Bangun UI terbaru: `cd frontend && npx vite build` (staging melayani `frontend/dist`).
- [ ] Bangun ulang backend staging bila kode berubah: `docker compose -f docker-compose.staging.yml --env-file backend/.env.staging up -d --build`.
- [ ] **Reset + seed latihan** (selalu mulai bersih; satu sesi memakai data milik sesi itu):
  ```
  docker compose -f docker-compose.staging.yml --env-file backend/.env.staging exec -T backend-staging node scripts/staging/qa-pv2.js reset --yes
  docker compose -f docker-compose.staging.yml --env-file backend/.env.staging exec -T backend-staging node scripts/staging/qa-pv2.js training
  ```
- [ ] Cek 7 skenario: 9 unit `QA-PV2-U21…U29` ada (lihat `00-mulai-di-sini.md`).
- [ ] **Waktu kerja:** target tahap dihitung WIB 09.00–17.00. Latihan di luar jam itu menampilkan "terlambat" pada kartu — jelaskan ke peserta bahwa itu bukan kesalahan mereka.
- [ ] Cetak: runbook peran, checklist peran, `09-jika-terjadi-masalah.md`, `11-istilah.md`, lembar hasil (1 per peserta).

## B. Awal sesi (10 menit)
- [ ] Terbitkan password (tampil **SEKALI**, jangan difoto/dikirim lewat chat):
  `… exec -T backend-staging node scripts/staging/qa-pv2.js credentials [--role=lead,meja1]`
  Salin ke kertas/amplop per peserta, lalu tutup terminal. Menjalankan ulang membatalkan password lama.
- [ ] Akses: ikuti `12-akses-staging-latihan.md` (default: **hanya lokal**).
- [ ] Jelaskan 3 aturan: data fiktif · production tidak tersentuh · **berhenti bila layar menyuruh menunggu**.
- [ ] Pastikan peserta membuka alamat **staging** (header `X-Environment: staging`, data berawalan **QA-PV2**).

## C. Selama sesi
- [ ] Biarkan peserta mencoba **sendiri** 3 menit sebelum membantu. Catat setiap bantuan yang diberikan (kolom "perlu bantuan" di lembar hasil).
- [ ] Catat **salah klik**, **istilah yang membuat bingung**, dan **waktu** tiap tugas.
- [ ] Bedakan saat mencatat: **BUG PRODUK** (sistem salah/menyesatkan) vs **MASALAH SOP** (proses/tanggung jawab belum jelas) vs **PELATIHAN** (peserta belum paham).
- [ ] Uji **gangguan**: (a) revisi basi — dua orang jadwalkan unit sama; (b) meja penuh; (c) matikan sinyal Dokumenter; (d) QC menolak tanpa foto.
- [ ] Peserta **keluar lalu masuk lagi**: pekerjaan masih ada?

## D. Akhir sesi
- [ ] Isi nilai tiap peserta: **LULUS / PERLU PENDAMPINGAN / GAGAL-BLOCKER**.
- [ ] Kumpulkan lembar hasil → serahkan ke engineer (bug) dan Production Lead (SOP).
- [ ] **Reset staging** (`reset --yes`) bila sesi berikut butuh data baru; password sesi ini batal otomatis saat diterbitkan ulang.
- [ ] Pastikan **tidak ada** screenshot/foto layar berisi data pelanggan nyata (di staging hanya QA-PV2 — bila ada data nyata: **hentikan sesi & lapor**).

## E. Kapan menghentikan sesi
- Ada nama/telepon/alamat pelanggan **nyata** di layar.
- Peserta bisa melewati QC atau menyelesaikan tahap tanpa bukti (bypass) — catat langkah persisnya, kirim ke engineer.
- Aplikasi mengulang tindakan (data ganda) atau error 500 berulang.
