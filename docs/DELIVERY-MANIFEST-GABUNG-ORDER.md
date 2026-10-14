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
| Driver tidak bisa menyelesaikan bila ada unit belum dikonfirmasi | gerbang di `POST /jobs/:id/complete` → 409 `UNIT_BELUM_DIKONFIRMASI`; **aktif bila `DELIVERY_UNIT_CONFIRM_REQUIRED=1`** (default MATI sampai app driver mengirim konfirmasi) |
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

## 5. Audit produksi baca-saja — Indra (14 Okt 2026)

Dijalankan lewat `psql` dengan `default_transaction_read_only=on`; tidak ada perubahan.

| | NEW-11102026-023 (resmi) | NEW-01092026-001 (manual) |
|---|---|---|
| Dibuat | 11 Okt 2026 | **1 Sep 2026** (40 hari SEBELUM PKR) |
| PKR | PKR-11102026-005, penjual **Kemal** | bukan PKR |
| Unit | 3 (U1–U3, READY_FOR_DELIVERY) | 1 (merk "Sano", "Ukuran Custom", DELIVERED) |
| Nilai / bayar | Rp0 di CRM · 0 payment · BELUM_BAYAR | Rp1.100.000 · 1 payment TRANSFER 8 Sep · **LUNAS** |
| Job | 1 DELIVERY SCHEDULED, ada rute | 1 **PICKUP** COMPLETED 3–4 Sep, ada rute, 0 foto bukti |
| Catatan | "Rangka: …, alamat blm ada" | "Sales : Kemal — Dikirim 2 Sep" |

Customer Indra: `assignedSales` = **Rifki** (pemilik lead), 2 order total.

**Kesimpulan:** NEW-01092026-001 **bukan** workaround/duplikat dari PKR Oktober — transaksi terpisah lebih awal (1 unit, merk
Sano, LUNAS Rp1,1 jt, job PICKUP). Mesin penggabungan akan memblokirnya sendiri (bukti barang serupa tidak terpenuhi → `BUKTI_KURANG`)
dan menampilkan peringatan "dibuat 40 hari sebelum order resmi" + "job duplikat hanya PICKUP". **Jangan terapkan penggabungan Indra
sebelum Owner memastikan ada order duplikat yang sebenarnya.** Fix tampilan Delivery (manifest 3 unit) berdiri sendiri — tidak butuh
penggabungan.

### Rifki vs Kemal
* "Rifki" pada kolom Sales = `Customer.assignedSales` (pemilik lead customer Indra), bukan penjual transaksi.
* Untuk order PKR kini yang tampil **"Dijual oleh Kemal"**; PIC Delivery tidak pernah disebut "Sales".

## 6. Risiko & rollback

* 2 migrasi **aditif** (`20261115090000_job_unit_loads`, `20261115100000_order_merge`): 1 tabel kosong, 4 kolom NULL di `Order`, 1 buku append-only. Tanpa backfill.
* Gerbang muat unit **default mati** (env `DELIVERY_UNIT_CONFIRM_REQUIRED`) → tidak ada perubahan perilaku driver sampai dinyalakan.
* Rollback kode: jalankan `scripts/rollback-guard-delivery-manifest.sh` (baca-saja). Menolak bila sudah ada `order_merges`/`job_unit_loads`
  (kode lama akan menampilkan order digabung sebagai pesanan aktif kedua). Migrasi dibiarkan terpasang.
* Skrip rilis fail-closed (release-dir, backup + restore-verify, pemindai DDL) **belum dibuat** — wajib dibuat sebelum deploy.
* Aplikasi RN driver (driver-mobile/delivery-control) belum diubah: payload manifest sudah tersedia, tetapi tampilan RN dan
  pengiriman konfirmasi muat menyusul sebelum gerbang dinyalakan.

## 7. Tes
* `backend/tests/deliveryManifest.test.js` (10) — builder murni.
* `backend/tests/integration/deliveryManifestGabung.integration.test.js` (10) — PostgreSQL sungguhan.
* `frontend/tests/deliveryManifestGabungUI.test.js` (7).
* QA browser 1440/390 terang/gelap pada DB lokal (bukan produksi).
