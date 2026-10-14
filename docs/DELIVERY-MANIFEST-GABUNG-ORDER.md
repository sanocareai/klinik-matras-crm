# Manifest Delivery & Gabungkan Order Duplikat (14 Okt 2026)

Lanjutan dari live `049e3356`. Branch `feat/delivery-manifest`. **Belum di-merge/deploy. Data Indra belum diubah.**

## 1. Masalah & akar penyebab

Delivery menulis order multi-unit PKR Indra sebagai "Kasur • 100 × 200 cm" (satu kasur). Tiga angka berbeda dicampur:
**jumlah stop**, **jumlah unit**, **jumlah jenis produk**. Akarnya: kartu/pesan/sheet membaca *ringkasan tingkat order*
(`Order.quantity`, kategori, merk/ukuran dari `notes`), bukan unit yang benar-benar tertaut ke job (`JobUnit`).
Kolom "Sales" mengambil `Customer.assignedSales` (pemilik lead customer — Rifki), bukan penjual PKR (Kemal).

## 2. Kontrak manifest (satu sumber)

`backend/src/lib/domain/deliveryManifest.js` — fungsi murni `bangunManifest(job)`; hasilnya ditempel server ke **setiap** job pada
payload API Armada (`services/deliveryManifestAttach.js`), sehingga web, rute, pesan grup WA, sheet gambar, dan Driver App
memakai angka yang sama. **Tanpa harga/nilai/pembayaran.**

```
manifest = {
  stop: 1, unit: 3, jenisProduk: 1,
  ringkas: "1 stop • 3 unit • 1 jenis produk",
  baris: [{ qty: 3, nama, ukuran: "100 × 200 cm", spesifikasi, unitLabel: ["U1","U2","U3"], unit: [...], bundel? }],
  sumber: { jenis: "PENJUALAN_KARYAWAN", penjual: "Kemal", label: "Penjualan Karyawan — dijual oleh Kemal" },
  tambahanBelumMasuk: [...],              // unit aktif order yang belum tertaut ke job DELIVERY mana pun
  muat: { dimuat, total, lengkap, label: "Barang dimuat 2/3 unit" },
}
```

Aturan: sumber = unit yang tertaut ke job (bukan ringkasan order); produk identik digabung ("3×"), beda produk = baris
terpisah; set/bundel menampilkan komponen fisik; layanan menampilkan nama layanan + unit customer; "1 stop" tidak pernah
dipakai sebagai jumlah barang.

## 3. Pengaman operasional

| Aturan | Implementasi |
|---|---|
| Progres muat "Barang dimuat 3/3 unit" | tabel `job_unit_loads` (unik per job+unit → klik ulang/replay tidak menggandakan); `POST /armada/jobs/:id/unit-load` |
| Driver tidak bisa menyelesaikan bila ada unit belum dikonfirmasi | gerbang di `POST /jobs/:id/complete` → 409 `UNIT_BELUM_DIKONFIRMASI`; **tiga mode lewat `DELIVERY_UNIT_CONFIRM_REQUIRED`: MATI (default) / `capable` / `strict`** — lihat bagian 8 |
| Pengecualian resmi | `pengecualianUnit.alasan` ≥ 5 huruf → dicatat `DeliveryExecutionEvent` aksi `UNIT_LOAD_EXCEPTION` tepat sekali (idempoten) |
| Replay tidak menggandakan unit/job | kunci unik + Idempotency-Key; diuji (tes 4, 5, 7, 8) |
| Tambahan pesanan sebelum Delivery mulai | masuk job gabungan lewat kebijakan owner yang ada; setelah rute jalan **tidak** disisipkan diam-diam — manifest menandai `tambahanBelumMasuk` |
| Pembatalan/koreksi tidak menghapus riwayat | manifest dibangun dari unit aktif; baris riwayat tetap di DB |

## 4. Gabungkan Order Duplikat (Admin)

Alur: pilih order utama → kandidat (customer/HP sama, bukan PKR) → pratinjau (bukti, hambatan, peringatan, dampak) → alasan ≥ 5 →
gabungkan. Endpoint: `GET /orders/:id/kandidat-duplikat`, `GET /orders/gabung/pratinjau`, `POST /orders/gabung`
(`Idempotency-Key` wajib, sidik jari pratinjau sebagai revisi optimistik, kunci baris `FOR UPDATE`).

* **Relasi saja.** Tidak ada DELETE/pemindahan order, unit, job, route, POD, Payment, invoice, jurnal. Tidak membuat Unit/Job baru.
* Duplikat diberi `mergedIntoOrderId` + pelaku + alasan; buku `order_merges` append-only (trigger menolak UPDATE/DELETE) menyimpan before/after + bukti.
* **Bukti wajib lengkap:** customer/HP sama **dan** barang serupa **dan** konteks PKR. Nama sama saja = bukan bukti.
* Dua job aktif di kedua order → **diblokir** (409 `DUA_JOB_AKTIF`); job lain harus dibatalkan lewat alur resmi (alasan + audit) dulu.
* Daftar aktif CRM/Produksi/Delivery hanya menampilkan order utama; nomor lama pada pencarian membuka order utama;
  order lama tetap bisa dibuka (`?termasukDigabung=1`) dengan banner "Order ini telah digabungkan ke …"; order utama menampilkan
  "Histori dari order lama" (job/rute/POD lama tetap terbaca).
* KPI/omzet/analitik **tidak disentuh** (tidak ada angka yang berlipat atau berubah karena penggabungan).

## 5. Audit produksi baca-saja — Indra (14 Okt 2026) — KOREKSI

Dijalankan lewat `psql` dengan `default_transaction_read_only=on`; tidak ada perubahan.

**Dua order Indra adalah TRANSAKSI BERBEDA. Jangan digabungkan, disembunyikan, atau diubah datanya.**

| | NEW-11102026-023 (resmi) | NEW-01092026-001 (transaksi lain) |
|---|---|---|
| Dibuat | 11 Okt 2026 | 1 Sep 2026, 40 hari SEBELUM PKR |
| PKR | PKR-11102026-005, penjual **Kemal** | bukan PKR |
| Unit | 3 (U1–U3, READY_FOR_DELIVERY) | 1 (merk Sano, "Ukuran Custom", DELIVERED) |
| Nilai / bayar | Rp0 di CRM · 0 payment · BELUM_BAYAR | Rp1.100.000 · 1 payment TRANSFER 8 Sep · **LUNAS** |
| Job | 1 DELIVERY terjadwal, ada rute | 1 **PICKUP** selesai 3–4 Sep, ada rute |

Customer Indra: `assignedSales` = **Rifki** (PIC lead), 2 order total.

Keputusan: tidak ada penggabungan, tidak ada penyembunyian, tidak ada koreksi data untuk Indra. Perbaikan untuk Indra hanya TAMPILAN
(manifest 1 stop • 3 unit • 1 jenis produk; "dijual oleh Kemal"; Rifki hanya sebagai "PIC lead").

### Mesin Gabungkan Order Duplikat — dipertahankan hanya untuk bukti KUAT
* Kandidat hanya muncul bila customer/HP sama **dan** barang serupa **dan** konteks PKR (order utama PKR, duplikat bukan PKR). Order lain milik customer yang sama TIDAK ditawarkan.
* Kasus Indra nyata diuji (tes 11): bukan kandidat, pratinjau `bolehDigabung=false` (`BUKTI_KURANG`) + peringatan "dibuat 40 hari sebelum" dan "hanya PICKUP", POST ditolak 409, data identik sebelum/sesudah.
* Smoke rilis menjalankan dry-run baca-saja atas pasangan Indra dan mewajibkan hasil `bolehDigabung=false`.

### Rifki vs Kemal
"Rifki" = `Customer.assignedSales` (pemilik lead), bukan penjual transaksi. Order PKR: "Dijual oleh Kemal"; Rifki hanya boleh tampil berlabel "PIC lead".

## 6. Risiko & rollback

* 2 migrasi **aditif** (`20261115090000_job_unit_loads`, `20261115100000_order_merge`): 1 tabel kosong, 4 kolom NULL di `Order`, 1 buku append-only. Tanpa backfill.
* Gerbang muat unit **default mati** (env `DELIVERY_UNIT_CONFIRM_REQUIRED`) → tidak ada perubahan perilaku driver sampai dinyalakan.
* Rollback kode: jalankan `scripts/rollback-guard-delivery-manifest.sh` (baca-saja). Menolak bila sudah ada `order_merges`/`job_unit_loads`
  (kode lama akan menampilkan order digabung sebagai pesanan aktif kedua). Migrasi dibiarkan terpasang.
* Skrip rilis fail-closed dan aplikasi RN: lihat bagian 8 dan 9. Fitur operasional baru dianggap selesai setelah gerbang `strict` aktif.

## 7. Tes
* `backend/tests/deliveryManifest.test.js` (10) — builder murni.
* `backend/tests/integration/deliveryManifestGabung.integration.test.js` (11, termasuk kasus Indra nyata) — PostgreSQL sungguhan.
* `backend/tests/integration/deliveryUnitLoadGate.integration.test.js` (8) — mode MATI/KAPABEL/KETAT, 3/3, 2/3, pengecualian, klien lama vs baru, V2.
* `frontend/tests/deliveryManifestGabungUI.test.js` (7); `driver-mobile/src/lib/unitLoadOffline.test.js` (8, offline/replay/gerbang); `packages/delivery-shared/test/manifest.test.js` (2); `delivery-control` uiSource (1).
* QA browser 1440/390 terang/gelap pada DB lokal (bukan produksi).

## 8. Aplikasi RN (driver-mobile, delivery-control) dan jalur snapshot V2

* Backend: snapshot Driver V2 (`/armada/v2/me/snapshot`, jalur app RN) kini membawa unit lengkap + progres muat dan router V2 menempelkan manifest yang SAMA dengan `/armada/*` (tes integrasi: V1 = V2).
* **driver-mobile**: kartu job menampilkan manifest (qty, nama, ukuran, U1/U2/U3, sumber, PIC lead), checklist muat per unit / "Semua dimuat", form Selesai dengan alasan pengecualian, dan manifest per stop di Persiapan Perjalanan. Konfirmasi muat lewat antrean eksekusi offline (aksi `unit-load`): digabung per job, urut sebelum Selesai, idempoten di server, dibuang otomatis bila job sudah selesai.
* **delivery-control**: detail rute dan detail masalah menampilkan manifest dan progres muat (baca-saja) lewat modul bersama `@sano/delivery-shared`.
* Klien mengumumkan kemampuan dengan header `X-Capability: unit-load` (web dan driver-mobile baru).

### Rilis OTA RN — langkah dan gerbang versi
Kedua app memakai `runtimeVersion: appVersion`, jadi perubahan JS-only (tanpa modul native baru) dapat OTA ke versi terpasang yang sama:
1. Pastikan versi terpasang di HP: driver-mobile `1.0.0` (channel `production`), delivery-control `0.1.0` (channel `control-production`). Bila `app.json`/`app.config.js` versi diubah, OTA TIDAK menjangkau build lama — butuh APK baru.
2. Deploy server + web DULU (skrip `release-delivery-manifest.sh`); gerbang tetap MATI.
3. Terbitkan OTA setelah server live: `cd driver-mobile && eas update --channel production --message "manifest barang + checklist muat"`; `cd delivery-control && eas update --channel control-production --message "manifest barang di detail rute"`. Jangan OTA dari branch yang bukan hasil merge ke main.
4. Verifikasi di HP uji: kartu job menampilkan "1 stop • 3 unit • 1 jenis produk"; app sudah menarik update (restart sekali).
5. **Fitur operasional BELUM selesai selama gerbang masih MATI.** Selesai = mode `strict` aktif dan sinyal klien lama nol.

### Cara menyalakan gerbang dengan aman (env `DELIVERY_UNIT_CONFIRM_REQUIRED`)
| Nilai | Mode | Perilaku |
|---|---|---|
| kosong / `0` | MATI (default) | tidak ditegakkan |
| `capable` | KAPABEL | ditegakkan HANYA untuk klien ber-header `X-Capability: unit-load`; klien lama tetap bisa menyelesaikan dan tercatat `UNIT_LOAD_LEGACY_CLIENT` |
| `1` / `strict` | KETAT | ditegakkan untuk semua driver (klien lama akan terkunci) |

Urutan: (a) rilis server+web, (b) OTA RN, (c) set `capable` lalu recreate backend (`docker compose up -d --force-recreate backend` — env dibaca saat start), (d) pantau beberapa hari: `select count(*) from delivery_execution_events where action='UNIT_LOAD_LEGACY_CLIENT' and created_at > now() - interval '3 days'` harus 0 dan `UNIT_LOAD_EXCEPTION` wajar, (e) baru `strict`. Rollback gerbang: kosongkan env + recreate backend (data konfirmasi tetap). Cek status tanpa mengubah apa pun: `GET /api/armada/unit-load/config`.

## 9. Rilis
Skrip: `scripts/release-delivery-manifest.sh` (dibangkitkan dari template terbukti; pin 2 migrasi + diff schema.prisma, pemindai DDL + uji negatif, backup + restore nyata, rehearsal + uji perilaku constraint/trigger, build frontend di release dir, smoke baca-saja, guard rollback). Baseline WAJIB dicek ulang sebelum jalan (`--preflight-only` menolak bila release aktif bergeser).
