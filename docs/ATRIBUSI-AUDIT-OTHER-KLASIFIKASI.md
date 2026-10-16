# Audit "Other" CRM dan rancangan klasifikasi sumber lead yang dapat diaudit

Diukur baca-saja pada produksi **13 Okt 2026 14:13 WIB** (live `128b4b81`). Reproduksi: `backend/scripts/audit-sumber-lead.sql` (transaksi READ ONLY; hanya agregat).
Tidak ada data yang diubah. `Customer.leadSource` historis **tidak** diganti oleh pekerjaan ini.

Denominator: **customer unik** = satu baris `Customer` (satu nomor); **dengan order** = ≥ 1 order eligible (bukan CANCELLED/PENDING, bukan penjualan karyawan).
Periode: `createdAt` customer, hari WIB, 30 Jun 2026 (data tertua) s.d. 13 Okt 2026. Total 9.701 customer (787 spam, 8 staf internal, 416 dengan order).

## 1. Fakta (terukur) vs hipotesis

### Fakta

1. **Label literal `OTHER` hanya 30 customer (0,31% dari 9.701)** — bukan kolam besar. Rinciannya:

   | Kelas bukti (`leadSourceDetail` + riwayat pesan) | Customer | Dengan order | Spam | Staf |
   |---|---|---|---|---|
   | "Dimulai manual oleh sales dari CRM" (`POST /conversations/mulai-chat`) | 28 | 13 | 0 | 0 |
   | "Profil internal karyawan (Penjualan Karyawan)" | 2 | 0 | 0 | 2 |

   Dari 28 yang dimulai sales: 27 punya pesan pertama OUTBOUND (sales menghubungi duluan), 1 pesan pertama INBOUND; **0 punya `ctwa_clid`, 0 punya `ctwa_source_url`, 0 punya ClickEvent terkait.** Per bulan WIB: Agu 5, Sep 17, Okt 8 (6 sales + 2 profil karyawan).
   **Kesimpulan faktual: `OTHER` BUKAN Meta.** Tidak ada satu pun jejak iklan pada 30 customer itu.
2. **Label tidak punya riwayat.** `PATCH /api/customers/:id` menimpa `leadSource` dan menyetel `leadSourceConfirmed=true` tanpa mencatat nilai lama (tidak ada pemanggilan activity log di rute itu). Yang tetap utuh: `ctwa_clid` dan `ctwa_source_url` — hanya ditulis pada jalur *create* webhook, tidak pernah di-update. Customer yang dikonfirmasi manual: 32 (WA langsung 22, Meta 5, Other 3, B2B 1, Instagram 1, website 1); dari 5 berlabel Meta, 4 masih membawa bukti teknis asli.
3. **Satu penimpaan massal historis berbasis teks:** migrasi `20260630200001` memetakan `ADS→META_ADS` dan `WEBSITE→WEBSITE_ORGANIC`; backfill 13 Agt 2026 (`scripts/backfill-template-iklan.js`) menandai ±938 customer `META_ADS` dari **kecocokan teks pesan pertama** dengan template iklan (inferensi, bukan sinyal platform). Label asal (`WHATSAPP_DIRECT`) tidak disimpan, tetapi `leadSourceDetail` menandainya ("pola pesan"/"retroaktif"). Jalur live yang sama (Lapis 3b `templateIklan`) masih menetapkan label serupa untuk customer baru tanpa clid.
4. **Prioritas bukan penimpaan:** tag referral website (Lapis 0) dievaluasi sebelum CTWA, jadi 7 customer ber-`ctwa_clid` berlabel Instagram (5) / Google (2) **konsisten dengan** urutan prioritas pada saat create (hipotesis penyebab; belum diverifikasi per customer) dan bukan koreksi manual (fakta: 0 dari 7 `leadSourceConfirmed`). Webhook tidak pernah mengubah `leadSource` customer yang sudah ada.
5. **Ad ID per customer tidak pernah disimpan sebelum Fase 2.** Berkas capture Fase 0 (sejak 10 Okt 11:48 WIB, kedaluwarsa 7 hari) memuat `sourceID` tetapi tanpa customer ID. Maka kategori "CTWA dengan sourceID + referensi cocok" dan "sourceID ada tetapi UNMAPPED" **tidak dapat diukur historis** (bukan nol — tidak tersedia).
6. `ctwa_source_url` = URL kreatif/postingan (4.179 Instagram, 1.509 Facebook pada Meta ber-clid), **bukan Ad ID**; tidak dipakai menurunkan Ad ID.
7. CRM tidak punya kanal telepon: enum `Channel` hanya `WHATSAPP`, `INSTAGRAM`. Kategori "telepon" = tidak ada bukti yang bisa dikumpulkan saat ini.
8. Kolom `ctwa_clid` baru ada sejak 13 Agt 2026: tidak ada customer pra-13 Agt (2.342) yang punya clid.

### Hipotesis (belum terbukti; jangan dijadikan angka laporan)

- Sebagian "direct WA tanpa referral" (1.439) adalah klik iklan yang sinyalnya hilang (diukur pernah ada hari dengan cakupan 0% pada WAHA) — **tidak dapat dibuktikan** dari data yang ada.
- Sebagian `META_ADS` berbasis pola teks (1.322) mungkin bukan iklan (teks template bisa ditiru) — tidak dapat dibedakan tanpa sinyal platform.
- Customer ber-clid tanpa `sourceID` kemungkinan cocok ke salah satu dari 6 iklan yang sudah diverifikasi, **tetapi ini tidak boleh dipakai untuk mengisi Ad ID.**

## 2. Partisi seluruh customer menurut bukti (P1, urut dari bukti terkuat)

Satu customer tepat satu kategori. Kolom "tingkat pemetaan": **AD** = sampai Ad ID/ad set/campaign; **PLATFORM** = platform/source terbukti oleh sinyal teknis yang diterima server; **LEMAH** = inferensi atau indikasi tidak langsung; **TIDAK** = tidak dapat dibuktikan.

| Kode | Kategori (alasan) | Bukti yang menentukan | Customer | Dengan order | Spam | Tingkat |
|---|---|---|---|---|---|---|
| K1 | CTWA, sourceID + referensi cocok | `attribution_touches.ad_id` + `meta_ad_references` | tidak terukur | tidak terukur | — | AD (hanya ke depan) |
| K2 | CTWA, sourceID ada tetapi UNMAPPED | `attribution_touches` tanpa referensi | tidak terukur | tidak terukur | — | AD-ID saja |
| 30 | Sinyal iklan CTWA tanpa Ad ID valid | `Customer.ctwa_clid` terisi (clid lahir dari klik iklan) | **5.695** | **115** | 556 | PLATFORM (Meta) |
| 31 | Referral URL tanpa clid | `ctwa_source_url` terisi, clid kosong | 334 | 4 | 21 | LEMAH |
| 41 | Meta via pola teks (inferensi) | `leadSourceDetail` "Meta Ads - template…" | 1.322 | 40 | 76 | LEMAH |
| 42 | Meta, sinyal lain tanpa clid/URL | sisa `META_ADS` (retroaktif/conversionSource) | 51 | 3 | 4 | LEMAH |
| 50 | Iklan non-Meta via tag/tautan | label Google/TikTok dari tag ref atau TrackedLink | 312 | 18 | 33 | PLATFORM (tag diterima) |
| 60 | Website | tag website / teks tombol WA website | 370 | 38 | 18 | PLATFORM (tanpa campaign) |
| 61 | Channel lain (Instagram DM) | label `INSTAGRAM` (kelas ditetapkan dari label, bukan dari channel percakapan) | 119 | 6 | 3 | PLATFORM (channel) |
| 70 | Dimulai sales / input manual | detail "Dimulai manual oleh sales…" | 28 | 13 | 0 | TIDAK (bukan lead masuk) |
| 71 | Input manual dikonfirmasi | `leadSourceConfirmed = true`, tanpa bukti teknis | 22 | 18 | 0 | TIDAK (klaim manusia) |
| 80 | Direct WA tanpa referral | `WHATSAPP_DIRECT`, tanpa sinyal apa pun | **1.439** | **161** | 71 | TIDAK |
| 90 | Staf internal | `is_internal_staff` / `staff_user_id` | 8 | 0 | 5 | — (bukan lead) |
| 91 | B2B langsung | `B2B_DIRECT` | 1 | 0 | 0 | — |
| — | `TELEPON` | tidak ada kanal telepon | n/a | n/a | — | — |
| 99 | Unknown lain | tidak masuk aturan mana pun | 0 | 0 | 0 | — |
| | **Total** | | **9.701** | **416** | **787** | |

Penjumlahan kolom customer = 9.701 (rekonsiliasi lulus). Customer spam dengan order eligible = 0.

### Persentase pemetaan (denominator = 8.910 customer bukan spam, bukan staf, bukan B2B; dengan order = 416)

| Tingkat | Semua customer (8.910) | Customer dengan order (416) |
|---|---|---|
| Sampai **Ad** | 0 (0,0%) — historis tidak tersimpan | 0 (0,0%) |
| **Platform/source terbukti** (30, 50, 60, 61) | 5.139 + 279 + 352 + 116 = **5.886 (66,1%)** | 115 + 18 + 38 + 6 = **177 (42,5%)** |
| **Lemah/inferensi** (31, 41, 42) | 313 + 1.246 + 47 = 1.606 (18,0%) | 4 + 40 + 3 = 47 (11,3%) |
| **Manual / dimulai sales** (70, 71) | 50 (0,6%) | 31 (7,5%) |
| **Tidak dapat dibuktikan** (80) | 1.368 (15,4%) | 161 (38,7%) |

Spam 787 dan staf 8 ditampilkan terpisah (tidak masuk denominator). **Lead lama** (dibuat sebelum 13 Agt 2026, sebelum kolom clid ada) = 2.342 customer (bukan spam: kategori 41, 42, 50, 60, 61, 71, 80 saja); mereka **tidak pernah** dapat dipetakan melebihi tingkat LEMAH/PLATFORM-tag. Rincian per era ada pada keluaran P2 skrip audit.

Pengamatan (fakta): kategori **80 (direct WA tanpa referral)** memuat 161 dari 416 customer dengan order (38,7%), terbesar tunggal; sementara hanya 115 (27,6%) closing berasal dari sinyal CTWA ber-clid. Ini angka CRM yang ada, **bukan klaim bahwa 80 = organik**.

## 3. Bagaimana label saat ini ditetapkan (jejak kode)

| Label | Penetapan | Berkas |
|---|---|---|
| `META_ADS` | clid/penanda CTWA (Lapis 0b) > teks cocok TrackedLink (L1) > referral payload mentah (L2) > klik 15 menit global (L3, paling lemah) > pola teks template (L3b) | `routes/webhooks.js` 506–656 |
| `GOOGLE_ADS`/`TIKTOK_ADS`/`WEBSITE_ORGANIC`/`INSTAGRAM`/`REFERRAL` | tag ref website (L0) atau kategori TrackedLink | `services/leadAttribution.js` |
| `WHATSAPP_DIRECT` | default bila tak ada sinyal; juga customer yang dibuat oleh pesan **keluar** (sales chat dari HP) | `routes/webhooks.js` 906–915 |
| `OTHER` | `POST /customers` (default), `POST /conversations/mulai-chat`, profil karyawan (PKR), tag ref dengan sumber di luar daftar, kategori TrackedLink `OTHER` | `routes/customers.js`, `conversations.js`, `penjualanKaryawanOrder.js`, `leadAttribution.js` |
| manual | `PATCH /customers/:id` menimpa label + `leadSourceConfirmed=true` (tanpa riwayat) | `routes/customers.js` 525–531 |

## 4. Rancangan klasifikasi yang dapat diaudit (tanpa mengganti `leadSource`)

Prinsip: **klasifikasi turunan, bukan penimpaan.** Kelas dihitung dari bukti tersimpan pada waktu laporan; `leadSource` lama tetap apa adanya (ditampilkan berdampingan).

1. **Kelas asal** per customer = fungsi murni dari: `attribution_touches` (status NEW, evidence, Ad ID, pemetaan), `ctwa_clid`, `ctwa_source_url`, ClickEvent terkait, `leadSourceDetail` (hanya sebagai penanda jalur penetapan, bukan isi chat), `leadSourceConfirmed`, `Conversation.channel`, arah pesan pertama, dan flag spam/staf. Urutan = tabel §2.
2. **Tingkat pemetaan** (AD / PLATFORM / LEMAH / TIDAK) mengikuti kelas. Laporan campaign/ad hanya memakai **K1 (AD)**; kelas lain muncul sebagai baris "tidak terpetakan ke ad" dengan alasan, **tidak** digabung ke campaign mana pun.
3. **Kelas lemah tidak pernah "dinaikkan"** oleh kesamaan waktu, isi percakapan, atau kesamaan kreatif. Satu-satunya jalan naik tingkat: bukti baru yang tercatat (touch NEW dengan Ad ID, tag/klik terlacak, klaim manual berlabel).
4. **Buku besar reklasifikasi** (laporan, bukan tabel penimpa): bila kelas customer berubah antara dua pengukuran, wajib ada `bukti_baru_id` (touch/klik/klaim) dengan stempel waktu; perubahan tanpa bukti = pelanggaran invarian dan menggagalkan audit.

## 5. Sumber data eksplisit ke depan (usulan; belum dibangun)

| Sumber | Status | Catatan |
|---|---|---|
| Referral/`sourceID` webhook → `attribution_touches` (Fase 2) | **sudah dibangun**, flag OFF | status customer NEW/EXISTING/UNKNOWN berbukti kausal |
| URL/UTM yang benar-benar diterima server | sebagian ada | tag ref website (L0) dan `/r/` TrackedLink (ClickEvent). Usulan: simpan `utm_*` dari redirect `/r/` ke ClickEvent (kolom aditif) dan **uji end-to-end**: klik tautan uji → pesan WA ber-tag → webhook → customer berlabel + ClickEvent tertaut. Tanpa uji E2E hijau, kelas ini tidak dipakai. |
| Tautan WA berkode unik per klik | usulan | `wa.me?text=…(ref: kode)` sudah ada untuk website; perluas ke TrackedLink agar pencocokan **tidak** bergantung pada kemiripan teks (L1) atau jendela 15 menit (L3). Kode kadaluarsa + sekali pakai; diuji E2E sebelum dipakai. |
| Klaim sumber oleh sales | usulan | tabel append-only `lead_source_claims` (customer_id, sumber yang diklaim, siapa, kapan, `basis` = SALES_DECLARED / CUSTOMER_STATED, `confidence` terpisah) — **tanpa isi chat, data kesehatan, atau clid**; tidak pernah menimpa `leadSource`. Muncul sebagai kelas 71 (TIDAK/klaim manusia). |
| Pesan pertama CTWA customer lama | sudah | status EXISTING/UNKNOWN pada touch (tidak menjadi lead baru) |

Tidak disimpan di tabel atribusi mana pun: isi chat, data kesehatan, nomor telepon, clid mentah, payload webhook.

## 6. Validasi sampel dan rekonsiliasi (agar Other turun tanpa atribusi palsu)

**Rekonsiliasi (otomatis, tiap pengukuran):**
- Σ kategori = total customer; Σ per era = total; spam dan staf dipisah dan tidak dikurangkan dari denominator tanpa dilaporkan.
- Perubahan jumlah kelas antar-pengukuran harus sama dengan jumlah baris buku besar reklasifikasi yang berbukti (selisih tanpa bukti = 0).
- Σ lead teratribusi per campaign (laporan Fase 2) ≤ customer berkelas K1; K1 + K2 = customer dengan touch NEW terhitung di `/kesehatan.db.statusCustomer.new`.

**Sampel manual (sebelum angka dipakai keputusan biaya):**
| Kelas | Ukuran sampel | Pembanding independen | Ambang lulus |
|---|---|---|---|
| K1 (AD) | 30 customer atau seluruhnya bila < 30 | Ads Manager (leads per ad per hari) + payload WAHA untuk pesan itu | 100% Ad ID cocok; 0 pemetaan salah |
| 30 (clid) | 30 | clid ada di ≥ 1 klik iklan Meta (Ads Manager/Windsor per hari) | ≥ 95% |
| 50/60/61 | 20 per kelas | tag/ClickEvent tersimpan dan terbaca ulang | 100% |
| 41/42 (inferensi) | 30 | tanya customer/sales; bila tak terkonfirmasi tetap LEMAH | hanya untuk mengukur presisi inferensi, **tidak** menaikkan kelas |
| 80 (direct) | 30 dari customer dengan order | konfirmasi sales/customer (klaim berlabel) | hasil menjadi klaim kelas 71, bukan menggeser ke Meta |
| 70 | seluruh 28 | arah pesan pertama OUTBOUND | bukan lead masuk |

**Target "Other turun":** yang dapat turun secara sah hanyalah **kelas 80 → K1/30/50…** untuk pesan yang **masuk sesudah** flag touch menyala (bukti baru), dan 71 ↔ kelas bukti bila ada bukti teknis bersamaan. Kelas 70 (28) tidak ditargetkan turun: itu bukan lead masuk.

## 7. Batas klaim

- Tidak ada atribusi historis ke ad; lead sebelum touch tersimpan tetap kelas 30/lemah/tidak.
- `OTHER` literal (30) tidak dipindahkan ke mana pun.
- CPA/ROAS tetap `null`; penyebut kelak = `closingUtama.customerLunasTerbuktiLedger`.
