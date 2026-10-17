# Runbook — Admin override: Siap Kirim saat pencatatan produksi belum selesai

Berlaku untuk kandidat `feat/lepas-pengiriman-pengecualian-fisik`. Fitur ini adalah **keputusan Admin/Owner per unit**, bukan hasil pemeriksaan atau QC. Sistem tidak menyimpan atau
menampilkan klaim bahwa pemeriksaan fisik/QC terjadi, dan tidak membuat bukti QC, foto, serah terima Gudang, atau pergerakan stok.

## 1. Saklar (kill switch) — menghentikan override BARU

* Lokasi: **Pengaturan Produksi › Alur Kerja › "Admin override: Siap Kirim…"** (hanya Admin/Owner), atau API
  `PUT /api/production-v2/admin-override/switch { enabled, unitCodes?, reason }` (alasan ≥ 10 karakter wajib; tercatat sebagai aktivitas `PRODUCTION_SETTING_CHANGED` dengan pelaku).
* **Bawaan NONAKTIF (fail-closed)**: tanpa baris saklar, saklar mati, atau tabel flag tidak terbaca → override baru ditolak `409 ADMIN_OVERRIDE_DISABLED`.
* `unitCodes` (opsional) = daftar putih kanari: bila terisi, hanya unit itu yang boleh di-override (`409 ADMIN_OVERRIDE_UNIT_NOT_ALLOWED` untuk yang lain).
* Tanpa restart backend; dibaca dari database pada setiap permintaan. Berlaku seketika.
* **Yang TIDAK berubah saat saklar dimatikan**: unit yang sudah dilepas (tetap `READY_FOR_DELIVERY`), lokasi, Run, rekam audit, aktivitas, outbox, dan penutupan administratif Run
  (Konfirmasi Barang Jadi / Selesaikan Produksi). Replay kunci idempotensi lama tetap dijawab (bukan override baru).
* Darurat bila UI/API tidak bisa dipakai (backend sehat tetapi UI rusak): gunakan SQL berikut di server (satu pernyataan, baca-balik sesudahnya) — jangan edit `production_runs_v2`:

```sql
UPDATE v2_feature_flags SET enabled = false, reason = 'DARURAT: hentikan override baru — <alasan>', updated_at = now() WHERE key = 'production_admin_override_siap_kirim';
SELECT key, enabled, config, reason FROM v2_feature_flags WHERE key = 'production_admin_override_siap_kirim';
```

## 2. Laporan (baca-saja)

`GET /api/production-v2/admin-override/report` (Admin/Owner) atau kartu di halaman yang sama: semua Run yang pernah di-override, unit, order, lokasi pengambilan, pelaku, **job pengiriman, rute, driver**
dan **tindakan aman** per keadaan job.

## 3. Menangani job/rute yang telanjur terbentuk (tanpa rollback kode, tanpa mengubah unit, tanpa menghapus audit)

Rollback kode **ditolak** `rollback-guard-admin-override-siap-kirim.sh` begitu ada Run ter-override — jangan memaksanya. Tangani lewat alat Delivery yang sudah ada. Setiap langkah di bawah
hanya menyentuh **job/rute**; unit tetap `READY_FOR_DELIVERY`, rekam audit (`production_runs_v2.delivery_release`), aktivitas, dan outbox tidak dihapus/diubah (diuji di `adminOverrideSiapKirim.integration.test.js` P12–P13).

| Keadaan job (kode laporan) | Tindakan aman |
|---|---|
| `TANPA_JOB` | Tidak ada. Unit tetap Siap Kirim dan muncul sebagai kandidat biasa di Route Planner. |
| `TANPA_RUTE` | `DELETE /api/armada/jobs/:id` bila tidak jadi dikirim. Unit kembali kandidat biasa. |
| `RUTE_DRAFT` | `PATCH /api/armada/routes/:id/jobs { jobIds: [] }` (keluarkan job), lalu `DELETE /api/armada/jobs/:id`; atau hapus rute draf. |
| `RUTE_TERBIT_BELUM_JALAN` | `PATCH /api/armada/routes/:id/cancel`, lalu `DELETE /api/armada/jobs/:id` (hanya status UNSCHEDULED/SCHEDULED/ASSIGNED). **Beri tahu driver** (rute hilang dari app setelah sinkron). |
| `SEDANG_BERJALAN` (EN_ROUTE/ARRIVED) | **Jangan dihapus/dibatalkan dari sini** (server menolak). Biarkan driver menyelesaikan atau menandai gagal lewat app; tangani sesudahnya lewat alur gagal/jadwal ulang biasa. |
| `SELESAI` | Tidak ada. |
| `GAGAL_ATAU_DIJADWAL_ULANG` | Alur Kasus Reschedule biasa. |

Setelah job dihapus, unit kembali **kandidat biasa** (bukan "menunggu"): jadwalkan ulang normal lewat Route Planner → tepat satu job. Penutupan administratif Run **tidak** membuat job baru dan
**tidak** mengubah status unit.

## 4. Urutan aktivasi bertahap

1. **Rilis kode** dengan saklar **NONAKTIF** (bawaan). Dampak ke pengguna: tidak ada; dialog override menampilkan "belum diaktifkan".
2. **Driver siap** (lihat bagian 5) — jangan aktifkan sebelum ini.
3. **Aktifkan kanari** untuk satu unit (`unitCodes: ["<kode unit>"]`) hanya setelah Owner memverifikasi lokasi pengambilan dan dampak status di seluruh workspace (Sales, Delivery, Gudang, Produksi).
4. Evaluasi satu siklus (laporan + tampilan Route Planner/Driver), baru buka untuk unit lain atau semua.

## 5. Aplikasi Driver — jalur OTA (BELUM diterbitkan)

* Build distribusi terpasang memakai channel `preview`, runtime `1.0.0`; OTA mengikuti branch EAS `preview` (terakhir: "Checklist Persiapan Perjalanan + … selaras dgn main bc941feb + cherry-pick pembayaran driver dihilangkan").
* **JANGAN** menerbitkan OTA dari branch kandidat ini atau dari `main`: `driver-mobile` di sana masih memuat pencatatan pembayaran driver (`PaymentSection`), yang sengaja dihilangkan pada OTA yang berjalan.
  Terbukti: bundel dari `main` memuat "Catat Pembayaran", bundel dari branch OTA tidak.
* Sumber OTA yang aman: branch `ota/driver-override-siap-kirim-on-20261015` (basis `origin/release/ota-delivery-20261015` + 3 berkas: `jobHelpers.js`, `JobCard.js`, tes). Jalur: `eas update --branch preview --environment preview`, lalu
  buka app **dua kali** setelah tutup-paksa (cek `updateId` di layar Akun) di HP driver nyata. App lama tanpa pembaruan **tetap berfungsi** (field `overrideAdmin` diabaikan) tetapi tidak menampilkan penanda/lokasi pengambilan — karena itu saklar tetap nonaktif sampai driver diverifikasi.
