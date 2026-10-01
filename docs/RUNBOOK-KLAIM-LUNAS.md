# Runbook — Gerbang Klaim Lunas (rollout, aktivasi, troubleshooting)

Ringkasan perilaku: lihat CLAUDE.md §21. Dokumen ini hanya langkah kerja.

## 1. Prasyarat sebelum AKTIF (semua harus benar)
- [ ] Web baru terlayani (bundel publik memuat "Ajukan Klaim Lunas"; kartu "Gerbang Klaim Lunas" tampil di Finance > Pengaturan).
- [ ] OTA aplikasi Sales terbit di channel/branch **preview** runtime **3.3.0** dan terpasang di SEMUA HP Sales aktif (lihat §3).
- [ ] QA S25 Ultra lulus (§4) dengan backend & DB QA terisolasi.
- [ ] Di aplikasi baru: chip "Lunas" tidak ada, tombol "Ajukan Klaim Lunas" ada, upload bukti bekerja; Finance dapat membuka bukti.
- [ ] Rollback siap: kartu Pengaturan (kill switch), perintah rollback OTA, image rollback backend.

## 2. Aktivasi (satu kali, oleh Admin)
1. Backup baseline (jumlah & hash order/payment/alokasi/jurnal + nilai fin_settings) — skrip: snapshot di `scripts/release-klaim-lunas-gate.sh` (`SNAP_SQL`).
2. Finance > Pengaturan > **Gerbang Klaim Lunas** > Aktifkan > konfirmasi. (Audit tercatat otomatis.)
3. Verifikasi: `GET /api/klaim-lunas/status` → `{"aktif":true}`; snapshot baseline IDENTIK.
4. Smoke tanpa transaksi produksi: buka order di web & aplikasi (chip Lunas hilang, tombol klaim ada). Jangan membuat klaim/order/payment sungguhan.
5. Monitor 30 menit: `docker compose logs backend | grep -E " (409|422|500) "` dan log upload (`klaim-lunas`). 409 `PEMBAYARAN_SALES_LEWAT_KLAIM`/`LUNAS_HANYA_DARI_LEDGER` = klien lama atau kebiasaan lama (lihat §5), bukan galat sistem.

## 3. Memastikan semua HP Sales menerima OTA
- OTA diunduh saat aplikasi DIBUKA (cold start) lalu aktif otomatis (`reloadAsync`). HP yang tidak pernah dibuka belum menerima.
- Cek di HP: Profil > Cek Update (manual) — harus menyatakan sudah versi terbaru.
- Cek di server: log `GET /api/klaim-lunas/status` per pengguna (user-agent/token) — Sales yang BELUM memanggil endpoint ini setelah OTA terbit = belum menerima bundle baru.
- Perangkat dengan APK versi < 3.3.0 (runtime lain) TIDAK menerima OTA ini → wajib dipasang APK 3.3.0 dulu. Jangan aktifkan sakelar bila ada yang tersisa.

## 4. QA perangkat (aplikasi nyata)
Backend QA lokal terisolasi (DB `km_it_*_test`), aplikasi diarahkan ke server QA. Skenario: update terunduh & aktif setelah restart; draf tanpa bukti; foto kamera & galeri; PDF; upload gagal lalu coba lagi;
offline lalu reconnect; ajukan; Finance Minta Bukti; Tolak lalu ajukan ulang; tema terang/gelap; klien lama menerima 409 berbahasa Indonesia.

## 5. Troubleshooting aplikasi lama
| Gejala | Penyebab | Tindakan |
|---|---|---|
| Sales: "Pembayaran dari Sales tidak lagi dicatat langsung... Perbarui aplikasi" (409) | APK/OTA lama masih menampilkan form catat pembayaran | Buka aplikasi sampai OTA terunduh, restart; bila tetap, pasang APK 3.3.0 |
| Sales: "Status Lunas tidak bisa diisi langsung..." (409) | Klien lama / web ter-cache | Muat ulang web (Ctrl+F5); aplikasi: lihat baris di atas |
| Tombol "Ajukan Klaim Lunas" tidak muncul | Sakelar MATI, atau aplikasi belum OTA | Cek kartu Pengaturan; cek versi bundle |
| Unggah bukti gagal "Jenis berkas tidak diizinkan" | Berkas bukan JPG/PNG/WEBP/PDF (mis. HEIC) | Pilih/ambil ulang sebagai JPG |
| Unggah gagal 413 | > 8 MB | Kompres/foto ulang |
| Klaim "Bukti belum lengkap" pada order lama | Order ditandai Lunas cara lama tanpa Payment | Sales ajukan klaim berbukti; Finance verifikasi. Jangan buat Payment otomatis |
| Sales terlanjur terhambat massal | Aplikasi lama belum update | **Kill switch**: matikan sakelar (data tidak berubah), perbaiki OTA, ulangi aktivasi |

## 6. Rollback
- **Cepat (menit):** matikan sakelar di kartu Pengaturan.
- **OTA:** `cd mobile && npx eas update:rollback` (atau republish update sebelumnya) ke branch `preview`.
- **Backend:** `docker tag klinik-matras-backend:rollback-pre-klg-c2fbdcfe klinik-matras-backend:latest` lalu recreate backend dari release sebelumnya (instruksi lengkap dicetak skrip rilis). Database tidak perlu dipulihkan.
